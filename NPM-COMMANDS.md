# NPM Commands - Semplify Workspace

This document provides a comprehensive guide to all available npm commands for managing the Semplify workspace.

## Quick Start

```bash
npm start          # Start all applications
npm stop           # Stop all applications
npm run status     # Show application URLs
```

## 🚀 Starting Applications

### Start All Applications
```bash
npm start
```
OR
```bash
npm run start:dev
```
Starts all 9 applications in separate PowerShell windows.

### Start Specific Applications

**Individual Backends:**
```bash
npm run start:identityprovider      # Identity Provider
npm run start:leave-backend        # Leave Management Backend
npm run start:payroll-backend      # Payroll Backend
npm run start:performance-backend   # Performance Backend
npm run start:recruiter-backend    # Recruiter Backend
```

**Individual Frontends:**
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
Starts all 5 backend services in separate windows.

**All Frontends:**
```bash
npm run start:frontends
```
Starts all 4 frontend applications in separate windows.

## 🛑 Stopping Applications

### Stop Workspace Applications (Info Only)
```bash
npm stop
```
Displays information about stopping workspace applications - shows you how to stop them (by closing windows or using stop:node).

### Show Workspace Status
```bash
npm run stop:workspace
```
Shows information about running workspace applications and how to stop them.

### Stop All Node.js Services
```bash
npm run stop:node
```
Stops **all** Node.js processes running on the system.

## 📊 Key Difference

| Command | What It Does | Stops Processes? |
|----------|---------------|-----------------|
| `npm stop` | Shows workspace apps info | ❌ No |
| `npm run stop:workspace` | Shows workspace apps status | ❌ No |
| `npm run stop:node` | Stops all Node.js services | ✅ Yes |

**Important**: `npm stop` and `npm run stop:workspace` are informational only. Use `npm run stop:node` to actually stop all Node.js services.

## 🔄 Restarting Applications

### Restart All
```bash
npm run restart
```
Stops all applications, waits 3 seconds, then starts them again.

## 📦 Installing Dependencies

### Install All Dependencies
```bash
npm run install:all
```
Installs dependencies for all applications in the workspace.

### Install Backend Dependencies Only
```bash
npm run install:backends
```
Installs dependencies for all 5 backend services.

### Install Frontend Dependencies Only
```bash
npm run install:frontends
```
Installs dependencies for all 4 frontend applications.

### Install Individual Application
```bash
cd <app-directory>
npm install
```

## 📊 Monitoring & Status

### Show Running Processes
```bash
npm run logs
```
Displays all running Node.js processes with their PIDs and paths.

### Show Application URLs
```bash
npm run status
```
Displays a clean list of all frontend URLs:
- Recruiter: http://localhost:5000
- Leave Management: http://localhost:5003
- Performance: http://localhost:5005
- Payroll: http://localhost:5007

## 🧹 Cleanup

### Clean Temporary Files
```bash
npm run clean
```
Removes temporary PowerShell scripts created during startup.

### Show Help
```bash
npm run help
```
Displays all available commands with descriptions.

## 📋 Complete Command Reference

| Command | Description |
|---------|-------------|
| `npm start` | Start all applications |
| `npm run start:dev` | Start all applications (development mode) |
| `npm run start:backends` | Start all 5 backend services |
| `npm run start:frontends` | Start all 4 frontend applications |
| `npm run start:identityprovider` | Start Identity Provider Backend |
| `npm run start:leave-backend` | Start Leave Management Backend |
| `npm run start:leave-frontend` | Start Leave Management Frontend (Port 5003) |
| `npm run start:payroll-backend` | Start Payroll Backend |
| `npm run start:payroll-frontend` | Start Payroll Frontend (Port 5007) |
| `npm run start:performance-backend` | Start Performance Management Backend |
| `npm run start:performance-frontend` | Start Performance Frontend (Port 5005) |
| `npm run start:recruiter-backend` | Start Recruiter Backend |
| `npm run start:recruiter-frontend` | Start Recruiter Frontend (Port 5000) |
| `npm stop` | Stop workspace apps (info only) |
| `npm run stop:workspace` | Show workspace apps status |
| `npm run stop:node` | Stop all Node.js services |
| `npm run restart` | Restart all applications |
| `npm run install:all` | Install dependencies for all apps |
| `npm run install:backends` | Install backend dependencies only |
| `npm run install:frontends` | Install frontend dependencies only |
| `npm run logs` | Show running Node.js processes |
| `npm run status` | Display application URLs |
| `npm run clean` | Clean temporary files |
| `npm run help` | Show command help |

## 🌐 Application Ports

| Application | Type | Port |
|-------------|------|-------|
| Recruiter | Frontend | 5000 |
| Leave Management | Frontend | 5003 |
| Performance Management | Frontend | 5005 |
| Payroll | Frontend | 5007 |
| Identity Provider | Backend | (configured in .env) |
| Leave Management | Backend | (configured in .env) |
| Payroll | Backend | (configured in .env) |
| Performance Management | Backend | (configured in .env) |
| Recruiter | Backend | (configured in .env) |

## 💡 Common Workflows

### Typical Development Session
```bash
# 1. Start all applications
npm start

# 2. Work on code...

# 3. Check status
npm run status

# 4. When done, stop everything
npm stop
```

### Working on Single Application
```bash
# Start only the application you need
npm run start:recruiter-frontend

# Install/update dependencies
cd recruiter/frontend
npm install

# Check what's running
npm run logs
```

### Full Environment Reset
```bash
# Stop everything
npm stop

# Clean temporary files
npm run clean

# Install/update all dependencies
npm run install:all

# Start fresh
npm start
```

## 🔧 Troubleshooting

### Port Already in Use
```bash
# Stop all applications
npm stop

# Wait a few seconds, then restart
npm start
```

### Dependencies Issues
```bash
# Clean install all dependencies
npm run install:all
```

### Application Won't Start
1. Check the individual application window for error messages
2. Verify `.env` file exists and is configured
3. Ensure MongoDB is running (for backends)
4. Check ports with: `netstat -ano | findstr :<port>`

### Script Execution Errors
If you see PowerShell execution errors, ensure:
- Execution Policy allows scripts: `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`
- Run as administrator if needed

## 📝 Notes

- All `npm run dev` commands use hot-reloading for development
- Each application runs in its own PowerShell window
- Backend services require MongoDB to be running
- Some applications require Azure OpenAI or other API keys in `.env` files
- Frontend applications can be accessed directly via browser
- Backend ports are configured in each application's `.env` file

---

**Last Updated**: January 2026
