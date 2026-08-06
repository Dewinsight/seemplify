import { useState } from 'react';
import { Link } from 'react-router-dom';

// Public Help page - accessible without login

const PublicHelpPage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedItem, setExpandedItem] = useState<number | null>(null);

  const faqItems = [
    {
      question: 'What is Mosaic?',
      answer: 'Mosaic is an AI-powered initiative approval platform that helps organizations systematically evaluate, approve, and track projects and initiatives. It combines intelligent AI analysis with flexible workflow automation.'
    },
    {
      question: 'How do I create an account?',
      answer: 'Click "Register" on the login page, enter your email and password, and verify your email with the OTP code sent to your inbox.'
    },
    {
      question: 'How do I reset my password?',
      answer: 'Click "Reset it here" on the login page, enter your email, and we\'ll send you a reset code. Use that code to create a new password.'
    },
    {
      question: 'What happens after I submit an initiative?',
      answer: 'Your initiative goes through an approval workflow. It will be reviewed by relevant managers and may also receive AI analysis. You\'ll be notified of the decision via email and can track status in your dashboard.'
    },
    {
      question: 'How does AI scoring work?',
      answer: 'Our AI analyzes initiatives based on strategic alignment, resource feasibility, risk assessment, expected ROI, and operational impact. Scores help decision-makers evaluate initiatives objectively.'
    },
    {
      question: 'Can I use the platform without AI features?',
      answer: 'Yes! You can submit and approve initiatives manually. All core features (workflows, rules, tracking) work with or without AI.'
    },
    {
      question: 'How do I get help?',
      answer: 'Reach out to your organization administrator for help with access, setup, or account issues.'
    }
  ];

  const filteredFAQs = searchQuery
    ? faqItems.filter(faq => 
        faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
        faq.answer.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : faqItems;

  const toggleItem = (index: number) => {
    setExpandedItem(expandedItem === index ? null : index);
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: 'var(--bg-primary, #0f0f0f)',
      color: 'var(--text-primary, #fff)',
      padding: '2rem 1rem'
    }}>
      {/* Header */}
      <header style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        maxWidth: '900px',
        margin: '0 auto 2rem',
        paddingBottom: '1rem',
        borderBottom: '1px solid var(--glass-border, rgba(255,255,255,0.1))'
      }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect x="4" y="4" width="10" height="10" rx="2" fill="url(#mosaicGrad2)" />
            <rect x="18" y="4" width="10" height="10" rx="2" fill="url(#mosaicGrad2)" opacity="0.8" />
            <rect x="4" y="18" width="10" height="10" rx="2" fill="url(#mosaicGrad2)" opacity="0.8" />
            <rect x="18" y="18" width="10" height="10" rx="2" fill="url(#mosaicGrad2)" opacity="0.6" />
            <defs>
              <linearGradient id="mosaicGrad2" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#9B51E0" />
                <stop offset="100%" stopColor="#7B3FC0" />
              </linearGradient>
            </defs>
          </svg>
          <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '1.5rem', color: 'var(--text-primary)' }}>MOSAIC</span>
        </Link>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <Link to="/login" style={{ color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.9rem' }}>Login</Link>
          <Link to="/register" style={{ color: 'var(--accent, #9B51E0)', textDecoration: 'none', fontSize: '0.9rem', fontWeight: 600 }}>Register</Link>
        </div>
      </header>

      {/* Main Content */}
      <div style={{ maxWidth: '700px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
            How can we help?
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>
            Find answers to common questions about Mosaic
          </p>
        </div>

        {/* Search */}
        <div style={{ marginBottom: '2rem' }}>
          <input
            type="text"
            placeholder="Search for answers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '1rem 1.25rem',
              fontSize: '1rem',
              borderRadius: '12px',
              border: '1px solid var(--glass-border, rgba(255,255,255,0.1))',
              background: 'var(--glass-bg, rgba(255,255,255,0.05))',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
        </div>

        {/* Quick Links */}
        {!searchQuery && (
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '2rem', justifyContent: 'center' }}>
            <Link
              to="/register"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.75rem 1.25rem',
                background: 'var(--brand-primary, #9B51E0)',
                color: 'white',
                borderRadius: '8px',
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: '0.9rem'
              }}
            >
              Create Account
            </Link>
            <Link
              to="/forgot-password"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.75rem 1.25rem',
                background: 'rgba(155, 81, 224, 0.1)',
                border: '1px solid rgba(155, 81, 224, 0.3)',
                color: 'var(--text-primary)',
                borderRadius: '8px',
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: '0.9rem'
              }}
            >
              Reset Password
            </Link>
          </div>
        )}

        {/* FAQs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filteredFAQs.map((faq, index) => {
            const isExpanded = expandedItem === index;
            
            return (
              <div
                key={index}
                style={{
                  background: 'var(--glass-bg, rgba(255,255,255,0.05))',
                  border: '1px solid var(--glass-border, rgba(255,255,255,0.1))',
                  borderRadius: '12px',
                  overflow: 'hidden',
                }}
              >
                <button
                  onClick={() => toggleItem(index)}
                  style={{
                    width: '100%',
                    padding: '1rem 1.25rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  <h3 style={{
                    fontSize: '1rem',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    margin: 0
                  }}>
                    {faq.question}
                  </h3>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--text-secondary)"
                    strokeWidth="2"
                    style={{
                      transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s',
                      flexShrink: 0,
                      marginLeft: '1rem'
                    }}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {isExpanded && (
                  <div style={{
                    padding: '0 1.25rem 1.25rem',
                    borderTop: '1px solid var(--glass-border, rgba(255,255,255,0.1))',
                    marginTop: '0.5rem',
                    paddingTop: '1rem'
                  }}>
                    <p style={{
                      color: 'var(--text-secondary)',
                      lineHeight: 1.6,
                      fontSize: '0.95rem',
                      margin: 0
                    }}>
                      {faq.answer}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {searchQuery && filteredFAQs.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
            <p>No results found for "{searchQuery}"</p>
          </div>
        )}

        {/* Contact */}
        <div style={{
          marginTop: '3rem',
          padding: '2rem',
          background: 'linear-gradient(135deg, rgba(155, 81, 224, 0.1) 0%, rgba(123, 63, 192, 0.1) 100%)',
          borderRadius: '12px',
          border: '1px solid rgba(155, 81, 224, 0.2)',
          textAlign: 'center'
        }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
            Still have questions?
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 0 }}>
            Reach out to your organization administrator for help with access or account issues.
          </p>
        </div>
      </div>

      {/* Footer */}
      <footer style={{ 
        textAlign: 'center', 
        marginTop: '4rem', 
        paddingTop: '2rem',
        borderTop: '1px solid var(--glass-border, rgba(255,255,255,0.1))',
        color: 'var(--text-secondary)',
        fontSize: '0.85rem'
      }}>
        <p>© 2026 Mosaic. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default PublicHelpPage;
