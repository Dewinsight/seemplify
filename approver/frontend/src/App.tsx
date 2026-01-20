import { BrowserRouter as Router, Routes, Route, Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Dashboard, Rules, Analyze, AdminUsers, Login, Register, VerifyOtp, ProjectDetail, Profile } from './pages';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import api from './api';

const Navbar = () => {
  const { user, logout, activeDepartment, switchDepartment } = useAuth();
  const { toggleTheme, theme } = useTheme();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [adminDepartments, setAdminDepartments] = useState<any[]>([]);
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  // Fetch all departments if Admin
  useEffect(() => {
    if (user?.isAdmin) {
      const fetchDepts = async () => {
        try {
          const res = await api.get('/departments');
          setAdminDepartments(res.data);
        } catch (e) {
          console.error(e);
        }
      };
      fetchDepts();
    }
  }, [user]);

  const availableDepartments = user?.isAdmin ? adminDepartments : (user?.permissions?.map((p: any) => p.department) || []);

  return (
    <nav className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 2rem', position: 'relative', zIndex: 50 }}>
      <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
          <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '1.6rem', color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>STERLING</span>
          <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: '1.6rem', color: 'var(--logo-secondary)', letterSpacing: '-0.5px', marginLeft: '0.4rem' }}>APPR</span>
          <svg viewBox="0 0 30 38" style={{ height: '1.4rem', margin: '0 -1px' }}>
            <defs>
              <linearGradient id="shieldGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#E1A777" />
                <stop offset="100%" stopColor="#D63637" />
              </linearGradient>
            </defs>
            <path fill="url(#shieldGrad)" d="M15 0 C7 0 2 5 2 15 C2 28 15 38 15 38 C15 38 28 28 28 15 C28 5 23 0 15 0 Z" />
            <path fill="white" d="M9 18 L13 22 L22 11 L25 14 L13 27 L6 20 Z" />
          </svg>
          <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: '1.6rem', color: 'var(--logo-secondary)', letterSpacing: '-0.5px' }}>VER</span>
        </div>
      </Link>
      <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
        {user ? (
          <>
            <Link to="/" style={{ color: isActive('/') ? 'var(--sterling-red)' : 'var(--text-primary)', textDecoration: 'none', fontWeight: 'bold' }}>Dashboard</Link>
            <Link to="/analyze" style={{ color: isActive('/analyze') ? 'var(--sterling-red)' : 'var(--text-primary)', textDecoration: 'none', fontWeight: 'bold' }}>Analysis</Link>
            <Link to="/rules" style={{ color: isActive('/rules') ? 'var(--sterling-red)' : 'var(--text-primary)', textDecoration: 'none', fontWeight: 'bold' }}>Rules</Link>

            {user.isAdmin && (
              <Link to="/admin/organization" style={{ color: isActive('/admin/organization') ? 'var(--sterling-red)' : 'var(--text-primary)', textDecoration: 'none', fontWeight: 'bold' }}>Organization</Link>
            )}

            {/* Context Switcher & User Profile */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginLeft: '1.5rem' }}>
              <span style={{ opacity: 0.3 }}>|</span>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: '1.1' }}>
                <Link to="/profile" style={{ textDecoration: 'none', color: 'inherit' }} title="View Profile">
                  <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{user.username}</span>
                </Link>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{user.isAdmin ? 'Global Admin' : (activeDepartment?.name || 'No Context')}</span>
              </div>

              {/* Custom Dropdown */}
              {(availableDepartments.length > 0 || user.isAdmin) && (
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid var(--glass-border)',
                      borderRadius: '8px',
                      padding: '0.4rem 0.8rem',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      transition: 'all 0.2s'
                    }}
                  >
                    <span style={{ fontSize: '0.85rem' }}>{activeDepartment?.name || 'Select Dept'}</span>
                    <span style={{ fontSize: '0.7rem' }}>▼</span>
                  </button>

                  {isDropdownOpen && (
                    <div className="dropdown-menu">
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', padding: '0.4rem', borderBottom: '1px solid var(--glass-border)', marginBottom: '0.4rem' }}>
                        Switch Context
                      </div>
                      {availableDepartments.map((dept: any) => (
                        <div
                          key={dept._id}
                          onClick={() => {
                            switchDepartment(dept);
                            setIsDropdownOpen(false);
                          }}
                          style={{
                            padding: '0.6rem 0.8rem',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            background: activeDepartment?._id === dept._id ? 'var(--sterling-red)' : 'transparent',
                            marginBottom: '2px',
                            transition: 'background 0.2s'
                          }}
                          onMouseEnter={(e) => { if (activeDepartment?._id !== dept._id) e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
                          onMouseLeave={(e) => { if (activeDepartment?._id !== dept._id) e.currentTarget.style.background = 'transparent' }}
                        >
                          {dept.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>



            <button onClick={logout} className="btn-primary" style={{ padding: '0.4rem 1rem', fontSize: '0.9rem', background: '#f44336', marginLeft: '0.5rem' }}>Logout</button>
          </>
        ) : (
          <>
            <Link to="/login" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 'bold' }}>Login</Link>
            <Link to="/register" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 'bold' }}>Register</Link>
          </>
        )}
        <button
          onClick={toggleTheme}
          style={{
            background: 'none',
            border: '1px solid var(--glass-border)',
            color: 'var(--text-primary)',
            borderRadius: '50%',
            width: '32px',
            height: '32px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          title="Toggle Theme"
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
    </nav >
  );
};

const ProtectedRoute = () => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <div>Loading...</div>;
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" />;
};

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <div className="app-container">
            <Navbar />

            <Routes>
              {/* Public Routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/verify" element={<VerifyOtp />} />

              {/* Protected Routes */}
              <Route element={<ProtectedRoute />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/analyze" element={<Analyze />} />
                <Route path="/rules" element={<Rules />} />
                <Route path="/projects/:id" element={<ProjectDetail />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/admin/organization" element={<AdminUsers />} />
              </Route>
            </Routes>
          </div>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
