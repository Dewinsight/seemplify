import { BrowserRouter as Router, Routes, Route, Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Dashboard, Rules, Analyze, AdminUsers, Login, Register, VerifyOtp, ProjectDetail, Profile } from './pages';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import api from './api';

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

const OrgIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 00-3-3.87" />
    <path d="M16 3.13a4 4 0 010 7.75" />
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
  const { user, logout, activeDepartment, switchDepartment } = useAuth();
  const { toggleTheme, theme } = useTheme();
  const [adminDepartments, setAdminDepartments] = useState<any[]>([]);
  const [deptDropdownOpen, setDeptDropdownOpen] = useState(false);
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  useEffect(() => {
    if (user?.isAdmin) {
      api.get('/departments').then(res => setAdminDepartments(res.data)).catch(console.error);
    }
  }, [user]);

  const availableDepartments = user?.isAdmin ? adminDepartments : (user?.permissions?.map((p: any) => p.department) || []);

  const navItems = [
    { path: '/', label: 'Dashboard', icon: <DashboardIcon /> },
    { path: '/analyze', label: 'Initiatives', icon: <InitiativesIcon /> },
    { path: '/rules', label: 'Rules', icon: <RulesIcon /> },
    ...(user?.isAdmin ? [{ path: '/admin/organization', label: 'Organization', icon: <OrgIcon /> }] : []),
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
        {/* Logo */}
        <div className="sidebar-logo">
          <Logo />
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          {navItems.map(item => (
            <Link
              key={item.path}
              to={item.path}
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
          {/* User Info */}
          <Link to="/profile" onClick={handleNavClick} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', textDecoration: 'none', color: 'inherit', marginBottom: '1rem' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--brand-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold', fontSize: '0.9rem' }}>
              {user.username?.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, lineHeight: 1.2 }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{user.username}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{user.isAdmin ? 'Admin' : (activeDepartment?.name || 'No Dept')}</div>
            </div>
          </Link>

          {/* Department Switcher */}
          {(availableDepartments.length > 0 || user.isAdmin) && (
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
                <span>{activeDepartment?.name || (user.isAdmin ? 'All Departments' : 'Select Dept')}</span>
                <span style={{ fontSize: '0.7rem' }}>▼</span>
              </button>
              {deptDropdownOpen && (
                <div style={{ marginTop: '0.5rem', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: '8px', overflow: 'hidden' }}>
                  {user.isAdmin && (
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
  return (
    <header className="mobile-header">
      <Logo />
      <button className="hamburger-btn" onClick={onMenuClick}>
        <MenuIcon />
      </button>
    </header>
  );
};

const AppLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Outlet />;
  }

  return (
    <div className="app-layout">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <MobileHeader onMenuClick={() => setSidebarOpen(true)} />
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
};

const ProtectedRoute = () => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <div className="glass-panel">Loading...</div>;
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" />;
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

            {/* Protected Routes - With Sidebar Layout */}
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/analyze" element={<Analyze />} />
                <Route path="/rules" element={<Rules />} />
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
