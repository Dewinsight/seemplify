'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useUserContext, useOrganizations } from '@/lib/hooks';
import { authApi, isAuthenticated as checkAuthenticated } from '@/lib/api';
import { useRouter } from 'next/navigation';
import './globals.css';

const drawerWidth = 280;

interface NavItem {
  name: string;
  href: string;
  icon: React.ReactNode;
  badge?: string | number;
  color?: string;
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  // Use comprehensive user context
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
    isLoading: contextLoading
  } = useUserContext();

  // Get organizations for switcher
  const {
    organizations,
    currentOrganizationId,
    isLoading: orgsLoading,
  } = useOrganizations();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [hasAccessToken, setHasAccessToken] = useState(false);
  const [adminExpanded, setAdminExpanded] = useState(true);
  const [switchingOrg, setSwitchingOrg] = useState(false);

  // Check for access token from hub SSO
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash;
      if (hash.includes('access_token=')) {
        setHasAccessToken(true);
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
  }, []);

  const isAuthenticated = checkAuthenticated() || hasAccessToken;

  // Get user name with multiple fallbacks
  const userName = user?.name || 'User';
  const userEmail = user?.email || '';

  // Get org name from multiple sources
  const orgName = organization?.name ||
    (Array.isArray(organizations) && organizations.length > 0
      ? organizations.find((o: any) => o.isCurrent)?.name || organizations[0]?.name
      : 'Organization');

  const handleLogout = async () => {
    setUserMenuOpen(false);
    await authApi.logout();
    router.push('/login');
  };

  const handleSwitchOrganization = async (orgId: string) => {
    if (switchingOrg) return;
    try {
      setSwitchingOrg(true);
      setOrgMenuOpen(false);
      const response = await authApi.switchOrganization(orgId);
      if (response.data?.success) {
        window.location.reload();
      } else {
        throw new Error(response.data?.error || 'Failed to switch organization');
      }
    } catch (error) {
      console.error('Failed to switch organization:', error);
      setSwitchingOrg(false);
    }
  };

  // Check if we're on the login page - don't show sidebar
  const isLoginPage = pathname === '/login';

  // For login page, render minimal layout
  if (isLoginPage) {
    return (
      <html lang="en">
        <body>
          {children}
        </body>
      </html>
    );
  }

  // Navigation items
  const mainNavItems: NavItem[] = [
    {
      name: 'Dashboard',
      href: '/',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      ),
    },
    {
      name: 'My Payslips',
      href: '/payslips',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      name: 'Team Compensation',
      href: '/team',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      ),
      color: 'blue',
    },
  ];

  const adminNavItems: NavItem[] = [
    {
      name: 'Payroll Runs',
      href: '/admin/run',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      name: 'Approvals',
      href: '/admin/approvals',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      name: 'Reports',
      href: '/admin/reports',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
  ];

  const renderNavItem = (item: NavItem, isActive: boolean) => {
    const baseColor = item.color || 'amber';
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
          isActive
            ? `bg-gradient-to-r from-${baseColor}-500/10 to-${baseColor}-500/5 text-${baseColor}-600 border border-${baseColor}-200/50`
            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
        }`}
      >
        <span className={`flex-shrink-0 ${isActive ? `text-${baseColor}-500` : 'text-slate-400 group-hover:text-slate-600'} transition-colors`}>
          {item.icon}
        </span>
        <span className="flex-1">{item.name}</span>
        {item.badge && (
          <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
            isActive ? `bg-${baseColor}-100 text-${baseColor}-700` : 'bg-slate-100 text-slate-600'
          }`}>
            {item.badge}
          </span>
        )}
        {isActive && (
          <span className={`w-1.5 h-1.5 rounded-full bg-${baseColor}-500`} />
        )}
      </Link>
    );
  };

  const sidebar = (
    <div className="flex flex-col h-full bg-white">
      {/* Logo Header */}
      <div className="p-5 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl blur-lg opacity-40" />
            <div className="relative w-11 h-11 bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/30">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div>
            <h1 className="text-lg font-bold bg-gradient-to-r from-amber-600 to-orange-500 bg-clip-text text-transparent">
              SmartHR Payroll
            </h1>
            <p className="text-xs text-slate-400 font-medium">Compensation Management</p>
          </div>
        </div>
      </div>

      {/* Organization Switcher */}
      {isAuthenticated && Array.isArray(organizations) && organizations.length > 1 && !orgsLoading && (
        <div className="px-4 pt-4">
          <div className="relative">
            <button
              onClick={() => setOrgMenuOpen(!orgMenuOpen)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-100 hover:border-slate-200 hover:bg-slate-100 transition-all"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center">
                <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-semibold text-slate-700 truncate">{orgName}</p>
                <p className="text-xs text-slate-400">Switch organization</p>
              </div>
              <svg className={`w-4 h-4 text-slate-400 transition-transform ${orgMenuOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Org Dropdown */}
            {orgMenuOpen && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl border border-slate-200 shadow-xl shadow-slate-200/50 z-50 overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-100">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Organizations</p>
                </div>
                <div className="p-2">
                  {organizations.map((org: any) => (
                    <button
                      key={org.id}
                      onClick={() => handleSwitchOrganization(org.id)}
                      disabled={org.isCurrent || switchingOrg}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${
                        org.isCurrent
                          ? 'bg-amber-50 border border-amber-200'
                          : 'hover:bg-slate-50'
                      } ${switchingOrg ? 'opacity-50' : ''}`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        org.isCurrent ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500'
                      }`}>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <p className={`text-sm font-medium ${org.isCurrent ? 'text-amber-700' : 'text-slate-700'}`}>{org.name}</p>
                        <p className="text-xs text-slate-400">{org.isCurrent ? 'Current' : 'Click to switch'}</p>
                      </div>
                      {org.isCurrent && (
                        <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* User Info Card */}
      {isAuthenticated && (
        <div className="px-4 pt-4">
          <div className="p-4 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100/50 border border-slate-100">
            {contextLoading ? (
              <div className="space-y-2">
                <div className="h-4 bg-slate-200 rounded animate-pulse w-24" />
                <div className="h-3 bg-slate-200 rounded animate-pulse w-32" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white font-semibold shadow-md shadow-amber-500/30">
                    {userName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{userName}</p>
                    <p className="text-xs text-slate-400 truncate">{userEmail}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold ${
                    isHRAdmin
                      ? 'bg-gradient-to-r from-rose-500 to-pink-500 text-white shadow-sm shadow-rose-500/30'
                      : isManager
                      ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-sm shadow-amber-500/30'
                      : 'bg-slate-200 text-slate-600'
                  }`}>
                    {isHRAdmin && (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                    )}
                    {roleDisplay || 'Employee'}
                  </span>
                  {primaryTeam && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-50 text-blue-600 text-xs font-medium">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      {primaryTeam.name}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-4 py-6 space-y-6 overflow-y-auto">
        {/* Main Navigation */}
        <div>
          <p className="px-3 mb-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">Main Menu</p>
          <div className="space-y-1">
            {mainNavItems.map((item) => {
              const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? 'bg-gradient-to-r from-amber-500/10 to-orange-500/5 text-amber-700 border border-amber-200/50'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <span className={`flex-shrink-0 ${isActive ? 'text-amber-500' : 'text-slate-400 group-hover:text-slate-600'} transition-colors`}>
                    {item.icon}
                  </span>
                  <span className="flex-1">{item.name}</span>
                  {isActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  )}
                </Link>
              );
            })}
          </div>
        </div>

        {/* HR Admin Section */}
        {isHRAdmin && (
          <div>
            <button
              onClick={() => setAdminExpanded(!adminExpanded)}
              className="w-full flex items-center justify-between px-3 mb-2"
            >
              <span className="text-xs font-semibold text-rose-500 uppercase tracking-wider flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                HR Administration
              </span>
              <svg className={`w-4 h-4 text-slate-400 transition-transform ${adminExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {adminExpanded && (
              <div className="space-y-1">
                {adminNavItems.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                        isActive
                          ? 'bg-gradient-to-r from-rose-500/10 to-pink-500/5 text-rose-700 border border-rose-200/50'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                    >
                      <span className={`flex-shrink-0 ${isActive ? 'text-rose-500' : 'text-slate-400 group-hover:text-slate-600'} transition-colors`}>
                        {item.icon}
                      </span>
                      <span className="flex-1">{item.name}</span>
                      {isActive && (
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Quick Links */}
        <div>
          <p className="px-3 mb-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">Resources</p>
          <div className="space-y-1">
            <a
              href="#"
              className="group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all"
            >
              <svg className="w-5 h-5 text-slate-400 group-hover:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              <span>Help & Tutorials</span>
            </a>
            <a
              href={process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000'}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all"
            >
              <svg className="w-5 h-5 text-slate-400 group-hover:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              <span>SmartHR Hub</span>
              <svg className="w-4 h-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>
      </nav>

      {/* User Menu Footer */}
      <div className="p-4 border-t border-slate-100">
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="w-full flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-100 transition-all"
          >
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white font-semibold text-sm shadow-md shadow-amber-500/20">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-semibold text-slate-700 truncate">{userName}</p>
              <p className="text-xs text-slate-400 truncate">{userEmail}</p>
            </div>
            <svg className={`w-4 h-4 text-slate-400 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
          </button>

          {/* User Dropdown */}
          {userMenuOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-xl border border-slate-200 shadow-xl shadow-slate-200/50 overflow-hidden">
              <div className="p-2">
                <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm text-slate-600 hover:bg-slate-50 transition-all">
                  <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  <span>Profile</span>
                </button>
                <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm text-slate-600 hover:bg-slate-50 transition-all">
                  <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span>Settings</span>
                </button>
              </div>
              <div className="border-t border-slate-100 p-2">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm text-red-600 hover:bg-red-50 transition-all"
                >
                  <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  <span>Sign out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // For authenticated pages, render full layout with sidebar
  return (
    <html lang="en">
      <body className="bg-white">
        <div className="flex min-h-screen">
          {/* Mobile Header */}
          <div className="fixed top-0 left-0 right-0 z-40 md:hidden bg-white border-b border-slate-100">
            <div className="flex items-center justify-between px-4 h-16">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl flex items-center justify-center shadow-md shadow-amber-500/30">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <span className="font-bold text-lg bg-gradient-to-r from-amber-600 to-orange-500 bg-clip-text text-transparent">Payroll</span>
              </div>
              <button
                onClick={() => setMobileOpen(!mobileOpen)}
                className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
              >
                {mobileOpen ? (
                  <svg className="w-6 h-6 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Mobile Sidebar Overlay */}
          {mobileOpen && (
            <div
              className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 md:hidden"
              onClick={() => setMobileOpen(false)}
            />
          )}

          {/* Sidebar - Mobile */}
          <div className={`fixed inset-y-0 left-0 z-50 w-[280px] transform transition-transform duration-300 ease-in-out md:hidden ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}>
            {sidebar}
          </div>

          {/* Sidebar - Desktop */}
          <div className="hidden md:block w-[280px] flex-shrink-0">
            <div className="fixed inset-y-0 left-0 w-[280px] border-r border-slate-100">
              {sidebar}
            </div>
          </div>

          {/* Main Content */}
          <main className="flex-1 min-h-screen pt-16 md:pt-0">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
