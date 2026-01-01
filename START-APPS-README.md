# Semplify Applications - Startup Scripts

This directory contains scripts to easily start and stop all Semplify applications.

## Applications Overview

The workspace contains 9 applications:

| Application | Type | Port | Startup Command |
|-------------|------|-------|-----------------|
| Identityprovider | Backend | Configured | `npm run dev` |
| Leave Management | Backend | Configured | `npm run dev` |
| Leave Management | Frontend | 5003 | `npm run dev` |
| Payroll | Backend | Configured | `npm run dev` |
| Payroll | Frontend | 5007 | `npm run dev` |
| Performance Management | Backend | Configured | `npm run dev` |
| Performance Management | Frontend | 5005 | `npm run dev` |
| Recruiter | Backend | Configured | `npm run dev` |
| Recruiter | Frontend | 5000 | `npm run dev` |

## Usage

### Start All Applications

To start all applications at once:

```powershell
.\start-all.ps1
```

This will:
- Open 9 separate PowerShell windows (one for each application)
- Each window will display the application name and path
- Start the application in development mode with hot-reloading

### Stop All Applications

To stop all running applications:

```powershell
.\stop-all.ps1
```

This will:
- Prompt for confirmation
- Stop all Node.js processes running in the workspace
- Clean up temporary script files

## Access URLs

Once started, you can access the applications at:

- **Recruiter**: http://localhost:5000
- **Leave Management**: http://localhost:5003
- **Performance Management**: http://localhost:5005
- **Payroll**: http://localhost:5007

Backend services will be accessible on their configured ports (check each backend's `.env` file or server configuration).

## Notes

- All applications run in development mode with hot-reloading enabled
- Each application runs in its own window for easy monitoring
- Closing an individual window stops only that specific service
- Keep the main script window open while applications are running
- Some applications require environment variables (`.env` files) to be configured

## Troubleshooting

### Port Already in Use
If you see "Port already in use" errors:
1. Run `.\stop-all.ps1` to stop all applications
2. Check if other services are using the ports with `netstat -ano | findstr :<port>`
3. Modify the port in the respective application's configuration

### Missing Dependencies
If you see dependency errors:
```powershell
# Install all dependencies
cd <app-directory>
npm install
```

### Application Won't Start
1. Check the application's window for error messages
2. Verify `.env` file exists and is configured correctly
3. Check MongoDB connection if applicable
4. Review logs in the application's window

## Individual Application Startup

If you want to start applications individually:

```powershell
# Backend example
cd Identityprovider
npm run dev

# Frontend example
cd recruiter\frontend
npm run dev
```

## Production Mode

For production, use:

```powershell
cd <app-directory>
npm run build  # For frontend apps
npm start
```

## Prerequisites

- Node.js >= 18.0.0
- MongoDB (for backend services)
- All dependencies installed (run `npm install` in each directory)

---

**Last Updated**: January 2026
