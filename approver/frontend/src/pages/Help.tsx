import { useState } from 'react';
import { Link } from 'react-router-dom';

type TabType = 'faq' | 'help' | 'understand' | 'workflow' | 'roles' | 'ai' | 'steps';

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
  // Governance
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

// Deep dive content sections
const understandContent = (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
    <section>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-primary)' }}>
        What is Approver?
      </h2>
      <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: '1rem' }}>
        Approver is a comprehensive initiative approval and governance platform designed to help organizations 
        systematically evaluate, approve, and track projects and initiatives. It combines intelligent AI-powered 
        analysis with flexible workflow automation to ensure every initiative gets the scrutiny it deserves while 
        maintaining efficiency.
      </p>
    </section>

    <section>
      <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
        Core Problems We Solve
      </h3>
      <ul style={{ color: 'var(--text-secondary)', lineHeight: 1.8, paddingLeft: '1.5rem' }}>
        <li><strong>Ad-hoc decision making</strong> - Standardized evaluation criteria ensure consistent decisions</li>
        <li><strong>Lost initiatives</strong> - Complete audit trail and tracking from submission to completion</li>
        <li><strong>Resource misalignment</strong> - Clear visibility into budget, personnel, and timeline requirements</li>
        <li><strong>Governance gaps</strong> - Configurable rules enforce organizational policies automatically</li>
        <li><strong>Slow approvals</strong> - Automated workflows reduce bottlenecks and delays</li>
      </ul>
    </section>

    <section>
      <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
        Key Capabilities
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
        <div style={{ padding: '1.25rem', background: 'var(--glass-bg)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🏛️</div>
          <h4 style={{ fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Multi-Tenant Architecture</h4>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Support multiple organizations with complete data isolation and custom configurations.</p>
        </div>
        <div style={{ padding: '1.25rem', background: 'var(--glass-bg)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🤖</div>
          <h4 style={{ fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>AI-Powered Analysis</h4>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Intelligent scoring based on strategic alignment, feasibility, risk, and expected impact.</p>
        </div>
        <div style={{ padding: '1.25rem', background: 'var(--glass-bg)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>📋</div>
          <h4 style={{ fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Configurable Workflows</h4>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Define approval chains, conditions, and automatic actions based on initiative characteristics.</p>
        </div>
        <div style={{ padding: '1.25rem', background: 'var(--glass-bg)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>📊</div>
          <h4 style={{ fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Comprehensive Analytics</h4>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Track initiative performance, approval times, and outcomes with detailed dashboards.</p>
        </div>
      </div>
    </section>

    <section>
      <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
        How It All Fits Together
      </h3>
      <div style={{ padding: '1.5rem', background: 'linear-gradient(135deg, rgba(155, 81, 224, 0.1) 0%, rgba(123, 63, 192, 0.05) 100%)', borderRadius: '12px', border: '1px solid rgba(155, 81, 224, 0.2)' }}>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '1rem' }}>
          Approver works as a central hub where initiatives flow through a structured lifecycle:
        </p>
        <ol style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.5rem' }}>
          <li><strong>Submission</strong> - Users submit initiatives with detailed information</li>
          <li><strong>AI Analysis</strong> - The system analyzes the initiative against multiple criteria</li>
          <li><strong>Rule Evaluation</strong> - Governance rules determine required approvals</li>
          <li><strong>Workflow Execution</strong> - Initiatives move through approval stages</li>
          <li><strong>Decision & Tracking</strong> - Final decision recorded with full audit trail</li>
        </ol>
      </div>
    </section>
  </div>
);

const workflowContent = (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
    <section>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-primary)' }}>
        Understanding Workflows
      </h2>
      <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: '1rem' }}>
        Workflows define how initiatives move from submission to approval. They ensure the right people 
        review the right initiatives at the right time, while maintaining compliance with organizational policies.
      </p>
    </section>

    <section>
      <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
        Initiative Lifecycle
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {[
          { status: 'Draft', desc: 'Initiative created but not yet submitted. Can be edited and saved for later.', color: '#6b7280' },
          { status: 'Pending Review', desc: 'Submitted and waiting for initial review. Entered the approval workflow.', color: '#f59e0b' },
          { status: 'In Review', desc: 'Being actively evaluated by reviewers. May require additional information.', color: '#3b82f6' },
          { status: 'Approved', desc: 'Approved for implementation. Can proceed to execution phase.', color: '#10b981' },
          { status: 'Rejected', desc: 'Not approved. Feedback provided for resubmission or alternative approach.', color: '#ef4444' },
          { status: 'Deferred', desc: 'Put on hold for future consideration. Can be reconsidered later.', color: '#8b5cf6' }
        ].map((item) => (
          <div key={item.status} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', padding: '1rem', background: 'var(--glass-bg)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: item.color, marginTop: '6px', flexShrink: 0 }} />
            <div>
              <h4 style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>{item.status}</h4>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>

    <section>
      <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
        Approval Flow Types
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ padding: '1.25rem', background: 'var(--glass-bg)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
          <h4 style={{ fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Sequential Approval</h4>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Each approver reviews in order. One must approve before the next receives the request. Used when层级 approval is needed.</p>
        </div>
        <div style={{ padding: '1.25rem', background: 'var(--glass-bg)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
          <h4 style={{ fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Parallel Approval</h4>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Multiple approvers review simultaneously. All must approve (or a quorum) for the initiative to proceed.</p>
        </div>
        <div style={{ padding: '1.25rem', background: 'var(--glass-bg)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
          <h4 style={{ fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Automatic Approval</h4>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Based on rules, certain initiatives can auto-approve when they meet specific criteria (e.g., budget below threshold).</p>
        </div>
        <div style={{ padding: '1.25rem', background: 'var(--glass-bg)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
          <h4 style={{ fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>AI-Assisted Approval</h4>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>AI provides scoring and recommendations to help human approvers make better decisions faster.</p>
        </div>
      </div>
    </section>

    <section>
      <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
        Rule Triggers
      </h3>
      <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '1rem' }}>
        Rules can trigger based on various initiative characteristics:
      </p>
      <ul style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.5rem' }}>
        <li>Department or business unit</li>
        <li>Project type or category</li>
        <li>Budget range</li>
        <li>Timeline duration</li>
        <li>Number of personnel required</li>
        <li>Strategic alignment score</li>
        <li>Risk level</li>
      </ul>
    </section>
  </div>
);

const rolesContent = (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
    <section>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-primary)' }}>
        Roles & Permissions
      </h2>
      <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: '1rem' }}>
        Approver uses a role-based access control (RBAC) system that grants permissions based on user roles. 
        This ensures users can only access features and data appropriate to their responsibilities.
      </p>
    </section>

    <section>
      <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
        Core Roles
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {[
          { 
            role: 'Admin', 
            desc: 'Full system access. Can manage organizations, users, departments, rules, and all settings.',
            perms: ['Manage organizations', 'Manage users', 'Manage departments', 'Manage rules', 'View all initiatives', 'Override decisions', 'Configure scoring policies']
          },
          { 
            role: 'Manager', 
            desc: 'Can approve/reject initiatives within their department. May also submit initiatives.',
            perms: ['Submit initiatives', 'Approve/reject in department', 'View department initiatives', 'Manage department members']
          },
          { 
            role: 'User', 
            desc: 'Standard user. Can submit and view their own initiatives.',
            perms: ['Submit initiatives', 'View own initiatives', 'Track submission status']
          }
        ].map((item) => (
          <div key={item.role} style={{ padding: '1.25rem', background: 'var(--glass-bg)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
            <h4 style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem', color: 'var(--brand-primary)' }}>{item.role}</h4>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>{item.desc}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {item.perms.map((perm) => (
                <span key={perm} style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', background: 'rgba(155, 81, 224, 0.1)', borderRadius: '4px', color: 'var(--text-secondary)' }}>
                  {perm}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>

    <section>
      <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
        Granular Permissions
      </h3>
      <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '1rem' }}>
        Beyond core roles, Approver supports granular capability permissions:
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
        {[
          { cap: 'scoring.manage', desc: 'Configure scoring policies and weights' },
          { cap: 'rules.manage', desc: 'Create and edit approval rules' },
          { cap: 'rules.manage.system', desc: 'Modify system-wide rules' },
          { cap: 'projects.override', desc: 'Override project decisions' },
          { cap: 'projects.delete', desc: 'Delete initiatives' },
          { cap: 'users.invite', desc: 'Invite new users' }
        ].map((item) => (
          <div key={item.cap} style={{ padding: '1rem', background: 'var(--glass-bg)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
            <code style={{ fontSize: '0.85rem', color: 'var(--brand-primary)', fontWeight: 600 }}>{item.cap}</code>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>{item.desc}</p>
          </div>
        ))}
      </div>
    </section>

    <section>
      <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
        Organization Context
      </h3>
      <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        In multi-tenant mode, users belong to organizations. All actions are scoped to the current organization, 
        ensuring data isolation. Users can switch between organizations they belong to via the sidebar.
      </p>
    </section>
  </div>
);

const stepsContent = (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
    <section>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-primary)' }}>
        Step-by-Step Usage Guide
      </h2>
      <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: '1rem' }}>
        Follow this guide to get the most out of Approver for managing your initiatives.
      </p>
    </section>

    {/* Step 1 */}
    <section style={{ padding: '1.5rem', background: 'var(--glass-bg)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
        <div style={{ 
          width: '40px', height: '40px', borderRadius: '50%', background: 'var(--brand-primary)', 
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', 
          fontWeight: 700, fontSize: '1.2rem', flexShrink: 0 
        }}>1</div>
        <div>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
            Set Up Your Organization
          </h3>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '1rem' }}>
            If you're an Admin, start by configuring your organization:
          </p>
          <ol style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem' }}>
            <li>Go to the <strong style={{ color: 'var(--text-primary)' }}>Organization</strong> page from the sidebar</li>
            <li>Upload your organization logo for branding</li>
            <li>Configure organization settings (name, description)</li>
            <li>Create departments that align with your organizational structure</li>
          </ol>
        </div>
      </div>
    </section>

    {/* Step 2 */}
    <section style={{ padding: '1.5rem', background: 'var(--glass-bg)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
        <div style={{ 
          width: '40px', height: '40px', borderRadius: '50%', background: 'var(--brand-primary)', 
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', 
          fontWeight: 700, fontSize: '1.2rem', flexShrink: 0 
        }}>2</div>
        <div>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
            Invite Team Members
          </h3>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '1rem' }}>
            Build your team by inviting users:
          </p>
          <ol style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem' }}>
            <li>Navigate to <strong style={{ color: 'var(--text-primary)' }}>Invites</strong> in the sidebar</li>
            <li>Click <strong style={{ color: 'var(--text-primary)' }}>Send Invite</strong></li>
            <li>Enter the user's email address</li>
            <li>Assign them to a department</li>
            <li>Set their role (Admin, Manager, or User)</li>
            <li>Click Send - they'll receive an invitation email</li>
          </ol>
        </div>
      </div>
    </section>

    {/* Step 3 */}
    <section style={{ padding: '1.5rem', background: 'var(--glass-bg)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
        <div style={{ 
          width: '40px', height: '40px', borderRadius: '50%', background: 'var(--brand-primary)', 
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', 
          fontWeight: 700, fontSize: '1.2rem', flexShrink: 0 
        }}>3</div>
        <div>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
            Configure Governance Rules
          </h3>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '1rem' }}>
            Define how initiatives should be evaluated:
          </p>
          <ol style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem' }}>
            <li>Go to <strong style={{ color: 'var(--text-primary)' }}>Rules</strong> in the sidebar</li>
            <li>Click <strong style={{ color: 'var(--text-primary)' }}>Add Rule</strong> to create custom rules</li>
            <li>Set trigger conditions (department, budget, type, etc.)</li>
            <li>Define required approvals and approvers</li>
            <li>Set auto-approval thresholds if applicable</li>
            <li>Save and activate the rule</li>
          </ol>
        </div>
      </div>
    </section>

    {/* Step 4 */}
    <section style={{ padding: '1.5rem', background: 'var(--glass-bg)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
        <div style={{ 
          width: '40px', height: '40px', borderRadius: '50%', background: 'var(--brand-primary)', 
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', 
          fontWeight: 700, fontSize: '1.2rem', flexShrink: 0 
        }}>4</div>
        <div>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
            (Optional) Configure AI Scoring
          </h3>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '1rem' }}>
            If AI features are enabled, customize how initiatives are evaluated:
          </p>
          <ol style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem' }}>
            <li>Navigate to <strong style={{ color: 'var(--text-primary)' }}>Scoring Policy</strong> in the sidebar</li>
            <li>Adjust weights for each evaluation criterion</li>
            <li>Set minimum thresholds for auto-approval</li>
            <li>Save your scoring configuration</li>
          </ol>
        </div>
      </div>
    </section>

    {/* Step 5 */}
    <section style={{ padding: '1.5rem', background: 'var(--glass-bg)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
        <div style={{ 
          width: '40px', height: '40px', borderRadius: '50%', background: 'var(--brand-primary)', 
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', 
          fontWeight: 700, fontSize: '1.2rem', flexShrink: 0 
        }}>5</div>
        <div>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
            Submit Your First Initiative
          </h3>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '1rem' }}>
            Now you're ready to submit initiatives for approval:
          </p>
          <ol style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem' }}>
            <li>Click <strong style={{ color: 'var(--text-primary)' }}>New Initiative</strong> from the Dashboard</li>
            <li>Enter a clear, descriptive title</li>
            <li>Provide a detailed description of the initiative</li>
            <li>Select the appropriate department</li>
            <li>Explain the expected impact and value</li>
            <li>Detail resource requirements (budget, personnel, timeline)</li>
            <li>Submit for AI analysis and approval workflow</li>
          </ol>
        </div>
      </div>
    </section>

    {/* Step 6 */}
    <section style={{ padding: '1.5rem', background: 'var(--glass-bg)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
        <div style={{ 
          width: '40px', height: '40px', borderRadius: '50%', background: 'var(--brand-primary)', 
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', 
          fontWeight: 700, fontSize: '1.2rem', flexShrink: 0 
        }}>6</div>
        <div>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
            Review & Approve Initiatives
          </h3>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '1rem' }}>
            For Managers and Admins - review submitted initiatives:
          </p>
          <ol style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem' }}>
            <li>Go to <strong style={{ color: 'var(--text-primary)' }}>Initiatives</strong> to see all submissions</li>
            <li>Click on an initiative to view details</li>
            <li>Review the AI analysis and scoring</li>
            <li>Check all submitted information and attachments</li>
            <li>Approve, reject, or request changes</li>
            <li>Add feedback comments for the submitter</li>
          </ol>
        </div>
      </div>
    </section>

    {/* Step 7 */}
    <section style={{ padding: '1.5rem', background: 'var(--glass-bg)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
        <div style={{ 
          width: '40px', height: '40px', borderRadius: '50%', background: 'var(--brand-primary)', 
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', 
          fontWeight: 700, fontSize: '1.2rem', flexShrink: 0 
        }}>7</div>
        <div>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
            Track & Monitor
          </h3>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '1rem' }}>
            Use the Dashboard to monitor all initiative activity:
          </p>
          <ol style={{ color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: '1.25rem' }}>
            <li>View <strong style={{ color: 'var(--text-primary)' }}>Dashboard</strong> for overview statistics</li>
            <li>Track initiative status and progress</li>
            <li>Monitor approval times and bottlenecks</li>
            <li>Review analytics and trends</li>
            <li>Export reports as needed</li>
          </ol>
        </div>
      </div>
    </section>

    {/* Quick Reference */}
    <section>
      <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--text-primary)' }}>
        Quick Reference: What Can I Do?
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <div style={{ padding: '1rem', background: 'var(--glass-bg)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
          <h4 style={{ fontWeight: 600, color: 'var(--brand-primary)', marginBottom: '0.5rem' }}>As an Admin</h4>
          <ul style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', paddingLeft: '1rem', lineHeight: 1.6 }}>
            <li>Manage organizations</li>
            <li>Invite & manage users</li>
            <li>Create departments</li>
            <li>Configure rules</li>
            <li>Set scoring policies</li>
            <li>Override decisions</li>
          </ul>
        </div>
        <div style={{ padding: '1rem', background: 'var(--glass-bg)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
          <h4 style={{ fontWeight: 600, color: 'var(--brand-primary)', marginBottom: '0.5rem' }}>As a Manager</h4>
          <ul style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', paddingLeft: '1rem', lineHeight: 1.6 }}>
            <li>Submit initiatives</li>
            <li>Approve/reject in dept</li>
            <li>View department reports</li>
            <li>Request changes</li>
          </ul>
        </div>
        <div style={{ padding: '1rem', background: 'var(--glass-bg)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
          <h4 style={{ fontWeight: 600, color: 'var(--brand-primary)', marginBottom: '0.5rem' }}>As a User</h4>
          <ul style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', paddingLeft: '1rem', lineHeight: 1.6 }}>
            <li>Submit initiatives</li>
            <li>View own submissions</li>
            <li>Track status</li>
            <li>Resubmit if rejected</li>
          </ul>
        </div>
      </div>
    </section>
  </div>
);

const aiContent = (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
    <section>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-primary)' }}>
        AI-Powered Analysis
      </h2>
      <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: '1rem' }}>
        Approver leverages artificial intelligence to provide objective, consistent analysis of initiatives. 
        This helps decision-makers understand strengths, weaknesses, and risks before committing resources.
      </p>
    </section>

    <section>
      <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
        How AI Analysis Works
      </h3>
      <div style={{ padding: '1.5rem', background: 'var(--glass-bg)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
        <ol style={{ color: 'var(--text-secondary)', lineHeight: 2.2, paddingLeft: '1.5rem' }}>
          <li><strong>Data Extraction</strong> - The system extracts key information from the initiative (title, description, budget, timeline, etc.)</li>
          <li><strong>Context Loading</strong> - Relevant governance rules and organizational goals are loaded as context</li>
          <li><strong>Multi-Criteria Evaluation</strong> - The AI evaluates against multiple dimensions (see below)</li>
          <li><strong>Score Generation</strong> - A composite score is calculated based on configured weights</li>
          <li><strong>Insight Generation</strong> - Strengths, weaknesses, and recommendations are generated</li>
        </ol>
      </div>
    </section>

    <section>
      <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
        Evaluation Criteria
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {[
          { name: 'Strategic Alignment', desc: 'How well the initiative supports organizational goals and priorities' },
          { name: 'Resource Feasibility', desc: 'Whether the required budget, personnel, and timeline are realistic' },
          { name: 'Risk Assessment', desc: 'Identification of potential risks and mitigation strategies' },
          { name: 'Expected ROI', desc: 'Projected return on investment and value creation' },
          { name: 'Operational Impact', desc: 'Effect on existing operations and required changes' },
          { name: 'Compliance Fit', desc: 'Alignment with regulatory requirements and internal policies' }
        ].map((item) => (
          <div key={item.name} style={{ padding: '1rem', background: 'var(--glass-bg)', borderRadius: '8px', border: '1px solid var(--glass-border)', display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--brand-primary)', flexShrink: 0 }} />
            <div>
              <h4 style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>{item.name}</h4>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>

    <section>
      <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
        Scoring Weights
      </h3>
      <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '1rem' }}>
        Admins can adjust how much each criterion contributes to the final score via the Scoring Policy page. 
        This allows organizations to prioritize what matters most to them.
      </p>
      <div style={{ padding: '1.25rem', background: 'rgba(155, 81, 224, 0.1)', borderRadius: '12px', border: '1px solid rgba(155, 81, 224, 0.2)' }}>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
          <strong style={{ color: 'var(--text-primary)' }}>Example:</strong> A startup might weight "Expected ROI" heavily, 
          while an enterprise might prioritize "Compliance Fit" and "Risk Assessment".
        </p>
        <Link to="/scoring-policy" style={{ color: 'var(--brand-primary)', fontWeight: 600, fontSize: '0.9rem' }}>
          → Configure Scoring Policy
        </Link>
      </div>
    </section>

    <section>
      <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
        Without AI
      </h3>
      <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        If AI features are disabled, initiatives can still be submitted and reviewed manually. Approvers 
        will need to evaluate criteria themselves, but all other features (workflows, rules, tracking) remain available.
      </p>
    </section>
  </div>
);

const HelpPage = () => {
  const [activeTab, setActiveTab] = useState<TabType>('faq');
  const [helpSubTab, setHelpSubTab] = useState<'understand' | 'workflow' | 'roles' | 'ai' | 'steps'>('understand');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategory, setExpandedCategory] = useState<string | null>('Getting Started');
  const [expandedItem, setExpandedItem] = useState<number | null>(null);

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

  const tabs: { id: TabType; label: string }[] = [
    { id: 'faq', label: 'FAQ' },
    { id: 'help', label: 'Help Guide' },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'help':
        return (
          <div>
            {/* Help Guide Sub-tabs */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
              <button
                onClick={() => setHelpSubTab('understand')}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  border: 'none',
                  background: helpSubTab === 'understand' ? 'rgba(155, 81, 224, 0.2)' : 'transparent',
                  color: helpSubTab === 'understand' ? 'var(--brand-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                }}
              >
                Overview
              </button>
              <button
                onClick={() => setHelpSubTab('workflow')}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  border: 'none',
                  background: helpSubTab === 'workflow' ? 'rgba(155, 81, 224, 0.2)' : 'transparent',
                  color: helpSubTab === 'workflow' ? 'var(--brand-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                }}
              >
                Workflows
              </button>
              <button
                onClick={() => setHelpSubTab('roles')}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  border: 'none',
                  background: helpSubTab === 'roles' ? 'rgba(155, 81, 224, 0.2)' : 'transparent',
                  color: helpSubTab === 'roles' ? 'var(--brand-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                }}
              >
                Roles
              </button>
              <button
                onClick={() => setHelpSubTab('ai')}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  border: 'none',
                  background: helpSubTab === 'ai' ? 'rgba(155, 81, 224, 0.2)' : 'transparent',
                  color: helpSubTab === 'ai' ? 'var(--brand-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                }}
              >
                AI Analysis
              </button>
              <button
                onClick={() => setHelpSubTab('steps')}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  border: 'none',
                  background: helpSubTab === 'steps' ? 'rgba(155, 81, 224, 0.2)' : 'transparent',
                  color: helpSubTab === 'steps' ? 'var(--brand-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                }}
              >
                Step-by-Step
              </button>
            </div>

            {helpSubTab === 'understand' && understandContent}
            {helpSubTab === 'workflow' && workflowContent}
            {helpSubTab === 'roles' && rolesContent}
            {helpSubTab === 'ai' && aiContent}
            {helpSubTab === 'steps' && stepsContent}
          </div>
        );
      default:
        return (
          <>
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
              {(searchQuery ? filteredFAQs : categories.flatMap(cat => getFAQsByCategory(cat))).map((faq) => {
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
          </>
        );
    }
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1rem' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
          Help & Documentation
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>
          Find answers and learn how Approver works
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem', overflowX: 'auto' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px 8px 0 0',
              border: 'none',
              background: activeTab === tab.id ? 'var(--brand-primary)' : 'transparent',
              color: activeTab === tab.id ? 'white' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '0.9rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              transition: 'all 0.2s'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {renderContent()}

      {/* Contact Support */}
      {activeTab === 'faq' && (
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
      )}
    </div>
  );
};

export default HelpPage;
