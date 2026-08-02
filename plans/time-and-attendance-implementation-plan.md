# Time and Attendance Module Implementation Plan

## Overview

Build a comprehensive, visually stunning Time and Attendance module for Seemplify that enables organizations to track employee work hours, manage schedules, and streamline attendance management. The design will follow the premium aesthetic patterns established in the payroll (amber/orange gradients) and leave-management (purple/pink gradients) modules.

### Design Theme
- **Primary Color**: Teal/Cyan gradients (`from-teal-500 via-cyan-500 to-emerald-500`)
- **Accent Color**: Teal (`#14b8a6`) with cyan highlights
- **Design System**: Glassmorphism with noise texture, following Seemplify's premium dark theme

---

## User Review Required

> [!IMPORTANT]
> **Clock-In Methods**: Please confirm which clock-in methods are priorities:
> - Web-based (click to clock in/out) ✅ Recommended for v1
> - GPS Geofencing (verify location on mobile)
> - Biometric integration (fingerprint/face - would require hardware)
> - QR Code scanning
>
> **Recommended**: Start with web-based for v1, add GPS geofencing in v2.

> [!WARNING]
> **Shift Scheduling**: Full shift scheduling with AI optimization is complex. Recommend:
> - v1: Basic work hours configuration per employee
> - v2: Shift templates and scheduling

---

## Key Features

### Phase 1 (Core - This Implementation)

#### 1. Clock In/Out
- One-click clock in/out from dashboard
- Real-time status display (Currently Working / Not Clocked In)
- Break tracking (start/end breaks)
- Daily hours summary

#### 2. Timesheet Management
- Weekly/monthly timesheet views
- Pending approval indicators
- Edit requests for corrections
- Auto-calculated hours with overtime detection

#### 3. Attendance Dashboard
- Personal attendance statistics
- Live team attendance (for managers)
- Visual heat calendar showing attendance patterns
- Today's status overview cards

#### 4. Approval Workflow
- Manager approves timesheets
- Bulk approval for efficiency
- Exception flagging (late arrivals, early departures)
- Comments and rejection reasons

#### 5. Reports & Analytics (HR Admin)
- Department attendance reports
- Overtime trends
- Late/absence patterns
- Export to CSV/PDF

### Phase 2 (Future Enhancements)
- GPS Geofencing for remote clock-in
- Shift scheduling with templates
- Mobile app integration
- Integration with Payroll module (overtime auto-calculation)
- Integration with Leave Management (auto-detect absences)

---

## Proposed Changes

### Backend (`time-attendance/backend`)

#### [NEW] Core Structure
```
time-attendance/
├── backend/
│   ├── server.js
│   ├── package.json
│   ├── Dockerfile
│   ├── Dockerfile.dev
│   ├── .env.example
│   ├── config/
│   │   └── database.js
│   ├── middleware/
│   │   ├── auth.js          # OIDC authentication
│   │   ├── organizationContext.js
│   │   └── validateRequest.js
│   ├── models/
│   │   ├── TimeEntry.js     # Clock in/out records
│   │   ├── Timesheet.js     # Weekly/monthly aggregated view
│   │   ├── AttendancePolicy.js
│   │   └── index.js
│   ├── routes/
│   │   ├── clock.js         # Clock in/out endpoints
│   │   ├── timesheets.js    # Timesheet CRUD
│   │   ├── attendance.js    # Dashboard stats
│   │   ├── approvals.js     # Manager approvals
│   │   └── reports.js       # Analytics & reports
│   └── services/
│       ├── clockService.js
│       ├── timesheetService.js
│       ├── attendanceService.js
│       └── reportService.js
└── frontend/
    └── ...
```

---

#### [NEW] [TimeEntry.js](file:///c:/Users/Michael/Documents/GitHub/seemplify/time-attendance/backend/models/TimeEntry.js)

Core time tracking record model:

```javascript
const TimeEntrySchema = new Schema({
  // User & Organization (from IdP)
  userId: { type: String, required: true, index: true },
  userEmail: { type: String, required: true },
  userName: { type: String },
  organizationId: { type: String, required: true, index: true },
  organizationName: { type: String },
  teamId: { type: String },
  teamName: { type: String },

  // Entry Type
  entryType: {
    type: String,
    enum: ['clock_in', 'clock_out', 'break_start', 'break_end'],
    required: true
  },
  
  // Timestamps
  timestamp: { type: Date, required: true, default: Date.now },
  timezone: { type: String, default: 'UTC' },
  
  // Location (for future GPS feature)
  location: {
    latitude: Number,
    longitude: Number,
    address: String,
    verified: Boolean
  },
  
  // Source
  source: {
    type: String,
    enum: ['web', 'mobile', 'kiosk', 'manual', 'import'],
    default: 'web'
  },
  
  // Notes
  note: { type: String, maxlength: 500 },
  
  // Modifications
  isManualEntry: { type: Boolean, default: false },
  modifiedBy: { userId: String, userName: String, modifiedAt: Date, reason: String },
  
  // Audit
  createdAt: { type: Date, default: Date.now }
});
```

---

#### [NEW] [Timesheet.js](file:///c:/Users/Michael/Documents/GitHub/seemplify/time-attendance/backend/models/Timesheet.js)

Aggregated weekly/monthly timesheet:

```javascript
const TimesheetSchema = new Schema({
  userId: { type: String, required: true, index: true },
  organizationId: { type: String, required: true, index: true },
  
  // Period
  periodType: { type: String, enum: ['weekly', 'bi-weekly', 'monthly'], default: 'weekly' },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  
  // Daily breakdown
  dailyEntries: [{
    date: Date,
    clockIn: Date,
    clockOut: Date,
    breakDuration: Number,  // minutes
    totalHours: Number,
    overtimeHours: Number,
    status: { type: String, enum: ['present', 'absent', 'leave', 'holiday', 'weekend'] },
    exceptions: [{ type: { type: String }, description: String }]
  }],
  
  // Summary
  summary: {
    totalHours: Number,
    regularHours: Number,
    overtimeHours: Number,
    breakTime: Number,
    daysWorked: Number,
    daysAbsent: Number,
    lateDays: Number,
    earlyDepartures: Number
  },
  
  // Status & Workflow
  status: {
    type: String,
    enum: ['draft', 'submitted', 'approved', 'rejected', 'revision_requested'],
    default: 'draft'
  },
  
  // Approvals
  submittedAt: Date,
  approvedBy: { userId: String, userName: String, approvedAt: Date, comment: String },
  rejectedBy: { userId: String, userName: String, rejectedAt: Date, reason: String },
  
  // Audit
  auditLog: [{
    action: String,
    performedBy: String,
    performedAt: Date,
    details: String
  }]
});
```

---

#### [NEW] [AttendancePolicy.js](file:///c:/Users/Michael/Documents/GitHub/seemplify/time-attendance/backend/models/AttendancePolicy.js)

Organization attendance configuration:

```javascript
const AttendancePolicySchema = new Schema({
  organizationId: { type: String, required: true, unique: true },
  
  // Work Schedule
  workSchedule: {
    type: { type: String, enum: ['fixed', 'flexible'], default: 'fixed' },
    standardHoursPerDay: { type: Number, default: 8 },
    standardHoursPerWeek: { type: Number, default: 40 },
    workDays: [{ type: Number }],  // 0-6 (Sunday-Saturday)
    defaultShift: {
      startTime: String,  // "09:00"
      endTime: String,    // "17:00"
      breakDuration: Number // minutes
    }
  },
  
  // Overtime Rules
  overtime: {
    enabled: { type: Boolean, default: true },
    dailyThreshold: Number,    // hours after which OT kicks in
    weeklyThreshold: Number,
    multiplier: { type: Number, default: 1.5 }
  },
  
  // Grace Periods
  gracePeriod: {
    lateArrival: { type: Number, default: 15 },    // minutes
    earlyDeparture: { type: Number, default: 15 }
  },
  
  // Geofencing (for v2)
  geofencing: {
    enabled: { type: Boolean, default: false },
    locations: [{ name: String, latitude: Number, longitude: Number, radius: Number }]
  }
});
```

---

### Frontend (`time-attendance/frontend`)

#### [NEW] Core Structure
```
time-attendance/frontend/
├── app/
│   ├── layout.tsx           # Main layout with nav
│   ├── page.tsx             # Redirect to dashboard
│   ├── globals.css          # Teal theme styling
│   ├── login/page.tsx
│   ├── dashboard/page.tsx   # Main dashboard with clock widget
│   ├── timesheets/
│   │   ├── page.tsx         # My timesheets list
│   │   └── [id]/page.tsx    # Timesheet detail
│   ├── team/page.tsx        # Team attendance (managers)
│   ├── approvals/page.tsx   # Pending approvals
│   ├── reports/page.tsx     # Analytics (HR Admin)
│   └── admin/
│       └── settings/page.tsx # Policy configuration
├── components/
│   ├── ClockWidget.tsx      # Clock in/out button
│   ├── TimeEntryCard.tsx    # Daily entry display
│   ├── TimesheetTable.tsx   # Weekly grid view
│   ├── AttendanceCalendar.tsx # Heat calendar
│   ├── StatsCard.tsx        # Metric cards
│   ├── TeamStatusGrid.tsx   # Live team status
│   └── ui/                  # Shared UI components
├── lib/
│   ├── api.ts               # API client
│   ├── hooks.ts             # Custom hooks
│   └── utils.ts
├── context/
│   └── AuthContext.tsx
├── services/
│   ├── clockService.ts
│   └── timesheetService.ts
└── types/
    └── index.ts
```

---

#### [NEW] Dashboard Design (Visual Mockup Description)

```
┌─────────────────────────────────────────────────────────────────┐
│  Time & Attendance                              [Michael ▼] Hub │
│  by Seemplify                                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ ░░░░░░░░░░░░░░░░ WELCOME HEADER with blur glow ░░░░░░░░░░░ │ │
│  │  Welcome back, Michael 👋                       [App Hub]  │ │
│  │  Track your time at Acme Corp                              │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐ │
│  │   🟢 CLOCK WIDGET    │  │  📊 TODAY'S SUMMARY              │ │
│  │                      │  │  ┌────┐ ┌────┐ ┌────┐ ┌────┐    │ │
│  │  ⏱️  04:32:15       │  │  │8.0h│ │0.5h│ │ 2  │ │ 15m│    │ │
│  │   Currently Working  │  │  │Hrs │ │Brk │ │Late│ │OT  │    │ │
│  │                      │  │  └────┘ └────┘ └────┘ └────┘    │ │
│  │  [  🛑 Clock Out  ]  │  │                                  │ │
│  │                      │  │  Started: 9:00 AM                │ │
│  │  Last: 9:00 AM       │  │  Break: 12:30 - 1:00 PM         │ │
│  └──────────────────────┘  └──────────────────────────────────┘ │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  📅 THIS WEEK                                   [View All] │ │
│  │  ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┐             │ │
│  │  │ Mon │ Tue │ Wed │ Thu │ Fri │ Sat │ Sun │             │ │
│  │  │ 8.0h│ 8.5h│ 7.5h│ 8.0h│  -  │  -  │  -  │             │ │
│  │  │  ✓  │  ✓  │ ⚠️  │  ✓  │     │     │     │             │ │
│  │  └─────┴─────┴─────┴─────┴─────┴─────┴─────┘             │ │
│  │  Total: 32.0h / 40h                         [Submit Week] │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐ │
│  │  📈 MONTHLY TREND    │  │  🔔 RECENT ACTIVITY              │ │
│  │  [Heat Calendar]     │  │  • Timesheet W3 approved         │ │
│  │                      │  │  • Clock in 9:15 AM (late 15m)   │ │
│  │   Jan 2026           │  │  • Break ended 1:00 PM           │ │
│  │  ░░░░░░░             │  │                                  │ │
│  │  ░██░░░░░            │  │                                  │ │
│  │  ░██░░░░░            │  │                                  │ │
│  └──────────────────────┘  └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

#### [NEW] Clock Widget Component

Premium floating clock widget with:
- Animated pulse when clocked in
- Real-time elapsed time counter
- Gradient glow effect
- Quick break toggle
- Status indicator (🟢 Working / 🔴 Not Clocked In)

```tsx
// Key visual elements
<div className="relative group">
  {/* Glow effect */}
  <div className="absolute inset-0 bg-gradient-to-r from-teal-500/30 to-cyan-500/30 rounded-2xl blur-xl 
    group-hover:from-teal-500/40 group-hover:to-cyan-500/40 transition-all" />
  
  {/* Main card */}
  <div className="relative bg-zinc-900/90 rounded-2xl border border-teal-500/20 p-8">
    {/* Status indicator */}
    <div className="flex items-center gap-2 mb-4">
      <span className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
      <span className="text-sm text-zinc-400">Currently Working</span>
    </div>
    
    {/* Timer */}
    <div className="text-5xl font-bold bg-gradient-to-r from-teal-400 to-cyan-400 
      bg-clip-text text-transparent font-mono mb-6">
      04:32:15
    </div>
    
    {/* Clock out button */}
    <button className="w-full py-3 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 
      text-white font-semibold shadow-lg shadow-red-500/20 hover:shadow-red-500/30 
      hover:scale-105 transition-all flex items-center justify-center gap-2">
      <StopCircle className="h-5 w-5" />
      Clock Out
    </button>
  </div>
</div>
```

---

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/clock/in` | Clock in |
| `POST` | `/api/clock/out` | Clock out |
| `POST` | `/api/clock/break/start` | Start break |
| `POST` | `/api/clock/break/end` | End break |
| `GET` | `/api/clock/status` | Get current status |
| `GET` | `/api/timesheets` | List user's timesheets |
| `GET` | `/api/timesheets/:id` | Get timesheet details |
| `POST` | `/api/timesheets/:id/submit` | Submit for approval |
| `GET` | `/api/attendance/dashboard` | Dashboard stats |
| `GET` | `/api/attendance/team` | Team attendance (managers) |
| `GET` | `/api/approvals` | Pending approvals |
| `POST` | `/api/approvals/:id/approve` | Approve timesheet |
| `POST` | `/api/approvals/:id/reject` | Reject timesheet |
| `GET` | `/api/reports/attendance` | Attendance reports |
| `GET` | `/api/admin/policy` | Get attendance policy |
| `PUT` | `/api/admin/policy` | Update policy (HR Admin) |

---

### Integration with Existing Modules

#### Identity Provider (IdP)
- Same OIDC authentication flow as payroll/leave-management
- Organization context and team hierarchy
- Role-based access (employee, line_manager, hr_manager, admin)

#### Payroll Module (Future)
- Export overtime hours for payroll calculation
- Sync attendance data for accurate pay calculation

#### Leave Management (Future)
- Cross-reference leave requests with attendance
- Auto-mark days as "leave" when approved leave exists

---

## Design Specifications

### Color Palette (Teal Theme)
```css
--primary: teal-500 (#14b8a6)
--primary-gradient: from-teal-500 via-cyan-500 to-emerald-500
--accent-shadow: teal-500/20
--status-working: emerald-500
--status-break: amber-500
--status-absent: red-500
```

### Visual Elements
- **Glassmorphism cards**: `bg-zinc-900/90 backdrop-blur-xl border-teal-500/20`
- **Gradient buttons**: Primary actions use teal gradient
- **Hover effects**: Scale 105%, increased shadow glow
- **Animations**: Pulse for active status, shimmer for loading
- **Background**: Noise texture overlay, same as payroll

### Iconography (Lucide React)
- Clock: `Clock`, `Timer`, `Play`, `Pause`, `StopCircle`
- Status: `CheckCircle`, `AlertCircle`, `XCircle`
- Navigation: `LayoutGrid`, `Calendar`, `FileText`, `Users`

---

## Verification Plan

### Manual Testing

1. **Clock In/Out Flow**
   - Navigate to dashboard
   - Verify "Not Clocked In" status
   - Click "Clock In" button
   - Verify status changes to "Working" with timer starting
   - Wait 1 minute, verify timer increments
   - Click "Clock Out"
   - Verify status returns to "Not Clocked In"

2. **Timesheet View**
   - Navigate to Timesheets page
   - Verify week view displays clock entries
   - Verify hours are auto-calculated
   - Submit timesheet for approval

3. **Manager Approval**
   - Login as manager
   - Navigate to Approvals
   - Verify submitted timesheets appear
   - Approve/reject timesheet
   - Verify employee sees updated status

4. **Visual Inspection**
   - Compare dashboard appearance to mockup
   - Verify teal color theme consistency
   - Test dark mode appearance
   - Verify mobile responsiveness

### Automated Testing (Future)
- Unit tests for time calculation logic
- API integration tests for clock endpoints
- E2E tests with Playwright for critical flows

---

## File Summary

| Component | New Files | Key Changes |
|-----------|-----------|-------------|
| **Backend Models** | 3 | TimeEntry, Timesheet, AttendancePolicy |
| **Backend Routes** | 5 | clock, timesheets, attendance, approvals, reports |
| **Backend Services** | 4 | clockService, timesheetService, etc. |
| **Frontend Pages** | 8 | dashboard, timesheets, team, approvals, etc. |
| **Frontend Components** | 7 | ClockWidget, TimeEntryCard, etc. |
| **Config/Types** | 5 | API client, hooks, types |

**Estimated Total**: ~35-40 new files

---

## Implementation Order

1. **Phase 1: Infrastructure** (Day 1)
   - Create folder structure
   - Set up backend server, database config
   - Set up frontend with Next.js
   - Configure auth middleware

2. **Phase 2: Core Models & Clock** (Day 2-3)
   - Implement TimeEntry model
   - Build clock in/out API
   - Create ClockWidget component
   - Build dashboard with live status

3. **Phase 3: Timesheets** (Day 4-5)
   - Implement Timesheet model & aggregation
   - Build timesheet list & detail pages
   - Create weekly grid component
   - Add submission workflow

4. **Phase 4: Approvals & Admin** (Day 6-7)
   - Manager approval flow
   - HR Admin policy settings
   - Team attendance view
   - Basic reporting

5. **Phase 5: Polish** (Day 8)
   - Visual refinements
   - Mobile responsiveness
   - Testing & bug fixes
   - Documentation

---

## Questions for User

1. Should we prioritize any specific feature for v1?
2. Do you need multi-timezone support from day 1?
3. Any specific compliance requirements (e.g., labor law break rules)?
4. Should the module integrate immediately with Payroll, or standalone first?
