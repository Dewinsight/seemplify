# Approver Documentation

Welcome to the Approver application documentation. This section provides comprehensive guides, FAQs, and technical documentation for the Approver initiative approval system.

## Quick Navigation

| Section | Description |
|---------|-------------|
| [Getting Started](#getting-started) | Quick start guide and overview |
| [FAQ](#faq) | Frequently asked questions |
| [Architecture](#architecture) | System architecture and design |
| [API Reference](./api/README.md) | Complete API documentation |
| [Deployment](./deployment/README.md) | Deployment guides |
| [Troubleshooting](./troubleshooting/README.md) | Common issues and solutions |

---

## Getting Started

### What is Approver?

Approver is a multi-tenant initiative and project approval system that helps organizations manage the review and approval workflow for new projects, initiatives, and proposals. It provides:

- **Multi-tenant architecture** - Support for multiple organizations with isolated data
- **Role-based access control** - Granular permissions for different user roles
- **AI-Powered Analysis** - Intelligent scoring and evaluation of initiatives
- **Workflow Management** - Configurable approval workflows and policies
- **Governance Rules** - Define and manage governance policies

### Tech Stack

| Layer | Technology |
|-------|-------------|
| Frontend | React + TypeScript + Vite |
| Backend | Node.js + Express |
| Database | MongoDB |
| Vector Store | Weaviate (for AI grounding) |
| Authentication | JWT with OTP |
| Deployment | Docker + Dokploy |

### Prerequisites

- Node.js 18+
- MongoDB instance
- Weaviate instance (optional, for AI features)
- Docker & Docker Compose

---

## FAQ

### General Questions

#### Q: How do I get started with Approver?

1. **For Local Development:**
   ```bash
   # Clone the repository
   git clone https://github.com/michaelegbo/seemplify.git
   
   # Navigate to approver directory
   cd approver
   
   # Install backend dependencies
   cd backend && npm install
   
   # Install frontend dependencies
   cd ../frontend && npm install
   
   # Set up environment variables (see .env.example)
   cp backend/.env.example backend/.env
   
   # Start backend
   cd backend && npm run dev
   
   # Start frontend (in another terminal)
   cd frontend && npm run dev
   ```

2. **For Production Deployment:**
   See the [Deployment Guide](./deployment/README.md)

---

#### Q: What are the default login credentials?

After seeding the admin user:
- **Email:** `admin@approver.com`
- **Password:** `password123`

> **Security Note:** Change the default password immediately after first login!

---

#### Q: How do I create a new organization?

1. Log in as an Admin user
2. Navigate to Organization Settings
3. Click "Create New Organization"
4. Fill in the organization details (name, description, etc.)
5. Set up departments within the organization

---

### User Management

#### Q: How do I invite new users?

1. Go to **Admin Panel** → **Users**
2. Click **Invite User**
3. Enter the user's email address
4. Select the department and role
5. The user will receive an email with instructions to join

---

#### Q: What roles are available?

| Role | Permissions |
|------|-------------|
| `Admin` | Full system access, user management |
| `Manager` | Approve/reject initiatives, manage departments |
| `User` | Submit and view own initiatives |
| `scoring.manage` | Manage scoring policies |
| `rules.manage` | Manage approval rules |
| `projects.override` | Override project decisions |

---

### Initiatives & Projects

#### Q: How do I submit a new initiative?

1. Log in to the Approver dashboard
2. Click **New Initiative** button
3. Fill in the initiative details:
   - Title and description
   - Department
   - Expected impact
   - Resource requirements
   - Timeline
4. Submit for approval
5. Track status in your dashboard

---

#### Q: What are the initiative statuses?

| Status | Description |
|--------|-------------|
| `Draft` | Initiative created but not submitted |
| `Pending Review` | Submitted and waiting for review |
| `In Review` | Being evaluated by reviewers |
| `Approved` | Approved for implementation |
| `Rejected` | Not approved |
| `Deferred` | Put on hold for future consideration |

---

#### Q: How does AI scoring work?

The system uses AI to analyze initiatives based on:
- Alignment with organizational goals
- Resource feasibility
- Risk assessment
- Expected ROI
- Strategic fit

Scores are generated using configurable scoring policies that can be adjusted by users with `scoring.manage` role.

---

### Governance Rules

#### Q: How do I create approval rules?

1. Navigate to **Governance** → **Rules**
2. Click **Add Rule**
3. Define the rule conditions:
   - Trigger conditions (department, project type, etc.)
   - Required approvals
   - Auto-approval thresholds
4. Save the rule

---

#### Q: What are system rules vs. custom rules?

| Type | Description | Manageable By |
|------|-------------|----------------|
| **System Rules** | Built-in governance rules | Admin only (bulk update) |
| **Custom Rules** | Organization-specific rules | Users with `rules.manage` role |

---

### Technical Questions

#### Q: How do I configure the environment variables?

Create a `.env` file in the `backend` directory with these variables:

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/approver

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# OpenAI (for AI features)
OPENAI_API_KEY=sk-...

# Weaviate (optional, for vector storage)
WEAVIATE_URL=http://localhost:8080
WEAVIATE_API_KEY=your-weaviate-key

# Email (for invites/notifications)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user@example.com
SMTP_PASS=password
EMAIL_FROM=noreply@approver.com

# Frontend URL (for email links)
FRONTEND_URL=http://localhost:5173
```

---

#### Q: How do I enable AI-powered analysis?

1. Obtain an OpenAI API key
2. Add it to your environment variables: `OPENAI_API_KEY`
3. Optionally configure Weaviate for enhanced grounding
4. The AI analysis will be available when submitting initiatives

---

#### Q: Can I use Approver without AI features?

Yes! Approver works without AI features. You can:
- Submit and approve initiatives manually
- Use basic scoring (manual scores)
- Skip AI analysis entirely

---

### Deployment

#### Q: How do I deploy Approver to production?

See the comprehensive [Deployment Guide](./deployment/README.md) for:

- Docker-based deployment
- Dokploy deployment
- Domain and SSL configuration
- Database setup

---

#### Q: What are the domain configurations?

| Service | Domain | Description |
|---------|--------|-------------|
| Frontend | `approver.aiinigeria.com` | Main web interface |
| Backend API | `api.approver.aiinigeria.com` | REST API endpoint |

---

### Troubleshooting

#### Q: I'm getting a 401 Unauthorized error

- Check if your JWT token has expired
- Verify the token is included in the request header
- Ensure you have the required role for the endpoint

---

#### Q: The AI analysis is not working

1. Verify `OPENAI_API_KEY` is set correctly
2. Check Weaviate connection (if configured)
3. Review backend logs for errors
4. Ensure the initiative meets minimum requirements for analysis

---

#### Q: How do I reset my password?

1. On the login page, click **Forgot Password**
2. Enter your registered email
3. Check your email for the reset link
4. Create a new password

---

#### Q: Where can I find the logs?

| Environment | Location |
|-------------|----------|
| Local Development | Terminal output |
| Docker | `docker logs <container_id>` |
| Dokploy | Dashboard → Application → Logs |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Approver System                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐       ┌──────────────────┐              │
│  │    Frontend      │       │     Backend      │              │
│  │   (React/Vite)   │ ←──→  │  (Express/Node)  │              │
│  │   Port 5173      │       │    Port 5000     │              │
│  └──────────────────┘       └────────┬─────────┘              │
│                                      │                          │
│                     ┌────────────────┼────────────────┐        │
│                     │                │                │        │
│              ┌──────▼──────┐  ┌─────▼─────┐  ┌─────▼─────┐   │
│              │  MongoDB    │  │  Weaviate │  │   OpenAI  │   │
│              │  Database   │  │  (Vectors)│  │    API    │   │
│              └─────────────┘  └───────────┘  └───────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

- **Frontend**: React SPA with TypeScript, manages UI and user interactions
- **Backend**: Express API handling business logic, authentication, and data management
- **MongoDB**: Primary database for storing organizations, users, projects, and rules
- **Weaviate**: Vector database for AI grounding and semantic search
- **OpenAI**: Power AI-powered initiative analysis and scoring

---

## Contributing

When contributing to Approver:

1. Follow the existing code style
2. Write tests for new features
3. Update documentation accordingly
4. Submit pull requests for review

---

## Support

For issues or questions:
- Check the [Troubleshooting Guide](./troubleshooting/README.md)
- Review existing GitHub issues
- Contact the development team

---

*Last Updated: March 2026*
