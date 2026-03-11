import { BrowserRouter as Router, Routes, Route, Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Dashboard, Rules, Analyze, ScoringPolicy, AdminUsers, Login, Register, VerifyOtp, ProjectDetail, Profile, OnboardingPage, InvitesPage, Help } from './pages';
import { AuthProvider, useAuth } from './context/AuthContext';
import InviteNotificationPopup from './components/InviteNotificationPopup';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import api, { getLogoUrl } from './api';
import { getUserDisplayName, getUserInitials } from './utils/userDisplay';
import { hasAnyCapability } from './utils/access';

// Icons as simple SVG components
const DashboardIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="7" height="9" rx="1" />
    <rect x="14" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
  </svg>
);

const InitiativesIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 2L2 7l10 5 10-5-10-5z" />
    <path d="M2 17l10 5 10-5" />
    <path d="M2 12l10 5 10-5" />
  </svg>
);

const RulesIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
    <path d="M10 9H8" />
  </svg>
);

const ScoringIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 3v18h18" />
    <path d="M7 16l3-3 3 2 4-6" />
    <path d="M18 9h2v2" />
  </svg>
);

const OrgIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 00-3-3.87" />
    <path d="M16 3.13a4 4 0 010 7.75" />
  </svg>
);

const InvitesIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);

const HelpIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
    <path d="M12 17h.01" />
  </svg>
);

const MenuIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

const Logo = () => (
  <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}>
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <rect x="4" y="4" width="10" height="10" rx="2" fill="url(#mosaicGrad)" />
      <rect x="18" y="4" width="10" height="10" rx="2" fill="url(#mosaicGrad)" opacity="0.8" />
      <rect x="4" y="18" width="10" height="10" rx="2" fill="url(#mosaicGrad)" opacity="0.8" />
      <rect x="18" y="18" width="10" height="10" rx="2" fill="url(#mosaicGrad)" opacity="0.6" />
      <defs>
        <linearGradient id="mosaicGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#9B51E0" />
          <stop offset="100%" stopColor="#7B3FC0" />
        </linearGradient>
      </defs>
    </svg>
    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
      <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '1.5rem', color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>MOSAIC</span>
    </div>
  </Link>
);

const Sidebar = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const { user, logout, activeOrganization, organizations, switchOrganization, activeDepartment, switchDepartment } = useAuth();
  const { toggleTheme, theme } = useTheme();
  const [adminDepartments, setAdminDepartments] = useState<any[]>([]);
  const [deptDropdownOpen, setDeptDropdownOpen] = useState(false);
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const location = useLocation();

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setSystemPrefersDark(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const isActive = (path: string) => location.pathname === path;
  const isAdmin = activeOrganization?.isAdmin || false;
  const canManageScoring = hasAnyCapability(activeOrganization, ['scoring.manage']);
  const displayName = getUserDisplayName(user, 'User');
  const initials = getUserInitials(user, 'U');

  useEffect(() => {
    if (isAdmin) {
      api.get('/departments').then(res => setAdminDepartments(res.data)).catch(console.error);
    }
  }, [isAdmin, activeOrganization]);

  const availableDepartments = isAdmin
    ? adminDepartments
    : (activeOrganization?.permissions?.map((p: any) => p.department) || []);

  const navItems = [
    { path: '/', label: 'Dashboard', icon: <DashboardIcon /> },
    { path: '/analyze', label: 'Initiatives', icon: <InitiativesIcon /> },
    { path: '/rules', label: 'Rules', icon: <RulesIcon /> },
    ...(canManageScoring ? [{ path: '/scoring-policy', label: 'Scoring Policy', icon: <ScoringIcon /> }] : []),
    { path: '/invites', label: 'Invites', icon: <InvitesIcon /> },
    { path: '/help', label: 'Help', icon: <HelpIcon /> },
    ...(isAdmin ? [{ path: '/admin/organization', label: 'Organization', icon: <OrgIcon /> }] : []),
  ];

  const handleNavClick = () => {
    if (window.innerWidth <= 768) onClose();
  };

  if (!user) return null;

  return (
    <>
      {/* Overlay for mobile */}
      <div className={`sidebar-overlay ${isOpen ? 'open' : ''}`} onClick={onClose} />

      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        {/* Logo & Close Button Row */}
        <div className="sidebar-logo" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Logo />
          <button
            className="show-mobile"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '1.5rem', cursor: 'pointer', padding: '0.5rem' }}
          >
            ✕
          </button>
        </div>

        {/* Organization - always show when user has orgs */}
        {organizations.length > 0 && (
          <div style={{ padding: '0 1rem', marginBottom: '0.5rem' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Organization</div>
            {organizations.length > 1 ? (
              <>
                <button
                  onClick={() => setOrgDropdownOpen(!orgDropdownOpen)}
                  style={{
                    width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'rgba(155, 81, 224, 0.1)', border: '1px solid rgba(155, 81, 224, 0.3)',
                    borderRadius: '8px', padding: '0.6rem 0.8rem', color: 'var(--text-primary)',
                    cursor: 'pointer', fontSize: '0.85rem'
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{activeOrganization?.name || 'Select Org'}</span>
                  <span style={{ fontSize: '0.7rem' }}>▼</span>
                </button>
                {orgDropdownOpen && (
                  <div style={{ marginTop: '0.5rem', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: '8px', overflow: 'hidden' }}>
                    {organizations.map((org) => (
                      <div
                        key={org._id}
                        onClick={() => {
                          switchOrganization(org);
                          setOrgDropdownOpen(false);
                        }}
                        style={{
                          padding: '0.6rem 0.8rem', cursor: 'pointer', fontSize: '0.85rem',
                          fontWeight: activeOrganization?._id === org._id ? 'bold' : 'normal',
                          background: activeOrganization?._id === org._id ? 'rgba(155, 81, 224, 0.15)' : 'transparent'
                        }}
                      >
                        {org.name}
                        {org.isAdmin && <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', opacity: 0.6 }}>Admin</span>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div style={{
                padding: '0.6rem 0.8rem', background: 'rgba(155, 81, 224, 0.1)', border: '1px solid rgba(155, 81, 224, 0.3)',
                borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)'
              }}>
                {activeOrganization?.name || 'No organization'}
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <nav className="sidebar-nav">
          {navItems.map(item => (
            <Link
              key={item.path}
              to={item.path === '/analyze' ? '/analyze?tab=view' : item.path}
              className={`sidebar-nav-item ${isActive(item.path) ? 'active' : ''}`}
              onClick={handleNavClick}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Footer - User Info & Controls */}
        <div className="sidebar-footer">
          {/* Organization Logo - prominent branding above user info */}
          {(() => {
            const mode = activeOrganization?.logoMode || 'all';
            const showInDark = mode === 'all' || mode === 'dark' || (mode === 'system' && systemPrefersDark);
            const showInLight = mode === 'all' || mode === 'light' || (mode === 'system' && !systemPrefersDark);
            const isDark = theme === 'dark' || ((theme as string) === 'system' && systemPrefersDark);
            const shouldShow = (isDark ? showInDark : showInLight) && (
              mode === 'all' ? activeOrganization?.logo :
              isDark ? activeOrganization?.logoDark : activeOrganization?.logoLight
            );
            const logoPath = mode === 'all'
              ? activeOrganization?.logo
              : isDark ? activeOrganization?.logoDark : activeOrganization?.logoLight;
            const bg = activeOrganization?.logoBackground || 'transparent';
            const containerBg = bg === 'transparent' ? 'transparent' : bg;
            return shouldShow && logoPath ? (
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                marginBottom: '1.25rem',
                padding: '1rem',
                background: containerBg,
                border: containerBg === 'transparent' ? '1px solid var(--glass-border)' : 'none',
                borderRadius: '12px'
              }}>
                <img
                  src={getLogoUrl(logoPath) || ''}
                  alt={activeOrganization!.name}
                  style={{
                    width: 80,
                    height: 80,
                    objectFit: 'contain',
                    borderRadius: '10px'
                  }}
                />
              </div>
            ) : null;
          })()}
          {/* User Info */}
          <Link to="/profile" onClick={handleNavClick} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', textDecoration: 'none', color: 'inherit', marginBottom: '1rem' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--brand-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold', fontSize: '0.9rem' }}>
              {initials}
            </div>
            <div style={{ flex: 1, lineHeight: 1.2 }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{displayName}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{isAdmin ? 'Admin' : (activeDepartment?.name || 'No Dept')}</div>
            </div>
          </Link>

          {/* Department Switcher */}
          {(availableDepartments.length > 0 || isAdmin) && (
            <div style={{ marginBottom: '1rem' }}>
              <button
                onClick={() => setDeptDropdownOpen(!deptDropdownOpen)}
                style={{
                  width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)',
                  borderRadius: '8px', padding: '0.6rem 0.8rem', color: 'var(--text-primary)',
                  cursor: 'pointer', fontSize: '0.85rem'
                }}
              >
                <span>{activeDepartment?.name || (isAdmin ? 'All Departments' : 'Select Dept')}</span>
                <span style={{ fontSize: '0.7rem' }}>▼</span>
              </button>
              {deptDropdownOpen && (
                <div style={{ marginTop: '0.5rem', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: '8px', overflow: 'hidden' }}>
                  {isAdmin && (
                    <div onClick={() => { switchDepartment(null); setDeptDropdownOpen(false); }}
                      style={{ padding: '0.6rem 0.8rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: activeDepartment === null ? 'bold' : 'normal', background: activeDepartment === null ? 'rgba(214,54,55,0.1)' : 'transparent' }}>
                      All Departments
                    </div>
                  )}
                  {availableDepartments.map((dept: any) => (
                    <div key={dept._id} onClick={() => { switchDepartment(dept); setDeptDropdownOpen(false); }}
                      style={{ padding: '0.6rem 0.8rem', cursor: 'pointer', fontSize: '0.85rem', background: activeDepartment?._id === dept._id ? 'rgba(214,54,55,0.1)' : 'transparent' }}>
                      {dept.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Actions Row */}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={toggleTheme} title="Toggle Theme"
              style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '0.6rem', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '1rem' }}>
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <button onClick={logout}
              style={{ flex: 2, background: 'var(--brand-primary)', border: 'none', borderRadius: '8px', padding: '0.6rem', color: 'white', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
              Logout
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

const MobileHeader = ({ onMenuClick }: { onMenuClick: () => void }) => {
  const { activeOrganization } = useAuth();
  return (
    <header className="mobile-header">
      <Logo />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {activeOrganization?.name && (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
            {activeOrganization.name}
          </span>
        )}
        <button className="hamburger-btn" onClick={onMenuClick}>
          <MenuIcon />
        </button>
      </div>
    </header>
  );
};

const AppLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { isAuthenticated, activeOrganization, activeDepartment } = useAuth();

  if (!isAuthenticated) {
    return <Outlet />;
  }

  return (
    <div className="app-layout">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <MobileHeader onMenuClick={() => setSidebarOpen(true)} />
      <main className="main-content">
        {/* Context bar: Organization + Department */}
        {(activeOrganization || activeDepartment) && (
          <div style={{
            padding: '0.5rem 0', marginBottom: '1rem', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--glass-border)',
            fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', gap: '1rem', flexWrap: 'wrap'
          }}>
            {activeOrganization?.name && (
              <span><strong>Organization:</strong> {activeOrganization.name}</span>
            )}
            {activeDepartment && (
              <span><strong>Department:</strong> {activeDepartment.name}</span>
            )}
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
};

const ProtectedRoute = () => {
  const { isAuthenticated, isLoading, needsOnboarding } = useAuth();
  const location = useLocation();

  if (isLoading) return <div className="glass-panel">Loading...</div>;
  if (!isAuthenticated) return <Navigate to="/login" />;

  // If user needs onboarding and isn't already on /setup, redirect there
  if (needsOnboarding && location.pathname !== '/setup') {
    return <Navigate to="/setup" />;
  }

  return (
    <>
      <InviteNotificationPopup />
      <Outlet />
    </>
  );
};

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <Routes>
            {/* Public Routes - No Layout */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/verify" element={<VerifyOtp />} />

            {/* Protected Routes */}
            <Route element={<ProtectedRoute />}>
              {/* Onboarding - NO sidebar */}
              <Route path="/setup" element={<OnboardingPage />} />

              {/* Main app - WITH sidebar */}
              <Route element={<AppLayout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/analyze" element={<Analyze />} />
                <Route path="/rules" element={<Rules />} />
                <Route path="/rules/new" element={<Rules />} />
                <Route path="/scoring-policy" element={<ScoringPolicy />} />
                <Route path="/invites" element={<InvitesPage />} />
                <Route path="/help" element={<Help />} />
                <Route path="/projects/:id" element={<ProjectDetail />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/admin/organization" element={<AdminUsers />} />
              </Route>
            </Route>
          </Routes>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
