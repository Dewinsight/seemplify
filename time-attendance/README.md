# Time & Attendance Management System

Connected time and attendance platform with scheduling, rule-driven calculations, immutable timesheets, lifecycle/leave/payroll integrations, transparent application-presence evidence, notifications, exceptions and analytics.

See the [operating documentation](docs/README.md) for rule-pack governance, integration boundaries, migration, and privacy controls.

---

## Features

### Core Time Tracking
- **Clock In/Out** - Record work start and end times
- **Break Management** - Track break periods
- **Real-time Timer** - Live display of hours worked
- **Daily Time Entries** - Complete log of all clock events

### Timesheet Management
- **Configurable periods** - Daily, weekly, fortnightly, semi-monthly and monthly aggregation
- **Approval Workflow** - Submit → Review → Approve/Reject flow
- **Manager Dashboard** - Pending approvals queue
- **Multi-level decisions** - Configurable approval levels, delegation, rejection and bulk actions
- **Immutable versions** - Approved and payroll-exported periods use audited adjustments
- **Audit Trail** - Complete history of calculations, decisions, reminders and integrations

### Advanced Features (NEW)

#### 1. Auto Clock-Out
Automatically clocks out employees who forget to clock out after a configured time threshold.

- Runs every 15 minutes
- Configurable threshold per organization (default: 12 hours)
- Creates auto entries with audit trail
- Prevents incomplete time records

**Configuration:**
```javascript
// In Admin Settings > Policy
clockSettings: {
  autoClockOut: {
    enabled: true,
    afterHours: 12
  }
}
```

#### 2. Email Notifications
Automated email notifications for all workflow events.

- **Timesheet Submitted** → Notifies assigned manager
- **Timesheet Approved** → Notifies employee
- **Timesheet Rejected** → Notifies employee with reason
- **Deadline Reminders** → Daily check for unsubmitted timesheets

**Configuration:**
```bash
# Environment Variables
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM="Time & Attendance <noreply@seemplifyai.com>"
```

```javascript
// In Admin Settings > Policy
notifications: {
  emailOnSubmission: true,
  emailOnApproval: true,
  emailOnRejection: true,
  reminderBeforeDeadline: true,
  reminderHoursBefore: 24
}
```

#### 3. Manual Time Entry
Allow corrections and manual entry when GPS or system fails.

- HR/Managers can add entries for any employee
- Employees can add own entries (if policy allows)
- Requires explanation note (minimum 10 characters)
- Cannot add future entries
- Full audit trail (who, when, why)
- Visual "Manual" badge in UI

**Access:**
- Navigate to "Punch Log" page
- Click "Add Manual Entry" button (if authorized)
- Fill in entry type, date, time, and explanation
- Submit

#### 4. GPS Geofencing
Restrict clock-in to specific physical office locations.

- Captures GPS coordinates from browser
- Validates distance using Haversine formula
- **Warning Mode:** Logs location but allows clock-in
- **Enforced Mode:** Blocks clock-in if outside allowed radius
- Multiple office locations supported
- Admin UI for managing locations

**Configuration:**
```javascript
// In Admin Settings > Geofencing
geofencing: {
  enabled: true,
  enforced: false,  // true = block, false = warn only
  locations: [
    {
      name: 'Main Office',
      address: '123 Main St',
      latitude: 40.7128,
      longitude: -74.0060,
      radius: 100,  // meters
      isActive: true
    }
  ]
}
```

**Setup:**
1. Go to Admin Settings
2. Enable Geofencing
3. Add office locations (use Google Maps for coordinates)
4. Set radius (recommended: 100-200 meters)
5. Toggle "Enforce" to block vs warn
6. Test with clock-in

---

## Technology Stack

### Backend
- **Framework:** Express.js
- **Database:** MongoDB (Mongoose ORM)
- **Authentication:** OIDC (OpenID Connect)
- **Email:** Nodemailer
- **Scheduled Jobs:** Mongo-backed leased jobs (auto clock-out, reminders, reports, retries, reconciliation and retention)

### Frontend
- **Framework:** Next.js 14 (App Router)
- **UI:** Tailwind CSS, Radix UI
- **State:** React Context (Auth)
- **API Client:** Axios

---

## Installation

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)
- Identity Provider (OIDC)

### Backend Setup

```bash
cd time-attendance/backend

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Edit .env with your configuration
# Required:
#   - MONGODB_URI
#   - IDP_ISSUER_URL
#   - OIDC_CLIENT_ID, OIDC_CLIENT_SECRET
#   - SESSION_SECRET
#   - FRONTEND_URL
# Optional (for email):
#   - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS

# Start development server
npm run dev

# Start production server
npm start
```

### Frontend Setup

```bash
cd time-attendance/frontend

# Install dependencies
npm install

# For local development, create .env.local
NEXT_PUBLIC_API_URL=http://localhost:5010/api
NEXT_PUBLIC_IDP_URL=http://localhost:4000

# Start development server
npm run dev

# Build for production
npm run build
npm start
```

---

## Environment Variables

### Backend Required

```bash
PORT=5010
MONGODB_URI=mongodb://localhost:27017/time-attendance
SESSION_SECRET=your-session-secret
IDP_ISSUER_URL=http://localhost:4000
OIDC_CLIENT_ID=time-attendance
OIDC_CLIENT_SECRET=your-client-secret
OIDC_REDIRECT_URI=http://localhost:5010/api/auth/oidc/callback
FRONTEND_URL=http://localhost:5011
INTERNAL_SERVICE_SECRET=replace-with-a-shared-service-secret
IDP_WEBHOOK_SECRET=replace-with-the-idp-webhook-secret
LEAVE_WEBHOOK_SECRET=replace-with-the-leave-webhook-secret
PAYROLL_API_URL=http://localhost:5006
```

### Backend Optional (Email Features)

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM="Time & Attendance <noreply@seemplifyai.com>"
DEFAULT_AUTO_CLOCKOUT_HOURS=12
```

### Frontend (Build-time)

```bash
NEXT_PUBLIC_API_URL=https://api-time.seemplifyai.com/api
NEXT_PUBLIC_IDP_URL=https://auth.seemplifyai.com
```

---

## API Endpoints

### Clock Management
- `GET /api/clock/status` - Get current clock status
- `POST /api/clock/in` - Clock in (with optional location)
- `POST /api/clock/out` - Clock out (with optional location)
- `POST /api/clock/break/start` - Start break
- `POST /api/clock/break/end` - End break
- `GET /api/clock/entries` - Get time entries
- `POST /api/clock/manual` - Add manual time entry (requires authorization)

### Timesheets
- `GET /api/timesheets` - List timesheets
- `GET /api/timesheets/current` - Get current week timesheet
- `GET /api/timesheets/:id` - Get specific timesheet
- `POST /api/timesheets/:id/submit` - Submit for approval
- `POST /api/timesheets/:id/recall` - Recall submitted timesheet

### Approvals (Manager/HR Only)
- `GET /api/approvals` - Get pending approvals
- `GET /api/approvals/counts` - Get approval counts by status
- `POST /api/approvals/:id/approve` - Approve timesheet
- `POST /api/approvals/:id/reject` - Reject timesheet
- `POST /api/approvals/:id/request-revision` - Request revision
- `POST /api/approvals/bulk-approve` - Bulk approve timesheets

### Admin (HR Only)
- `GET /api/admin/policy` - Get attendance policy
- `PUT /api/admin/policy` - Update attendance policy
- `POST /api/admin/geofence-locations` - Add geofence location
- `PUT /api/admin/geofence-locations/:index` - Update location
- `DELETE /api/admin/geofence-locations/:index` - Delete location

### Reports (HR Only)
- `GET /api/reports/monthly` - Monthly attendance report
- `GET /api/reports/overtime` - Overtime report
- `GET /api/reports/lateness` - Lateness report

---

## User Roles

### Employee
- Clock in/out, breaks
- View own timesheets
- Submit timesheets
- Add manual entries (if policy allows)

### Manager
- All employee features
- View team timesheets
- Approve/reject timesheets
- Add manual entries for team members
- View team reports

### HR Admin
- All manager features
- Configure attendance policy
- Manage geofence locations
- Add manual entries for all employees
- View organization-wide reports
- Configure auto clock-out settings
- Configure email notification settings

---

## Testing Guide

See [FEATURES-IMPLEMENTATION-COMPLETE.md](./FEATURES-IMPLEMENTATION-COMPLETE.md) for detailed testing checklist.

### Quick Test Scenarios

**Auto Clock-Out:**
```bash
# Set policy
clockSettings.autoClockOut = { enabled: true, afterHours: 0.1 }

# Clock in, wait 7 minutes
# Check for auto clock-out entry
```

**Email Notifications:**
```bash
# Configure SMTP in .env
# Submit timesheet
# Check manager email inbox
```

**Manual Entry:**
```bash
# Login as HR admin
# Go to Punch Log → Add Manual Entry
# Fill form and submit
# Verify entry appears with "Manual" badge
```

**Geofencing:**
```bash
# Admin Settings → Enable Geofencing
# Add location with lat/lng and radius
# Clock in → Check browser requests location permission
# Verify location validation in backend logs
```

---

## Production Deployment

### Dokploy Configuration

**Backend Environment Variables:**
```bash
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/time_attendance
SESSION_SECRET=production-secret-key
IDP_ISSUER_URL=https://auth.seemplifyai.com
OIDC_CLIENT_ID=time-attendance
OIDC_CLIENT_SECRET=production-secret
OIDC_REDIRECT_URI=https://api-time.seemplifyai.com/api/auth/oidc/callback
FRONTEND_URL=https://time.seemplifyai.com

# Email (required for notifications)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=noreply@seemplifyai.com
SMTP_PASS=your-app-password
SMTP_FROM="Time & Attendance <noreply@seemplifyai.com>"
```

**Frontend Build Arguments:**
```bash
NEXT_PUBLIC_API_URL=https://api-time.seemplifyai.com/api
NEXT_PUBLIC_IDP_URL=https://auth.seemplifyai.com
```

---

## Troubleshooting

### Auto Clock-Out Not Working
- Check policy: `clockSettings.autoClockOut.enabled === true`
- Check backend logs for scheduler execution
- Verify clock-in entries exist in database
- Check threshold: `afterHours` value

### Emails Not Sending
- Verify SMTP credentials in .env
- Check backend logs for email service initialization
- Test SMTP connection manually with `nodemailer.createTestAccount()`
- Ensure policy has `notifications.emailOnSubmission: true`
- Check if manager email is available in timesheet `assignedApprover.userEmail`

### Geofencing Not Working
- Check policy: `geofencing.enabled === true`
- Verify locations configured with valid lat/lng
- Check browser location permission granted
- Review backend logs for validation results
- Ensure coordinates are in valid range (-90 to 90, -180 to 180)

### Manual Entry Rejected
- Check user role (HR admin or manager)
- Verify policy `clockSettings.allowManualEntry` if employee
- Ensure note is at least 10 characters
- Cannot add future entries (check timestamp)

---

## License

Copyright (c) 2026 Seemplify. All rights reserved.

---

## Support

For issues or questions, contact support@seemplifyai.com
