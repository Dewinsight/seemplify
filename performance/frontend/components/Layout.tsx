'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  List,
  Typography,
  Divider,
  IconButton,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Avatar,
  Menu,
  MenuItem,
  useMediaQuery,
  useTheme,
  Chip,
  Collapse,
  Badge,
  Skeleton,
  CircularProgress,
  alpha,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Dashboard,
  Flag,
  RateReview,
  Feedback,
  Analytics,
  Logout,
  Person,
  Settings,
  ChevronLeft,
  AutoAwesome,
  Groups,
  Business,
  ExpandMore,
  ExpandLess,
  SupervisorAccount,
  Assessment,
  AdminPanelSettings,
  PeopleAlt,
  Event,
  TrendingUp,
  Balance,
  BarChart,
  SwapHoriz,
  Assignment,
  School,
} from '@mui/icons-material';
import { useUserContext, useOrganizations } from '@/lib/hooks';
import api, { authApi, isAuthenticated as checkAuthenticated } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { gradients } from '@/app/theme';
import { useAuth } from '@/context/AuthContext';

const drawerWidth = 280;

interface NavItem {
  name: string;
  href: string;
  icon: React.ReactNode;
  badge?: string | number;
  requiresRole?: string[];
}

// Main navigation items - available to all authenticated users
const mainNavItems: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: <Dashboard /> },
  { name: 'My OKRs', href: '/okrs', icon: <Flag />, badge: 'AI' },
  { name: 'Appraisals', href: '/appraisals', icon: <Assignment />, badge: 'AI' },
  { name: 'Reviews', href: '/reviews', icon: <RateReview />, badge: 'AI' },
  { name: 'Feedback', href: '/feedback', icon: <Feedback /> },
  { name: '1:1 Meetings', href: '/one-on-ones', icon: <Event /> },
  { name: 'Development Plan', href: '/development', icon: <TrendingUp /> },
];

// Manager navigation items - only for line_manager and hr_admin
const managerNavItems: NavItem[] = [
  { name: 'My Team', href: '/team', icon: <Groups /> },
  { name: 'Team OKRs', href: '/team/okrs', icon: <PeopleAlt /> },
  { name: 'Team Reviews', href: '/team/reviews', icon: <SupervisorAccount /> },
  { name: 'Team Feedback', href: '/team/feedback', icon: <Feedback /> },
];

// Analytics - available based on role
const analyticsNavItems: NavItem[] = [
  { name: 'My Analytics', href: '/analytics', icon: <Analytics /> },
  { name: 'Team Analytics', href: '/analytics/team', icon: <Assessment />, requiresRole: ['team_lead', 'line_manager', 'hr_admin'] },
];

// Admin items - only for hr_admin
const adminNavItems: NavItem[] = [
  { name: 'Appraisal Cycles', href: '/admin/appraisal-cycles', icon: <AdminPanelSettings /> },
  { name: 'Review Cycles', href: '/admin/review-cycles', icon: <AdminPanelSettings /> },
  { name: 'Calibration', href: '/admin/calibration', icon: <Balance /> },
  { name: 'Reports', href: '/admin/reports', icon: <BarChart /> },
  { name: 'Org Analytics', href: '/admin/analytics', icon: <Assessment /> },
];

// Help/Resources
const helpNavItems: NavItem[] = [
  { name: 'Tutorial & Help', href: '/tutorial', icon: <School /> },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const theme = useTheme();
  const router = useRouter();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  // Get auth state from AuthContext FIRST
  const { isAuthenticated: authIsAuthenticated, isLoading: authLoading, user: authUser } = useAuth();

  // Only use SWR hooks AFTER auth is ready (prevents 401 errors during token extraction)
  const shouldFetchData = authIsAuthenticated && !authLoading;

  // Use comprehensive user context - but only when auth is ready
  const {
    user,
    role,
    roleDisplay,
    isManager,
    isHRAdmin,
    isTeamLead,
    organization,
    teams,
    primaryTeam,
    managerData,
    pendingReviews,
    features,
    isLoading: contextLoading
  } = useUserContext();

  // Get organizations for switcher - but only when auth is ready
  const {
    organizations,
    currentOrganizationId,
    isLoading: orgsLoading,
    mutate: mutateOrgs
  } = useOrganizations();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [orgAnchorEl, setOrgAnchorEl] = useState<null | HTMLElement>(null);
  const [managerMenuOpen, setManagerMenuOpen] = useState(true);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [switchingOrg, setSwitchingOrg] = useState(false);

  // Use auth from context
  const isAuthenticated = authIsAuthenticated;
  // Get user name with multiple fallbacks
  const userName = user?.name || 'User';
  const userEmail = user?.email || '';

  // Get org name from multiple sources
  const orgName = organization?.name ||
    (Array.isArray(organizations) && organizations.length > 0
      ? organizations.find((o: any) => o.isCurrent)?.name || organizations[0]?.name
      : 'Organization');

  // Check if nav item should be shown based on role
  const shouldShowNavItem = (item: NavItem) => {
    if (!item.requiresRole) return true;
    return item.requiresRole.includes(role);
  };

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = async () => {
    handleClose();
    await authApi.logout();
    router.push('/login');
  };

  const handleOrgMenu = (event: React.MouseEvent<HTMLElement>) => {
    setOrgAnchorEl(event.currentTarget);
  };

  const handleOrgClose = () => {
    setOrgAnchorEl(null);
  };

  const handleSwitchOrganization = async (orgId: string) => {
    if (switchingOrg) return; // Prevent double-click
    try {
      setSwitchingOrg(true);
      handleOrgClose(); // Close menu first

      // Call the auth endpoint (same as leave management)
      const response = await api.post('/auth/switch-organization', { organizationId: orgId });

      if (response.data?.success) {
        // Reload the page to refresh all data with new organization context
        window.location.reload();
      } else {
        throw new Error(response.data?.error || 'Failed to switch organization');
      }
    } catch (error) {
      console.error('Failed to switch organization:', error);
      setSwitchingOrg(false);
    }
  };

  // Render navigation item with enhanced styling
  const renderNavItem = (item: NavItem, isActive: boolean, indent: boolean = false) => (
    <ListItem key={item.href} disablePadding sx={{ mb: 0.5 }}>
      <ListItemButton
        component={Link}
        href={item.href}
        onClick={() => isMobile && setMobileOpen(false)}
        sx={{
          borderRadius: 2.5,
          mx: 1.5,
          pl: indent ? 4 : 2,
          py: 1.25,
          position: 'relative',
          overflow: 'hidden',
          bgcolor: isActive ? alpha(theme.palette.primary.main, 0.12) : 'transparent',
          color: isActive ? 'primary.main' : 'text.primary',
          transition: 'all 0.2s ease',
          '&::before': isActive ? {
            content: '""',
            position: 'absolute',
            left: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 4,
            height: '60%',
            borderRadius: '0 4px 4px 0',
            background: gradients.primary,
          } : {},
          '&:hover': {
            bgcolor: isActive
              ? alpha(theme.palette.primary.main, 0.16)
              : alpha(theme.palette.primary.main, 0.06),
            transform: 'translateX(4px)',
          },
        }}
      >
        <ListItemIcon
          sx={{
            color: isActive ? 'primary.main' : 'text.secondary',
            minWidth: 40,
            transition: 'color 0.2s ease',
          }}
        >
          {item.icon}
        </ListItemIcon>
        <ListItemText
          primary={item.name}
          primaryTypographyProps={{
            fontWeight: isActive ? 600 : 500,
            fontSize: indent ? 14 : 'inherit',
          }}
        />
        {item.badge && (
          typeof item.badge === 'number' ? (
            <Badge badgeContent={item.badge} color="secondary" />
          ) : (
            <Chip
              label={item.badge}
              size="small"
              sx={{
                height: 20,
                fontSize: 10,
                fontWeight: 700,
                background: isActive
                  ? alpha(theme.palette.primary.main, 0.2)
                  : 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
                color: isActive ? 'primary.main' : 'white',
                border: 'none',
              }}
            />
          )
        )}
      </ListItemButton>
    </ListItem>
  );

  const drawer = (
    <Box sx={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
    }}>
      {/* Header with Logo */}
      <Box sx={{ p: 2.5, display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: 2.5,
            background: gradients.purple,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 24px -8px rgba(102, 126, 234, 0.5)',
            transition: 'transform 0.3s ease, box-shadow 0.3s ease',
            '&:hover': {
              transform: 'scale(1.05)',
              boxShadow: '0 12px 32px -8px rgba(102, 126, 234, 0.6)',
            },
          }}
        >
          <AutoAwesome sx={{ color: 'white', fontSize: 24 }} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography
            variant="h6"
            fontWeight={700}
            noWrap
            sx={{
              background: gradients.purple,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Performance
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            AI-Powered Management
          </Typography>
        </Box>
        {isMobile && (
          <IconButton
            onClick={handleDrawerToggle}
            sx={{
              bgcolor: alpha(theme.palette.grey[500], 0.08),
              '&:hover': { bgcolor: alpha(theme.palette.grey[500], 0.12) },
            }}
          >
            <ChevronLeft />
          </IconButton>
        )}
      </Box>

      <Divider sx={{ mx: 2, borderColor: alpha(theme.palette.divider, 0.5) }} />

      {/* Organization & Role Info */}
      {isAuthenticated && (
        <>
          {/* Organization Switcher - Only show if user has multiple orgs */}
          {Array.isArray(organizations) && organizations.length > 1 && !orgsLoading && (
            <Box sx={{ px: 1.5, pt: 1.5 }}>
              <ListItemButton
                onClick={handleOrgMenu}
                sx={{
                  borderRadius: 2,
                  bgcolor: alpha(theme.palette.primary.main, 0.04),
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    bgcolor: alpha(theme.palette.primary.main, 0.08),
                    borderColor: alpha(theme.palette.primary.main, 0.2),
                  }
                }}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>
                  <Business sx={{ fontSize: 18, color: 'primary.main' }} />
                </ListItemIcon>
                <ListItemText
                  primary={orgName}
                  secondary={organizations.length > 1 ? `Switch (${organizations.length})` : null}
                  primaryTypographyProps={{ fontSize: 13, fontWeight: 600, noWrap: true }}
                  secondaryTypographyProps={{ fontSize: 11 }}
                />
                <SwapHoriz sx={{ fontSize: 18, color: 'primary.main' }} />
              </ListItemButton>
            </Box>
          )}

          {/* User Info Card */}
          <Box
            sx={{
              px: 2,
              py: 1.5,
              mx: 1.5,
              borderRadius: 2.5,
              mt: 1.5,
              background: alpha(theme.palette.primary.main, 0.04),
              border: `1px solid ${alpha(theme.palette.primary.main, 0.08)}`,
            }}
          >
            {contextLoading ? (
              <>
                <Skeleton variant="text" width={100} height={16} />
                <Skeleton variant="text" width={150} height={20} />
              </>
            ) : (
              <>
                {/* Organization (shown when only 1 org or no orgs loaded) */}
                {(!Array.isArray(organizations) || organizations.length <= 1) && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Business sx={{ fontSize: 14, color: 'text.secondary' }} />
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                      {organization?.name || orgName}
                    </Typography>
                  </Box>
                )}

                {/* User Name */}
                <Typography variant="body2" fontWeight={600} noWrap>
                  {userName}
                </Typography>

                {/* Role & Team */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
                  <Chip
                    label={roleDisplay}
                    size="small"
                    sx={{
                      height: 22,
                      fontSize: 11,
                      fontWeight: 600,
                      background: isHRAdmin
                        ? 'linear-gradient(135deg, #ec4899 0%, #f472b6 100%)'
                        : isManager
                          ? gradients.primary
                          : alpha(theme.palette.grey[500], 0.12),
                      color: isHRAdmin || isManager ? 'white' : 'text.secondary',
                    }}
                  />
                  {primaryTeam && (
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ ml: 0.5 }}>
                      • {primaryTeam.name}
                    </Typography>
                  )}
                </Box>

                {/* Manager Stats */}
                {isManager && managerData && (
                  <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                    {managerData.directReportCount > 0 && (
                      <Chip
                        icon={<Groups sx={{ fontSize: 12 }} />}
                        label={`${managerData.directReportCount} Reports`}
                        size="small"
                        variant="outlined"
                        sx={{ height: 20, fontSize: 10, borderColor: alpha(theme.palette.primary.main, 0.3) }}
                      />
                    )}
                    {pendingReviews > 0 && (
                      <Chip
                        label={`${pendingReviews} Pending`}
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: 10,
                          background: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
                          color: 'white',
                        }}
                      />
                    )}
                  </Box>
                )}
              </>
            )}
          </Box>
        </>
      )}

      {/* Navigation */}
      <Box sx={{ flex: 1, py: 1.5, overflowY: 'auto' }}>
        {/* Main Navigation */}
        <Typography
          variant="overline"
          sx={{
            px: 3,
            color: 'text.secondary',
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: '0.1em',
          }}
        >
          My Performance
        </Typography>
        <List sx={{ px: 0.5, pt: 0.5 }}>
          {mainNavItems.map((item) => renderNavItem(item, pathname === item.href))}
        </List>

        {/* Manager Section */}
        {isManager && (
          <>
            <Divider sx={{ my: 1.5, mx: 2, borderColor: alpha(theme.palette.divider, 0.5) }} />
            <ListItemButton
              onClick={() => setManagerMenuOpen(!managerMenuOpen)}
              sx={{
                mx: 1.5,
                borderRadius: 2,
                transition: 'all 0.2s ease',
              }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                <Badge badgeContent={pendingReviews} color="error">
                  <SupervisorAccount sx={{ color: 'secondary.main' }} />
                </Badge>
              </ListItemIcon>
              <ListItemText
                primary="Team Management"
                primaryTypographyProps={{ fontWeight: 600, color: 'secondary.main' }}
              />
              {managerData?.directReportCount && (
                <Chip
                  label={managerData.directReportCount}
                  size="small"
                  sx={{
                    height: 20,
                    fontSize: 10,
                    mr: 1,
                    background: gradients.secondary,
                    color: 'white',
                  }}
                />
              )}
              {managerMenuOpen ? <ExpandLess /> : <ExpandMore />}
            </ListItemButton>
            <Collapse in={managerMenuOpen} timeout="auto" unmountOnExit>
              <List component="div" disablePadding sx={{ px: 0.5 }}>
                {managerNavItems.map((item) => {
                  const isActive = pathname === item.href;
                  const badge = item.href === '/team/reviews' ? pendingReviews : undefined;
                  return renderNavItem({ ...item, badge }, isActive, true);
                })}
              </List>
            </Collapse>
          </>
        )}

        {/* Analytics Section */}
        <Divider sx={{ my: 1.5, mx: 2, borderColor: alpha(theme.palette.divider, 0.5) }} />
        <Typography
          variant="overline"
          sx={{
            px: 3,
            color: 'text.secondary',
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: '0.1em',
          }}
        >
          Analytics
        </Typography>
        <List sx={{ px: 0.5, pt: 0.5 }}>
          {analyticsNavItems.filter(shouldShowNavItem).map((item) =>
            renderNavItem(item, pathname === item.href)
          )}
        </List>

        {/* HR Admin Section */}
        {isHRAdmin && (
          <>
            <Divider sx={{ my: 1.5, mx: 2, borderColor: alpha(theme.palette.divider, 0.5) }} />
            <ListItemButton
              onClick={() => setAdminMenuOpen(!adminMenuOpen)}
              sx={{
                mx: 1.5,
                borderRadius: 2,
                transition: 'all 0.2s ease',
              }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                <AdminPanelSettings sx={{ color: 'error.main' }} />
              </ListItemIcon>
              <ListItemText
                primary="HR Administration"
                primaryTypographyProps={{ fontWeight: 600, color: 'error.main' }}
              />
              {adminMenuOpen ? <ExpandLess /> : <ExpandMore />}
            </ListItemButton>
            <Collapse in={adminMenuOpen} timeout="auto" unmountOnExit>
              <List component="div" disablePadding sx={{ px: 0.5 }}>
                {adminNavItems.map((item) => renderNavItem(item, pathname === item.href, true))}
              </List>
            </Collapse>
          </>
        )}

        {/* Teams List */}
        {teams.length > 1 && (
          <>
            <Divider sx={{ my: 1.5, mx: 2, borderColor: alpha(theme.palette.divider, 0.5) }} />
            <Typography
              variant="overline"
              sx={{
                px: 3,
                color: 'text.secondary',
                fontWeight: 700,
                fontSize: 10,
                letterSpacing: '0.1em',
              }}
            >
              My Teams ({teams.length})
            </Typography>
            <List sx={{ px: 0.5, pt: 0.5 }}>
              {teams.slice(0, 3).map((team: any) => (
                <ListItem key={team.id} disablePadding>
                  <ListItemButton sx={{ borderRadius: 2, mx: 1.5, py: 0.75 }}>
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <Groups sx={{ fontSize: 18, color: 'text.secondary' }} />
                    </ListItemIcon>
                    <ListItemText
                      primary={team.name}
                      secondary={team.roleDisplay}
                      primaryTypographyProps={{ fontSize: 13, fontWeight: 500 }}
                      secondaryTypographyProps={{ fontSize: 11 }}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </>
        )}

        {/* Help & Resources */}
        <Divider sx={{ my: 1.5, mx: 2, borderColor: alpha(theme.palette.divider, 0.5) }} />
        <List sx={{ px: 0.5 }}>
          {helpNavItems.map((item) => renderNavItem(item, pathname === item.href))}
        </List>
      </Box>

      {/* User Section */}
      <Divider sx={{ borderColor: alpha(theme.palette.divider, 0.5) }} />
      <Box sx={{ p: 2 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            p: 1.5,
            borderRadius: 2.5,
            bgcolor: alpha(theme.palette.grey[500], 0.04),
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            '&:hover': {
              bgcolor: alpha(theme.palette.grey[500], 0.08),
              transform: 'translateY(-2px)',
            },
          }}
          onClick={handleMenu}
        >
          <Avatar
            sx={{
              background: gradients.primary,
              boxShadow: '0 4px 12px -2px rgba(99, 102, 241, 0.4)',
            }}
          >
            {userName.charAt(0).toUpperCase()}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600} noWrap>
              {userName}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {userEmail}
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* App Bar */}
      <AppBar
        position="fixed"
        sx={{
          display: { md: 'none' },
          bgcolor: 'white',
          color: 'text.primary',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Toolbar>
          <IconButton color="inherit" edge="start" onClick={handleDrawerToggle}>
            <MenuIcon />
          </IconButton>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              ml: 1,
            }}
          >
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: 1.5,
                background: gradients.purple,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AutoAwesome sx={{ color: 'white', fontSize: 18 }} />
            </Box>
            <Typography
              variant="h6"
              noWrap
              component="div"
              fontWeight={700}
              sx={{
                background: gradients.purple,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Performance
            </Typography>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Drawer */}
      <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
        {/* Mobile Drawer */}
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', md: 'none' },
            '& .MuiDrawer-paper': {
              width: drawerWidth,
              border: 'none',
              boxShadow: '4px 0 24px rgba(0,0,0,0.12)',
            },
          }}
        >
          {drawer}
        </Drawer>

        {/* Desktop Drawer */}
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', md: 'block' },
            '& .MuiDrawer-paper': {
              width: drawerWidth,
              boxSizing: 'border-box',
              border: 'none',
              borderRight: '1px solid',
              borderColor: alpha(theme.palette.divider, 0.5),
            },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>

      {/* Main Content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 2, sm: 3 },
          width: { md: `calc(100% - ${drawerWidth}px)` },
          mt: { xs: '56px', md: 0 },
          minHeight: '100vh',
        }}
      >
        {children}
      </Box>

      {/* User Menu */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        PaperProps={{
          sx: {
            mt: -1,
            minWidth: 200,
          }
        }}
      >
        <MenuItem onClick={handleClose}>
          <ListItemIcon><Person fontSize="small" /></ListItemIcon>
          Profile
        </MenuItem>
        <MenuItem onClick={handleClose}>
          <ListItemIcon><Settings fontSize="small" /></ListItemIcon>
          Settings
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleLogout} sx={{ color: 'error.main' }}>
          <ListItemIcon><Logout fontSize="small" sx={{ color: 'error.main' }} /></ListItemIcon>
          Logout
        </MenuItem>
      </Menu>

      {/* Organization Switcher Menu */}
      <Menu
        anchorEl={orgAnchorEl}
        open={Boolean(orgAnchorEl)}
        onClose={handleOrgClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        PaperProps={{
          sx: { minWidth: 250 }
        }}
      >
        <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ letterSpacing: '0.05em' }}>
            SWITCH ORGANIZATION
          </Typography>
        </Box>
        {organizations && organizations.map((org) => (
          <MenuItem
            key={org.id}
            onClick={() => handleSwitchOrganization(org.id)}
            disabled={org.isCurrent || switchingOrg}
            sx={{
              py: 1.5,
              bgcolor: org.isCurrent ? alpha(theme.palette.primary.main, 0.08) : 'transparent'
            }}
          >
            <ListItemIcon>
              <Business fontSize="small" color={org.isCurrent ? 'primary' : 'inherit'} />
            </ListItemIcon>
            <ListItemText
              primary={org.name}
              secondary={org.isCurrent ? 'Current' : 'Switch'}
              primaryTypographyProps={{
                fontWeight: org.isCurrent ? 600 : 400
              }}
            />
            {switchingOrg && (
              <CircularProgress size={16} sx={{ ml: 1 }} />
            )}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}



