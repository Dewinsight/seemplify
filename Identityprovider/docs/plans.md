# IDP Subscription Management System - Design Document

## Overview

This document outlines the architecture and implementation plan for a comprehensive Subscription Management System in the Identity Provider (IDP). The system enables administrators to create and manage subscription plans, and allows organizations to request, upgrade, downgrade, and renew subscriptions.

## Table of Contents

1. [Core Requirements](#core-requirements)
2. [Database Schema](#database-schema)
3. [API Endpoints](#api-endpoints)
4. [Admin UI](#admin-ui)
5. [Organization UI](#organization-ui)
6. [Access Control Integration](#access-control-integration)
7. [Email Notifications](#email-notifications)
8. [Edge Cases & Business Logic](#edge-cases--business-logic)
9. [Implementation Phases](#implementation-phases)

---

## Core Requirements

### Plan Features
- **Billing Cycles**: Monthly, Yearly (with optional discounts for yearly)
- **Member Limits**: Configurable max members per plan (null = unlimited)
- **App Access Control**: Granular toggles for each integrated app:
  - Recruiter (SmartHR)
  - Leave Management
  - Payroll Management
  - Performance Management
  - Outline Docs
  - AI Chat (Open WebUI)
  - LMS (Seemplify LMS)

### Subscription Lifecycle
- Plan creation/editing by admin
- Organization can view available plans and prices
- Organization submits request with contact details (email, phone)
- Admin receives email notification
- Admin reviews and approves/rejects request
- Upon approval, subscription is activated with expiration date
- System enforces access based on active subscription
- Expiration handling with grace period option
- Upgrade/downgrade paths
- Renewal workflow

---

## Database Schema

### 1. Plan Model (`AiinPlan`)

```javascript
const PlanSchema = new mongoose.Schema({
  // Basic Info
  name: { type: String, required: true, unique: true },
  slug: { type: String, required: true, unique: true, lowercase: true },
  description: { type: String },

  // Pricing
  pricing: {
    monthly: { type: Number, default: 0 },      // Price in cents/kobo
    yearly: { type: Number, default: 0 },       // Price in cents/kobo
    yearlyDiscount: { type: Number, default: 0 }, // Percentage discount for yearly
    currency: { type: String, default: 'NGN' }
  },

  // Limits
  limits: {
    maxMembers: { type: Number, default: null }, // null = unlimited
    maxTeams: { type: Number, default: null },   // null = unlimited
    maxStorage: { type: Number, default: null }  // In GB, null = unlimited
  },

  // App Access Toggles
  features: {
    recruiter: { type: Boolean, default: false },
    leaveManagement: { type: Boolean, default: false },
    payrollManagement: { type: Boolean, default: false },
    performanceManagement: { type: Boolean, default: false },
    outlineDocs: { type: Boolean, default: false },
    aiChat: { type: Boolean, default: false },
    lms: { type: Boolean, default: false }
  },

  // Additional Feature Flags
  additionalFeatures: [{
    key: String,
    value: mongoose.Schema.Types.Mixed,
    description: String
  }],

  // Plan Status
  isActive: { type: Boolean, default: true },
  isPublic: { type: Boolean, default: true }, // Visible to organizations
  isFeatured: { type: Boolean, default: false }, // Highlight in UI

  // Display
  displayOrder: { type: Number, default: 0 },
  badgeText: { type: String }, // e.g., "Most Popular", "Best Value"
  color: { type: String, default: '#3b82f6' }, // Brand color for plan

  // Metadata
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AiinAccount' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

// Indexes
PlanSchema.index({ slug: 1 });
PlanSchema.index({ isActive: 1, isPublic: 1 });
PlanSchema.index({ displayOrder: 1 });
```

### 2. Subscription Model (`AiinSubscription`)

```javascript
const SubscriptionSchema = new mongoose.Schema({
  // References
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    required: true
  },
  plan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinPlan',
    required: true
  },

  // Billing
  billingCycle: {
    type: String,
    enum: ['monthly', 'yearly'],
    required: true
  },
  priceAtPurchase: { type: Number, required: true }, // Price locked at time of purchase
  currency: { type: String, default: 'NGN' },

  // Status
  status: {
    type: String,
    enum: ['active', 'expired', 'cancelled', 'suspended', 'pending_renewal'],
    default: 'active'
  },

  // Dates
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  gracePeriodEnd: { type: Date }, // Extra days after expiry before full suspension
  cancelledAt: { type: Date },

  // Renewal
  autoRenew: { type: Boolean, default: false },
  renewalReminderSent: { type: Boolean, default: false },
  lastRenewalDate: { type: Date },

  // Limits Override (admin can customize per-org)
  customLimits: {
    maxMembers: { type: Number },
    maxTeams: { type: Number },
    maxStorage: { type: Number }
  },

  // Features Override (admin can grant additional features)
  customFeatures: {
    recruiter: { type: Boolean },
    leaveManagement: { type: Boolean },
    payrollManagement: { type: Boolean },
    performanceManagement: { type: Boolean },
    outlineDocs: { type: Boolean },
    aiChat: { type: Boolean },
    lms: { type: Boolean }
  },

  // Audit Trail
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AiinAccount' },
  approvedAt: { type: Date },
  notes: { type: String }, // Admin notes

  // History tracking
  previousSubscription: { type: mongoose.Schema.Types.ObjectId, ref: 'AiinSubscription' },
  upgradeFromPlan: { type: mongoose.Schema.Types.ObjectId, ref: 'AiinPlan' },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

// Indexes
SubscriptionSchema.index({ organization: 1, status: 1 });
SubscriptionSchema.index({ endDate: 1, status: 1 });
SubscriptionSchema.index({ status: 1 });

// Virtual: isExpired
SubscriptionSchema.virtual('isExpired').get(function() {
  return this.endDate < new Date() && this.status !== 'cancelled';
});

// Virtual: isInGracePeriod
SubscriptionSchema.virtual('isInGracePeriod').get(function() {
  const now = new Date();
  return this.endDate < now && this.gracePeriodEnd && this.gracePeriodEnd > now;
});

// Virtual: daysUntilExpiry
SubscriptionSchema.virtual('daysUntilExpiry').get(function() {
  const diff = this.endDate - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
});

// Method: Get effective features (plan + custom overrides)
SubscriptionSchema.methods.getEffectiveFeatures = async function() {
  await this.populate('plan');
  const planFeatures = this.plan.features.toObject();
  const customFeatures = this.customFeatures?.toObject() || {};

  // Custom features override plan features (only if explicitly set)
  return Object.keys(planFeatures).reduce((acc, key) => {
    acc[key] = customFeatures[key] !== undefined ? customFeatures[key] : planFeatures[key];
    return acc;
  }, {});
};

// Method: Get effective limits
SubscriptionSchema.methods.getEffectiveLimits = async function() {
  await this.populate('plan');
  const planLimits = this.plan.limits.toObject();
  const customLimits = this.customLimits?.toObject() || {};

  return Object.keys(planLimits).reduce((acc, key) => {
    acc[key] = customLimits[key] !== undefined ? customLimits[key] : planLimits[key];
    return acc;
  }, {});
};

// Method: Check if org can access a specific app
SubscriptionSchema.methods.canAccessApp = async function(appKey) {
  if (this.status !== 'active' && !this.isInGracePeriod) {
    return false;
  }
  const features = await this.getEffectiveFeatures();
  return features[appKey] === true;
};
```

### 3. Subscription Request Model (`AiinSubscriptionRequest`)

```javascript
const SubscriptionRequestSchema = new mongoose.Schema({
  // Organization Info
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    required: true
  },

  // Requested Plan
  plan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinPlan',
    required: true
  },
  billingCycle: {
    type: String,
    enum: ['monthly', 'yearly'],
    required: true
  },

  // Request Type
  requestType: {
    type: String,
    enum: ['new', 'upgrade', 'downgrade', 'renewal'],
    default: 'new'
  },

  // If upgrading/downgrading, reference current subscription
  currentSubscription: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinSubscription'
  },

  // Contact Information (required for request)
  contactInfo: {
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    role: { type: String }, // Requester's role in org
    additionalNotes: { type: String }
  },

  // Requester (logged in user who made the request)
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true
  },

  // Status
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled', 'expired'],
    default: 'pending'
  },

  // Admin Processing
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AiinAccount' },
  processedAt: { type: Date },
  adminNotes: { type: String }, // Internal notes by admin
  rejectionReason: { type: String },

  // If approved, link to created subscription
  resultingSubscription: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinSubscription'
  },

  // Pricing snapshot at time of request
  priceSnapshot: {
    monthly: Number,
    yearly: Number,
    currency: String
  },

  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date } // Request expires if not processed
}, {
  timestamps: true
});

// Indexes
SubscriptionRequestSchema.index({ organization: 1, status: 1 });
SubscriptionRequestSchema.index({ status: 1, createdAt: -1 });
SubscriptionRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

// Auto-expire pending requests after 30 days
SubscriptionRequestSchema.pre('save', function(next) {
  if (this.isNew && !this.expiresAt) {
    this.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }
  next();
});
```

### 4. Organization Model Updates

Add to existing `AiinOrganization` schema:

```javascript
// Add to Organization schema
subscription: {
  current: { type: mongoose.Schema.Types.ObjectId, ref: 'AiinSubscription' },
  history: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AiinSubscription' }]
}
```

---

## API Endpoints

### Admin Endpoints (Protected - Admin Only)

#### Plans Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/plans` | List all plans (with filters) |
| GET | `/api/admin/plans/:id` | Get plan details |
| POST | `/api/admin/plans` | Create new plan |
| PUT | `/api/admin/plans/:id` | Update plan |
| DELETE | `/api/admin/plans/:id` | Soft delete plan (set inactive) |
| POST | `/api/admin/plans/:id/duplicate` | Duplicate a plan |

#### Subscription Requests Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/subscription-requests` | List all requests (filters: status, org, date range) |
| GET | `/api/admin/subscription-requests/:id` | Get request details |
| POST | `/api/admin/subscription-requests/:id/approve` | Approve request & create subscription |
| POST | `/api/admin/subscription-requests/:id/reject` | Reject request with reason |
| GET | `/api/admin/subscription-requests/stats` | Dashboard stats (pending count, etc.) |

#### Subscriptions Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/subscriptions` | List all subscriptions |
| GET | `/api/admin/subscriptions/:id` | Get subscription details |
| PUT | `/api/admin/subscriptions/:id` | Update subscription (dates, limits, features) |
| POST | `/api/admin/subscriptions/:id/cancel` | Cancel subscription |
| POST | `/api/admin/subscriptions/:id/suspend` | Suspend subscription |
| POST | `/api/admin/subscriptions/:id/reactivate` | Reactivate subscription |
| POST | `/api/admin/subscriptions/:id/extend` | Extend subscription period |
| POST | `/api/admin/organizations/:orgId/assign-plan` | Directly assign plan to org |

#### Admin Dashboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/dashboard/stats` | Overall subscription stats |
| GET | `/api/admin/dashboard/expiring-soon` | Subscriptions expiring in X days |
| GET | `/api/admin/dashboard/revenue` | Revenue analytics |

### Organization Endpoints (Protected - Org Admin/Owner)

#### View Plans
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/plans` | List public plans |
| GET | `/api/plans/:slug` | Get plan details by slug |
| GET | `/api/plans/compare` | Compare multiple plans |

#### Subscription Requests
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/subscription-requests` | Submit new subscription request |
| GET | `/api/subscription-requests` | Get org's request history |
| GET | `/api/subscription-requests/:id` | Get specific request status |
| POST | `/api/subscription-requests/:id/cancel` | Cancel pending request |

#### Current Subscription
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/subscription` | Get org's current subscription |
| GET | `/api/subscription/features` | Get accessible features |
| GET | `/api/subscription/usage` | Get usage stats (members, etc.) |
| POST | `/api/subscription/request-upgrade` | Request upgrade to different plan |
| POST | `/api/subscription/request-renewal` | Request renewal |

### Access Check Endpoint (Internal)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/access/check/:appKey` | Check if org can access app |
| GET | `/api/access/validate` | Validate org subscription status |

---

## Admin UI

### Pages to Create

#### 1. Admin Dashboard (`/admin/dashboard`)
- Overview stats: Total orgs, Active subscriptions, Pending requests
- Revenue summary (monthly/yearly)
- Quick actions: View pending requests, expiring subscriptions
- Charts: Subscription trends, Plan popularity

#### 2. Plans Management (`/admin/plans`)
- Table listing all plans with:
  - Name, Price (monthly/yearly), Member limit
  - Feature badges (which apps included)
  - Status (Active/Inactive), Public visibility
  - Actions: Edit, Duplicate, Deactivate
- Create/Edit Plan modal with:
  - Basic info (name, description, slug)
  - Pricing fields (monthly, yearly, currency)
  - Limits configuration
  - Feature toggles for each app
  - Display settings (order, badge, color)

#### 3. Subscription Requests (`/admin/subscription-requests`)
- Filterable table:
  - Status filter (Pending, Approved, Rejected)
  - Date range filter
  - Organization search
- Request details:
  - Organization info
  - Requested plan with pricing
  - Contact information (name, email, phone)
  - Request type (new/upgrade/downgrade/renewal)
  - Admin notes field
- Actions:
  - Approve (with optional customizations)
  - Reject (with reason)
  - View organization details

#### 4. Active Subscriptions (`/admin/subscriptions`)
- Filterable table:
  - Status filter
  - Plan filter
  - Expiring soon filter
- Subscription details:
  - Organization and plan info
  - Billing cycle and pricing
  - Start/end dates
  - Custom limits/features if any
- Actions:
  - Edit dates/limits
  - Suspend/Reactivate
  - Cancel
  - Extend period

#### 5. Organization Subscription View (`/admin/organizations/:id/subscription`)
- View org's subscription history
- Current subscription details
- Assign new plan directly
- Pending requests for this org

---

## Organization UI

### Pages to Create/Update

#### 1. Plans & Pricing (`/plans` or `/subscription/plans`)
- Public-facing plans display
- Plan cards with:
  - Name and description
  - Monthly/yearly pricing toggle
  - Feature list with checkmarks
  - Member limits
  - "Request Plan" button
- Comparison view option

#### 2. Subscription Status (`/subscription`)
- Current plan details
- Usage meters (members used/limit)
- Expiration date with countdown
- Available apps based on plan
- Quick actions:
  - Request upgrade
  - Request renewal (if expiring soon)
  - View request history

#### 3. Request Plan Modal
- Plan summary
- Billing cycle selection (monthly/yearly)
- Contact information form:
  - Name (pre-filled from profile)
  - Email (pre-filled, editable)
  - Phone (required)
  - Additional notes (optional)
- Price confirmation
- Submit request button

#### 4. Request History (`/subscription/requests`)
- List of all subscription requests
- Status badges (Pending, Approved, Rejected)
- View details of each request
- Cancel option for pending requests

---

## Access Control Integration

### Hub App Launch Gate

Modify `/launch/:appId` endpoint in `index.js`:

```javascript
app.get('/launch/:appId', async (req, res) => {
  // ... existing auth checks ...

  // NEW: Check subscription access
  const subscription = await Subscription.findOne({
    organization: account.currentOrganization,
    status: { $in: ['active'] }
  }).populate('plan');

  // Map appId to feature key
  const appFeatureMap = {
    'smarthr': 'recruiter',
    'leave-management': 'leaveManagement',
    'payroll-management': 'payrollManagement',
    'performance-management': 'performanceManagement',
    'outline': 'outlineDocs',
    'openwebui': 'aiChat',
    'lms': 'lms'
  };

  const featureKey = appFeatureMap[appId];

  if (featureKey) {
    // Check if subscription allows access
    const hasAccess = subscription && await subscription.canAccessApp(featureKey);

    if (!hasAccess) {
      // Redirect to subscription required page
      return res.redirect(`/subscription/required?app=${appId}`);
    }

    // Check grace period warning
    if (subscription.isInGracePeriod) {
      // Could show warning banner or proceed
    }
  }

  // ... continue with existing app launch logic ...
});
```

### Subscription Required Page (`/subscription/required`)

Display when org tries to access app without subscription:
- Message explaining subscription is required
- Link to view plans
- Current plan status if they have one (expired, etc.)

### Organization Claims Enhancement

Add subscription info to JWT claims:

```javascript
// In buildOrganizationClaims function
async function buildOrganizationClaims(account) {
  // ... existing claims ...

  // Add subscription claims
  const subscription = await Subscription.findOne({
    organization: account.currentOrganization,
    status: 'active'
  }).populate('plan');

  if (subscription) {
    claims.subscription = {
      planId: subscription.plan._id,
      planName: subscription.plan.name,
      features: await subscription.getEffectiveFeatures(),
      limits: await subscription.getEffectiveLimits(),
      expiresAt: subscription.endDate,
      isInGracePeriod: subscription.isInGracePeriod
    };
  }

  return claims;
}
```

---

## Email Notifications

### Email Templates to Create

#### 1. Admin: New Subscription Request
**Trigger**: When organization submits request
**To**: Admin email(s)
**Subject**: "New Subscription Request: {OrgName} - {PlanName}"
**Content**:
- Organization name and details
- Requested plan and billing cycle
- Contact info (name, email, phone)
- Request type (new/upgrade/etc.)
- Direct link to approve/reject in admin panel

#### 2. Organization: Request Received
**Trigger**: When request is submitted
**To**: Contact email from request
**Subject**: "Subscription Request Received - {PlanName}"
**Content**:
- Confirmation of request
- Plan details and pricing
- Expected processing time
- Contact info for questions

#### 3. Organization: Request Approved
**Trigger**: When admin approves request
**To**: Contact email + org owner
**Subject**: "Subscription Activated - {PlanName}"
**Content**:
- Welcome message
- Plan details and features
- Start and end dates
- How to access new features
- Link to dashboard

#### 4. Organization: Request Rejected
**Trigger**: When admin rejects request
**To**: Contact email
**Subject**: "Subscription Request Update"
**Content**:
- Status update
- Rejection reason (if provided)
- Alternative options
- Contact for questions

#### 5. Organization: Expiration Warning
**Trigger**: X days before expiration (7, 3, 1 day)
**To**: Org owner + admins
**Subject**: "Subscription Expiring Soon - {DaysLeft} days left"
**Content**:
- Current plan details
- Expiration date
- Renewal instructions
- Link to request renewal

#### 6. Organization: Subscription Expired
**Trigger**: On expiration date
**To**: Org owner + admins
**Subject**: "Subscription Expired - Action Required"
**Content**:
- Grace period details (if any)
- Features that are now restricted
- Renewal instructions
- Link to plans page

---

## Edge Cases & Business Logic

### Upgrade/Downgrade Logic

#### Upgrade Process
1. Organization with active subscription requests higher plan
2. Request type = 'upgrade'
3. Admin approves:
   - New subscription created with new plan
   - Start date = approval date
   - End date = calculated based on billing cycle
   - Old subscription marked as 'cancelled' with note "Upgraded to {new plan}"
   - Prorated credit option (admin decision)

#### Downgrade Process
1. Organization requests lower plan
2. Request type = 'downgrade'
3. Admin approves:
   - New subscription starts at END of current subscription
   - Current subscription continues until expiry
   - Or immediate downgrade (admin choice)

#### Member Limit Enforcement
- On downgrade to plan with lower member limit:
  - If current members > new limit, admin warned
  - Org cannot add new members until under limit
  - Existing members not automatically removed

### Renewal Logic

#### Auto-Renewal (if enabled)
1. Cron job checks subscriptions expiring in X days
2. If autoRenew = true:
   - Create renewal request automatically
   - Admin still needs to approve
   - Send reminder to org about upcoming renewal

#### Manual Renewal
1. Org submits renewal request before expiration
2. Request type = 'renewal'
3. Admin approves:
   - New subscription created
   - Start date = current end date + 1 day
   - Seamless continuation

### Grace Period Handling

```javascript
const GRACE_PERIOD_DAYS = 7;

// When subscription expires
subscription.status = 'expired';
subscription.gracePeriodEnd = new Date(subscription.endDate.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

// Access check considers grace period
if (subscription.isInGracePeriod) {
  // Allow access but show warning
  // Send daily reminders
}

// After grace period
if (subscription.gracePeriodEnd < new Date()) {
  subscription.status = 'suspended';
  // Full access restriction
}
```

### Concurrent Request Prevention
- Organization can only have ONE pending request at a time
- Must cancel pending request before submitting new one
- Exception: Renewal requests allowed if expiring within 30 days

### Plan Changes Impact
- If admin modifies a plan, existing subscriptions NOT affected
- Price locked at purchase time
- Feature changes only affect new subscriptions
- Admin can manually update individual subscriptions if needed

### Free Tier / Trial
- Plan with price = 0 can be created
- Trial period plan with short duration (e.g., 14 days)
- Auto-expire trials without grace period option
- One trial per organization (track in org model)

---

## Implementation Phases

### Phase 1: Core Infrastructure (Priority: HIGH)
1. Create Plan model and migration
2. Create Subscription model
3. Create SubscriptionRequest model
4. Update Organization model
5. Basic CRUD API for plans (admin)
6. Plan seeding with default plans

### Phase 2: Admin UI (Priority: HIGH)
1. Admin authentication/authorization
2. Plans management page
3. Subscription requests page with approve/reject
4. Basic subscriptions list

### Phase 3: Organization UI (Priority: HIGH)
1. Plans display page
2. Request subscription modal
3. Current subscription status page
4. Request history

### Phase 4: Access Control (Priority: HIGH)
1. Hub app launch gate
2. Subscription required page
3. JWT claims enhancement
4. API access validation middleware

### Phase 5: Email Notifications (Priority: MEDIUM)
1. Admin notification on new request
2. Org confirmation on request
3. Approval/rejection notifications
4. Expiration warnings

### Phase 6: Advanced Features (Priority: LOW)
1. Expiration cron job
2. Auto-renewal workflow
3. Grace period handling
4. Revenue analytics dashboard
5. Upgrade/downgrade prorating

---

## File Structure

```
Identityprovider/src/
├── models/
│   ├── Plan.js                    # NEW
│   ├── Subscription.js            # NEW
│   └── SubscriptionRequest.js     # NEW
│
├── routes/
│   ├── adminPlans.js              # NEW - Admin plan management
│   ├── adminSubscriptions.js      # NEW - Admin subscription management
│   ├── adminSubscriptionRequests.js # NEW - Admin request management
│   ├── plans.js                   # NEW - Public plans endpoints
│   └── subscriptions.js           # NEW - Org subscription endpoints
│
├── middleware/
│   ├── subscriptionAuth.js        # NEW - Subscription access checks
│   └── adminAuth.js               # NEW - Admin authentication
│
├── services/
│   └── subscriptionService.js     # NEW - Business logic
│
├── jobs/
│   └── subscriptionExpiry.js      # NEW - Expiration cron job
│
├── views/
│   ├── admin/
│   │   ├── dashboard.ejs          # NEW
│   │   ├── plans.ejs              # NEW
│   │   ├── subscriptions.ejs      # NEW
│   │   └── subscription-requests.ejs # NEW
│   ├── plans.ejs                  # NEW - Public plans page
│   ├── subscription.ejs           # NEW - Org subscription page
│   └── subscription-required.ejs  # NEW - Access denied page
│
└── public/
    └── css/
        └── admin.css              # NEW - Admin styles
```

---

## Default Plans (Seed Data)

```javascript
const defaultPlans = [
  {
    name: 'Starter',
    slug: 'starter',
    description: 'Perfect for small teams getting started',
    pricing: {
      monthly: 0,
      yearly: 0,
      currency: 'NGN'
    },
    limits: {
      maxMembers: 5,
      maxTeams: 2
    },
    features: {
      recruiter: false,
      leaveManagement: false,
      payrollManagement: false,
      performanceManagement: false,
      outlineDocs: false,
      aiChat: false,
      lms: true
    },
    displayOrder: 1,
    badgeText: 'Free'
  },
  {
    name: 'Professional',
    slug: 'professional',
    description: 'For growing teams with HR needs',
    pricing: {
      monthly: 5000000, // ₦50,000
      yearly: 50000000, // ₦500,000 (2 months free)
      yearlyDiscount: 17,
      currency: 'NGN'
    },
    limits: {
      maxMembers: 50,
      maxTeams: 10
    },
    features: {
      recruiter: true,
      leaveManagement: true,
      payrollManagement: false,
      performanceManagement: false,
      outlineDocs: true,
      aiChat: true,
      lms: true
    },
    displayOrder: 2,
    badgeText: 'Popular',
    isFeatured: true
  },
  {
    name: 'Enterprise',
    slug: 'enterprise',
    description: 'Full suite for large organizations',
    pricing: {
      monthly: 15000000, // ₦150,000
      yearly: 150000000, // ₦1,500,000 (2 months free)
      yearlyDiscount: 17,
      currency: 'NGN'
    },
    limits: {
      maxMembers: null, // Unlimited
      maxTeams: null
    },
    features: {
      recruiter: true,
      leaveManagement: true,
      payrollManagement: true,
      performanceManagement: true,
      outlineDocs: true,
      aiChat: true,
      lms: true
    },
    displayOrder: 3,
    badgeText: 'Best Value'
  }
];
```

---

## Security Considerations

1. **Admin Authentication**: Separate admin login with strong credentials
2. **Rate Limiting**: Limit subscription request submissions
3. **Input Validation**: Validate all contact info (email, phone format)
4. **Audit Logging**: Log all subscription changes with admin ID
5. **Price Integrity**: Lock prices at purchase, prevent manipulation
6. **Access Token Claims**: Include subscription info for downstream apps
7. **Webhook Security**: Sign webhooks to downstream apps about subscription changes

---

## Monitoring & Alerts

1. **Pending Requests Alert**: Notify admin if requests pending > 24 hours
2. **Expiration Reports**: Daily report of expiring subscriptions
3. **Failed Payment Tracking**: If payment integration added later
4. **Usage Metrics**: Track feature usage per plan for analytics

---

## Future Enhancements

1. **Payment Integration**: Paystack/Flutterwave for auto-billing
2. **Usage-Based Billing**: Charge per member or usage
3. **Custom Quotes**: For enterprise customers
4. **Reseller/Partner Plans**: B2B distribution
5. **API Rate Limits**: Per-plan API quotas
6. **White-Label Options**: Custom branding per subscription tier
