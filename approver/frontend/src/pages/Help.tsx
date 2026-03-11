import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

interface FAQItem {
  question: string;
  answer: string;
  category: string;
}

const faqData: FAQItem[] = [
  // Getting Started
  {
    category: 'Getting Started',
    question: 'How do I get started with Approver?',
    answer: 'After logging in, you can start by creating a new initiative. Click the "New Initiative" button on the Dashboard or Initiatives page. Fill in the required details including title, description, department, expected impact, and resource requirements, then submit for approval.'
  },
  {
    category: 'Getting Started',
    question: 'What are the default login credentials?',
    answer: 'The default admin credentials are: Email: admin@approver.com, Password: password123. Note: Change the default password immediately after first login for security!'
  },
  {
    category: 'Getting Started',
    question: 'How do I create a new organization?',
    answer: 'If you have Admin privileges, go to the Organization page from the sidebar. Click "Create New Organization" and fill in the organization details including name and description. You can then invite members to join.'
  },

  // User Management
  {
    category: 'User Management',
    question: 'How do I invite new users?',
    answer: 'Navigate to the Invites page from the sidebar. Click "Send Invite", enter the user\'s email address, select their department and role, and click Send. The user will receive an email with instructions to join.'
  },
  {
    category: 'User Management',
    question: 'What roles are available?',
    answer: 'Available roles include: Admin (full system access), Manager (approve/reject initiatives), User (submit and view own initiatives), scoring.manage (manage scoring policies), rules.manage (manage approval rules), and projects.override (override project decisions).'
  },
  {
    category: 'User Management',
    question: 'How do I reset my password?',
    answer: 'On the login page, click "Forgot Password", enter your registered email, and check your email for the reset link. Create a new password to regain access.'
  },

  // Initiatives
  {
    category: 'Initiatives',
    question: 'How do I submit a new initiative?',
    answer: 'Click "New Initiative" on the Dashboard or Initiatives page. Fill in: Title, Description, Department, Expected Impact, Resource Requirements (budget, personnel, timeline). Submit for AI analysis and approval workflow.'
  },
  {
    category: 'Initiatives',
    question: 'What are the initiative statuses?',
    answer: 'Statuses include: Draft (created but not submitted), Pending Review (waiting for review), In Review (being evaluated), Approved (approved for implementation), Rejected (not approved), and Deferred (on hold).'
  },
  {
    category: 'Initiatives',
    question: 'How does AI scoring work?',
    answer: 'The AI analyzes initiatives based on: alignment with organizational goals, resource feasibility, risk assessment, expected ROI, and strategic fit. Scores are generated using configurable scoring policies that Admins can adjust.'
  },
  {
    category: 'Initiatives',
    question: 'Can I use Approver without AI features?',
    answer: 'Yes! Approver works without AI. You can submit and approve initiatives manually, use basic scoring, or skip AI analysis entirely. The system functions with or without AI capabilities.'
  },

  // Governance Rules
  {
    category: 'Governance',
    question: 'How do I create approval rules?',
    answer: 'Go to the Rules page, click "Add Rule". Define trigger conditions (department, project type), required approvals, and auto-approval thresholds. Save the rule to activate it.'
  },
  {
    category: 'Governance',
    question: 'What are system rules vs. custom rules?',
    answer: 'System Rules are built-in governance rules managed by Admins. Custom Rules are organization-specific rules that users with rules.manage permission can create and modify.'
  },
  {
    category: 'Governance',
    question: 'How do I manage scoring policies?',
    answer: 'Users with scoring.manage role can access the Scoring Policy page. Adjust weights for different criteria like strategic alignment, risk, ROI, and resource feasibility to customize how initiatives are evaluated.'
  },

  // Technical
  {
    category: 'Technical',
    question: 'Why am I getting a 401 Unauthorized error?',
    answer: 'This usually means: (1) Your token has expired - log in again, (2) Missing Authorization header, (3) Insufficient role permissions for the endpoint, or (4) Wrong organization context. Try logging out and back in.'
  },
  {
    category: 'Technical',
    question: 'The AI analysis is not working - what should I check?',
    answer: 'Verify: (1) OPENAI_API_KEY is configured by your admin, (2) You have sufficient credits, (3) The initiative meets minimum requirements. Contact your administrator if issues persist.'
  },
  {
    category: 'Technical',
    question: 'How do I configure email notifications?',
    answer: 'Email configuration is managed at the system level by administrators. If you\'re not receiving emails (for invites, OTP, etc.), check your spam folder or contact your admin to verify SMTP settings.'
  }
];

const HelpPage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategory, setExpandedCategory] = useState<string | null>('Getting Started');
  const [expandedItem, setExpandedItem] = useState<number | null>(null);
  const location = useLocation();

  const categories = [...new Set(faqData.map(faq => faq.category))];

  const filteredFAQs = searchQuery
    ? faqData.filter(faq => 
        faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
        faq.answer.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : faqData;

  const getFAQsByCategory = (category: string) => filteredFAQs.filter(faq => faq.category === category);

  const toggleCategory = (category: string) => {
    setExpandedCategory(expandedCategory === category ? null : category);
  };

  const toggleItem = (index: number) => {
    setExpandedItem(expandedItem === index ? null : index);
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1rem' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
          Help & FAQ
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>
          Find answers to common questions about using Approver
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
            border: '1px solid var(--glass-border)',
            background: 'var(--glass-bg)',
            color: 'var(--text-primary)',
            outline: 'none',
            transition: 'border-color 0.2s, box-shadow 0.2s'
          }}
        />
      </div>

      {/* Quick Links */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
        <Link
          to="/analyze?tab=new"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.75rem 1.25rem',
            background: 'var(--brand-primary)',
            color: 'white',
            borderRadius: '8px',
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: '0.9rem'
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Initiative
        </Link>
        <Link
          to="/rules"
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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
          View Rules
        </Link>
        <Link
          to="/invites"
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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
          Invite Users
        </Link>
      </div>

      {/* FAQ Categories */}
      {!searchQuery && (
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          {categories.map(category => (
            <button
              key={category}
              onClick={() => toggleCategory(category)}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '20px',
                border: expandedCategory === category 
                  ? '1px solid var(--brand-primary)' 
                  : '1px solid var(--glass-border)',
                background: expandedCategory === category 
                  ? 'rgba(155, 81, 224, 0.15)' 
                  : 'transparent',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: 500,
                transition: 'all 0.2s'
              }}
            >
              {category}
            </button>
          ))}
        </div>
      )}

      {/* Search Results */}
      {searchQuery && (
        <div style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          Found {filteredFAQs.length} result{filteredFAQs.length !== 1 ? 's' : ''}
        </div>
      )}

      {/* FAQ Items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {(searchQuery ? filteredFAQs : categories.flatMap(cat => getFAQsByCategory(cat))).map((faq, index) => {
          const actualIndex = faqData.indexOf(faq);
          const isExpanded = expandedItem === actualIndex;
          
          return (
            <div
              key={actualIndex}
              style={{
                background: 'var(--glass-bg)',
                border: '1px solid var(--glass-border)',
                borderRadius: '12px',
                overflow: 'hidden',
                transition: 'border-color 0.2s'
              }}
            >
              <button
                onClick={() => toggleItem(actualIndex)}
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
                <div>
                  <span style={{
                    fontSize: '0.7rem',
                    color: 'var(--brand-primary)',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    {faq.category}
                  </span>
                  <h3 style={{
                    fontSize: '1rem',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    marginTop: '0.25rem'
                  }}>
                    {faq.question}
                  </h3>
                </div>
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
                  borderTop: '1px solid var(--glass-border)',
                  marginTop: '0.5rem',
                  paddingTop: '1rem'
                }}>
                  <p style={{
                    color: 'var(--text-secondary)',
                    lineHeight: 1.6,
                    fontSize: '0.95rem'
                  }}>
                    {faq.answer}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* No Results */}
      {searchQuery && filteredFAQs.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '3rem',
          color: 'var(--text-secondary)'
        }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto 1rem', opacity: 0.5 }}>
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <p>No results found for "{searchQuery}"</p>
          <p style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>
            Try different keywords or browse categories above
          </p>
        </div>
      )}

      {/* Contact Support */}
      <div style={{
        marginTop: '3rem',
        padding: '1.5rem',
        background: 'linear-gradient(135deg, rgba(155, 81, 224, 0.1) 0%, rgba(123, 63, 192, 0.1) 100%)',
        borderRadius: '12px',
        border: '1px solid rgba(155, 81, 224, 0.2)',
        textAlign: 'center'
      }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
          Still have questions?
        </h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
          Contact your administrator or the support team for additional help
        </p>
        <a
          href="mailto:support@approver.aiinigeria.com"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.75rem 1.5rem',
            background: 'var(--brand-primary)',
            color: 'white',
            borderRadius: '8px',
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: '0.9rem'
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
          Contact Support
        </a>
      </div>
    </div>
  );
};

export default HelpPage;
