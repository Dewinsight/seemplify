import React from 'react';
import { Link } from 'react-router-dom';
import HelpPage from '../Help';

const PublicHelpFull: React.FC = () => {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
      {/* Public header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1rem 2rem',
        borderBottom: '1px solid var(--glass-border)',
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(10px)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect x="4" y="4" width="10" height="10" rx="2" fill="url(#phfGrad)" />
            <rect x="18" y="4" width="10" height="10" rx="2" fill="url(#phfGrad)" opacity="0.8" />
            <rect x="4" y="18" width="10" height="10" rx="2" fill="url(#phfGrad)" opacity="0.8" />
            <rect x="18" y="18" width="10" height="10" rx="2" fill="url(#phfGrad)" opacity="0.6" />
            <defs>
              <linearGradient id="phfGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#9B51E0" />
                <stop offset="100%" stopColor="#7B3FC0" />
              </linearGradient>
            </defs>
          </svg>
          <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '1.4rem', color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>
            MOSAIC
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <Link
            to="/login"
            style={{
              padding: '0.5rem 1.1rem',
              borderRadius: '8px',
              border: '1px solid var(--glass-border)',
              background: 'transparent',
              color: 'var(--text-primary)',
              textDecoration: 'none',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
            Login
          </Link>
          <Link
            to="/register"
            style={{
              padding: '0.5rem 1.1rem',
              borderRadius: '8px',
              border: 'none',
              background: 'var(--brand-primary, #9B51E0)',
              color: 'white',
              textDecoration: 'none',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
            Register
          </Link>
        </div>
      </header>

      {/* Full help content */}
      <HelpPage />
    </div>
  );
};

export default PublicHelpFull;
