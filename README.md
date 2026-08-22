# Semplify

A comprehensive HR Management System suite built with modern web technologies. Semplify integrates multiple HR functions into a unified platform for efficient workforce management.

## 🌟 Overview

Semplify is a modular HR management platform consisting of interconnected applications that handle various aspects of human resources operations:

- **Recruiting** - End-to-end recruitment workflow management
- **Leave Management** - Employee leave requests, approvals, and balance tracking
- **Performance Management** - Employee performance reviews, feedback, and goal tracking
- **Payroll Management** - Compensation, payroll processing, and payslip generation
- **Identity Provider** - Centralized authentication and SSO management

## 🏗️ Architecture

### Technology Stack

| Component | Technology | Purpose |
|-----------|-------------|----------|
| **Frontend Framework** | Next.js 14+ | React-based UI with App Router |
| **UI Components** | Tailwind CSS | Modern, responsive styling |
| **Backend Framework** | Express.js | RESTful API services |
| **Database** | MongoDB | Data persistence |
| **Authentication** | NextAuth.js | Session management |
| **Real-time Updates** | WebSockets | Live notifications |
| **File Storage** | Local/Cloud | CV and document uploads |
| **AI Integration** | Azure OpenAI | Intelligent document processing |
| **Deployment** | Netlify/Vercel | Frontend hosting |

### Microservices Architecture

Each HR function operates as an independent microservice with its own backend and frontend:

```
┌─────────────────────────────────────────────────────────────┐
│                    Semplify Platform                      │
├─────────────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────┐  ┌──────────────┐               │
│  │  Recruiter  │  │   Identity   │               │
│  │  (5000)     │  │   Provider   │               │
│  └──────┬──────┘  └──────┬───────┘               │
│         │                │                          │
│  ┌──────▼────────────▼───────┐               │
│  │   Shared Services          │               │
│  │   - MongoDB DB           │               │
│  │   - Auth/SSO            │               │
│  │   - File Storage         │               │
│  └───────────────────────────┘               │
│         │                                        │
│  ┌──────▼─────────────────────▼───────┐    │
│  │          Leave Management        │    │
│  │          (5003)                 │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │       Performance              │    │
│  │       (5005)                │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │         Payroll              │    │
│  │         (5007)              │    │
│  └─────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

## 📦 Applications

### 1. Recruiter (`recruiter/`)
End-to-end recruitment management system with AI-powered CV processing.

**Features:**
- Job posting and management
- Candidate application tracking
- AI-powered CV parsing and analysis
- Candidate matching and scoring
- Interview scheduling
- Automated email notifications
- CV generation from candidate data
- File upload and document management

**Ports:**
- Frontend: `5000`
- Backend: Configured in `.env`

**Key Integrations:**
- Azure OpenAI for CV analysis
- Email service for notifications

### 2. Leave Management (`leave-management/`)
Comprehensive leave request and approval system.

**Features:**
- Leave request submission
- Manager approval workflow
- Leave balance tracking
- Holiday calendar integration
- Team leave overview
- Real-time status updates
- WebSocket notifications
- Leave policy management

**Ports:**
- Frontend: `5003`
- Backend: Configured in `.env`

**Capabilities:**
- Multiple leave types (annual, sick, personal, etc.)
- Carry-over balance calculation
- Team leave visibility
- Approval routing

### 3. Performance Management (`performance/`)
Employee performance evaluation and development tracking.

**Features:**
- Performance review cycles
- 360-degree feedback collection
- OKR (Objectives and Key Results) tracking
- One-on-one meeting scheduling
- Development goal setting
- Performance analytics and reporting
- Team performance dashboards
- Training and development recommendations

**Ports:**
- Frontend: `5005`
- Backend: Configured in `.env`

**Components:**
- Appraisal cycles
- Feedback collection
- Goal tracking
- AI-powered insights

### 4. Payroll (`payroll/`)
Complete payroll processing and compensation management.

**Features:**
- Employee compensation management
- Payroll processing engine
- Automated payslip generation
- Tax calculations
- Integration with leave balances
- Performance-based compensation
- Payroll history and reporting
- Multi-currency support

**Ports:**
- Frontend: `5007`
- Backend: Configured in `.env`

**Integrations:**
- Leave management (balance deductions)
- Performance (bonus calculations)
- Tax calculation service

### 5. Identity Provider (`Identityprovider/`)
Centralized authentication and single sign-on (SSO) service.

**Features:**
- User authentication and authorization
- SSO implementation
- Organization management
- Team and role management
- Session management
- OAuth 2.0 support
- User profile management
- Invitation system

**Configuration:**
- Port configured in `.env`
- Supports multiple authentication providers

## 🚀 Quick Start

### Prerequisites

- **Node.js** >= 18.0.0
- **MongoDB** (local instance or cloud connection)
- **Git** for version control
- **PowerShell** (Windows) or Bash (Unix)

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/Dewinsight/seemplify.git
cd seemplify
```

2. **Install all dependencies**
```bash
npm run install:all
```

3. **Configure environment variables**

Create `.env` files in each application directory. Use the provided `.env.example` files as templates:

```bash
# Example for recruiter backend
cd recruiter/backend
cp .env.example .env
# Edit .env with your configuration
```

Required environment variables include:
- Database connection strings (MongoDB)
- API keys (Azure OpenAI, email services)
- JWT secrets
- Port configurations

4. **Start MongoDB**

Ensure MongoDB is running locally or update connection strings to use a cloud instance.

5. **Start all applications**

```bash
npm start
```

This will start all 9 applications (5 backends + 4 frontends) in separate windows.

## 🎯 Development

### Running Applications

#### Start All Applications
```bash
npm start
```

#### Start Specific Applications

**Backends:**
```bash
npm run start:identityprovider      # Identity Provider
npm run start:leave-backend        # Leave Management Backend
npm run start:payroll-backend      # Payroll Backend
npm run start:performance-backend   # Performance Backend
npm run start:recruiter-backend    # Recruiter Backend
```

**Frontends:**
```bash
npm run start:leave-frontend       # Leave Management (Port 5003)
npm run start:payroll-frontend      # Payroll (Port 5007)
npm run start:performance-frontend # Performance (Port 5005)
npm run start:recruiter-frontend   # Recruiter (Port 5000)
```

**All Backends:**
```bash
npm run start:backends
```

**All Frontends:**
```bash
npm run start:frontends
```

### Access URLs

| Application | URL | Port |
|-------------|-----|-------|
| Recruiter | http://localhost:5000 | 5000 |
| Leave Management | http://localhost:5003 | 5003 |
| Performance | http://localhost:5005 | 5005 |
| Payroll | http://localhost:5007 | 5007 |

### Stopping Applications

```bash
npm run stop:node    # Stop all Node.js processes
```

### Available Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start all applications |
| `npm run start:dev` | Start all applications (dev mode) |
| `npm run start:backends` | Start all backend services |
| `npm run start:frontends` | Start all frontend apps |
| `npm run start:<app>` | Start specific application |
| `npm run stop:node` | Stop all Node.js services |
| `npm run restart` | Restart all applications |
| `npm run install:all` | Install all dependencies |
| `npm run logs` | Show running processes |
| `npm run status` | Display application URLs |
| `npm run clean` | Clean temporary files |
| `npm run help` | Show command help |

For detailed command documentation, see [NPM-COMMANDS.md](./NPM-COMMANDS.md)

## 🔧 Configuration

### Environment Variables

Each application requires a `.env` file. Template files (`.env.example`) are provided in each directory.

**Never commit `.env` files to version control!** They are included in `.gitignore`.

#### Common Variables

| Variable | Description | Example |
|-----------|-------------|----------|
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/seemplify` |
| `PORT` | Application port | `5000` |
| `NODE_ENV` | Environment | `development` / `production` |
| `JWT_SECRET` | JWT signing secret | `your-secret-key` |
| `NEXTAUTH_SECRET` | NextAuth secret | `your-nextauth-secret` |

#### Service-Specific Variables

**Recruiter Backend:**
```env
MONGODB_URI=mongodb://localhost:27017/seemplify_recruiter
PORT=5001
AZURE_OPENAI_API_KEY=your-azure-openai-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-4
EMAIL_SERVICE_API_KEY=your-email-api-key
```

**Leave Management Backend:**
```env
MONGODB_URI=mongodb://localhost:27017/seemplify_leave
PORT=5002
JWT_SECRET=your-jwt-secret
SESSION_SECRET=your-session-secret
```

**Performance Backend:**
```env
MONGODB_URI=mongodb://localhost:27017/seemplify_performance
PORT=5004
JWT_SECRET=your-jwt-secret
AZURE_OPENAI_API_KEY=your-azure-openai-key
```

**Payroll Backend:**
```env
MONGODB_URI=mongodb://localhost:27017/seemplify_payroll
PORT=5006
JWT_SECRET=your-jwt-secret
TAX_API_KEY=your-tax-api-key
```

**Identity Provider:**
```env
MONGODB_URI=mongodb://localhost:27017/seemplify_idp
PORT=5008
JWT_SECRET=your-jwt-secret
OAUTH_CLIENT_ID=your-client-id
OAUTH_CLIENT_SECRET=your-client-secret
```

### Database Setup

#### Local MongoDB

1. **Install MongoDB**
```bash
# Windows (Chocolatey)
choco install mongodb

# macOS (Homebrew)
brew install mongodb-community

# Linux
sudo apt-get install mongodb
```

2. **Start MongoDB**
```bash
# Windows
mongod --dbpath "C:\data\db"

# macOS/Linux
sudo systemctl start mongod
```

3. **Verify Connection**
```bash
mongosh
show dbs
```

#### Cloud MongoDB (MongoDB Atlas)

1. Create a free account at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a new cluster
3. Get connection string
4. Update `.env` files with your Atlas connection string

## 🌐 Deployment

### Frontend Deployment (Netlify/Vercel)

Each frontend can be deployed independently:

**Using Netlify CLI:**
```bash
cd <frontend-directory>
npm run build
netlify deploy --prod
```

**Using Vercel CLI:**
```bash
cd <frontend-directory>
npm run build
vercel --prod
```

### Backend Deployment (Render/Railway/Heroku)

**Render:**
1. Push code to GitHub
2. Create new web service on Render
3. Connect to your repository
4. Configure environment variables
5. Deploy

**Railway:**
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Update database connections to production URLs
- [ ] Configure CORS for production domains
- [ ] Set up SSL/TLS certificates
- [ ] Configure backup strategy
- [ ] Set up monitoring and logging
- [ ] Enable rate limiting
- [ ] Configure security headers
- [ ] Test all API endpoints
- [ ] Verify authentication flow

## 🧪 Testing

### Running Tests

```bash
# Run all tests
cd <app-directory>
npm test

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- <test-file>
```

### Test Coverage

Each application should maintain:
- Unit tests: >80% coverage
- Integration tests: Critical paths covered
- E2E tests: Main workflows covered

## 📊 Project Structure

```
seemplify/
├── Identityprovider/          # Identity Provider Service
│   ├── src/
│   │   ├── middleware/
│   │   ├── routes/
│   │   ├── services/
│   │   └── models/
│   └── .env.example
├── leave-management/         # Leave Management
│   ├── backend/
│   │   ├── middleware/
│   │   ├── routes/
│   │   ├── services/
│   │   └── models/
│   ├── frontend/
│   │   ├── app/
│   │   ├── components/
│   │   └── lib/
│   └── .env.local.example
├── payroll/                # Payroll Management
│   ├── backend/
│   │   ├── services/
│   │   │   ├── PayrollEngineService.js
│   │   │   ├── TaxCalculationService.js
│   │   │   └── LeaveIntegrationService.js
│   │   └── routes/
│   └── frontend/
├── performance/             # Performance Management
│   ├── backend/
│   │   ├── routes/
│   │   ├── services/
│   │   └── models/
│   └── frontend/
│       └── app/
├── recruiter/              # Recruitment System
│   ├── backend/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── middleware/
│   │   └── migrations/
│   └── frontend/
│       ├── app/
│       ├── components/
│       └── lib/
├── README.md              # This file
├── NPM-COMMANDS.md        # Command reference
├── START-APPS-README.md    # App startup guide
├── package.json            # Root workspace package
├── start-all.ps1           # Start all apps script
├── stop-all.ps1            # Stop all apps script
└── stop-services.ps1        # Stop services script
```

## 🤝 Contributing

We welcome contributions! Please follow these guidelines:

### Development Workflow

1. **Fork the repository**
2. **Create a feature branch**
```bash
git checkout -b feature/your-feature-name
```

3. **Make your changes**
   - Follow existing code style
   - Add tests for new features
   - Update documentation

4. **Commit your changes**
```bash
git commit -m "feat: add new feature"
# Use conventional commits:
# feat: new feature
# fix: bug fix
# docs: documentation
# style: formatting
# refactor: refactoring
# test: tests
# chore: build process
```

5. **Push to your fork**
```bash
git push origin feature/your-feature-name
```

6. **Create a Pull Request**

### Code Style

- Use ESLint and Prettier configurations
- Follow existing patterns
- Write meaningful commit messages
- Document complex logic

### Testing

- All tests must pass
- New features require tests
- Maintain code coverage

## 🐛 Troubleshooting

### Common Issues

#### Port Already in Use
```bash
# Find what's using the port
netstat -ano | findstr :<port>

# Stop the process or change port in .env
```

#### MongoDB Connection Failed
```bash
# Check if MongoDB is running
# Windows
Get-Process mongo

# macOS/Linux
ps aux | grep mongo

# Start MongoDB
mongod --dbpath "C:\data\db"
```

#### Module Not Found
```bash
# Install dependencies
npm run install:all

# Or for specific app
cd <app-directory>
npm install
```

#### Environment Variables Not Found
```bash
# Ensure .env file exists
ls -la .env

# Copy from example
cp .env.example .env

# Edit with required values
```

### Getting Help

- Check [NPM-COMMANDS.md](./NPM-COMMANDS.md) for command reference
- Check [START-APPS-README.md](./START-APPS-README.md) for startup guide
- Review application-specific README files
- Check logs in individual application windows

## 📝 Documentation

- [NPM-COMMANDS.md](./NPM-COMMANDS.md) - Complete command reference
- [START-APPS-README.md](./START-APPS-README.md) - Application startup guide
- `recruiter/README.md` - Recruiter-specific documentation
- `performance/README.md` - Performance-specific documentation

## 🔒 Security

### Best Practices

- **Never commit** `.env` files or secrets
- Use strong, unique secrets for each environment
- Enable HTTPS in production
- Implement rate limiting on public APIs
- Validate all user inputs
- Use parameterized database queries
- Keep dependencies updated
- Regular security audits

### Environment Variables Security

- Rotate secrets regularly
- Use different secrets for dev/staging/production
- Store secrets in secure vaults (e.g., HashiCorp Vault)
- Never log sensitive data
- Use read-only database users where possible

## 📄 License

ISC License - See LICENSE file for details

## 👥 Team

**Semplify Development Team**

A dedicated team building comprehensive HR management solutions.

## 📞 Support

For issues, questions, or contributions:

- **Issues**: [GitHub Issues](https://github.com/Dewinsight/seemplify/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Dewinsight/seemplify/discussions)

## 🗺️ Roadmap

### Planned Features

- [ ] Mobile applications (iOS/Android)
- [ ] Advanced analytics and reporting
- [ ] Integration with popular HRIS systems
- [ ] Time tracking module
- [ ] Benefits management
- [ ] Employee self-service portal
- [ ] Multi-tenant support
- [ ] Advanced AI features (resume matching, predictive analytics)

### In Progress

- [ ] Enhanced security features
- [ ] Performance optimizations
- [ ] Additional authentication providers

## 🎉 Acknowledgments

- Built with modern web technologies
- Inspired by enterprise HR systems
- Community feedback and contributions

---

**Version**: 1.0.0  
**Last Updated**: January 2026  
**Status**: 🟢 Active Development

For more information, visit [seemplify.com](https://seemplify.com) or contact support@seemplify.com
