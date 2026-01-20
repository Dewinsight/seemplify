import { BrowserRouter as Router, Routes, Route, Link, Navigate, Outlet } from 'react-router-dom';
import { Dashboard, Rules, Analyze, AdminUsers, Login, Register, VerifyOtp, ProjectDetail } from './pages';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';

const Navbar = () => {
  const { user, logout } = useAuth();
  const { toggleTheme, theme } = useTheme();

  return (
    <nav className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 2rem' }}>
      <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}>
        {/* Logo using styled HTML for perfect alignment */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
          <span style={{
            fontFamily: "'Outfit', sans-serif",
            fontWeight: 800,
            fontSize: '1.6rem',
            color: 'var(--text-primary)',
            letterSpacing: '-0.5px'
          }}>STERLING</span>
          <span style={{
            fontFamily: "'Outfit', sans-serif",
            fontWeight: 600,
            fontSize: '1.6rem',
            color: 'var(--logo-secondary)',
            letterSpacing: '-0.5px',
            marginLeft: '0.4rem'
          }}>APPR</span>
          {/* Shield Icon replacing O */}
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
          <span style={{
            fontFamily: "'Outfit', sans-serif",
            fontWeight: 600,
            fontSize: '1.6rem',
            color: 'var(--logo-secondary)',
            letterSpacing: '-0.5px'
          }}>VER</span>
        </div>
      </Link>
      <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
        {user ? (
          <>
            <Link to="/" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 'bold' }}>Dashboard</Link>
            <Link to="/analyze" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 'bold' }}>New Analysis</Link>
            {(user.role === 'Admin' || user.role === 'Approver') && (
              <Link to="/rules" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 'bold' }}>Rules</Link>
            )}
            {user.role === 'Admin' && (
              <Link to="/admin/users" style={{ color: 'var(--sterling-red)', textDecoration: 'none', fontWeight: 'bold' }}>👥 Users</Link>
            )}
            <span style={{ opacity: 0.7 }}>|</span>
            <span style={{ fontWeight: 'bold' }}>{user.username} ({user.role})</span>
            <button onClick={logout} className="btn-primary" style={{ padding: '0.4rem 1rem', fontSize: '0.9rem', background: '#f44336' }}>Logout</button>
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
                <Route path="/admin/users" element={<AdminUsers />} />
              </Route>
            </Routes>
          </div>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
