# Product Requirements Document (PRD)
# AI in Nigeria Learning Platform – User Roles & Access Control

**Version:** 2.0  
**Date:** March 10, 2026  
**Status:** Draft (Enhanced from v1.0 after codebase audit)

---

## 1. Executive Summary

This document outlines the requirements for implementing a multi-tiered user role and access control system for the AI in Nigeria / Seemplify Learning platform. The system supports distinct user personas including super users, administrators, channel partners, and partners, each with specific permissions, dashboards, and capabilities.

> [!IMPORTANT]
> **v2.0 Enhancement Note:** This version was enhanced after a deep audit of every model, route, middleware, utility, and view in the seemplify-learning codebase. All "Current Implementation Status" sections now reference exact code locations and data structures. Gaps, conflicts, and new requirements discovered during the audit are called out explicitly.

---

## 2. User Personas & Roles

### 2.1 Role Matrix

| Role | Can Create Courses | Can See Everything | Can Edit Everything | Can Delete Everything | Must See Daily Sales | Must See Complete Financials | Can Add/Remove Agents | Must See Agent Metrics | Must See Commissions Due | Must See Activities |
|------|-------------------|-------------------|-------------------|---------------------|---------------------|---------------------------|---------------------|----------------------|------------------------|---------------------|
| AI in Nigeria Super User | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | - | - | - | - |
| AI in Nigeria Admin | ⚠️ (review only) | ❌ (view only) | ⚠️ (limited) | ❌ | ✅ | ❌ | - | - | - | - |
| Channel Partner Super User | ✅ (within own org) | ✅ | - | - | - | - | ✅ | ✅ (all agents) | ✅ | ✅ |
| Channel Partner User | ⚠️ (draft only) | - | - | - | - | - | ⚠️ (add only) | - | ✅ | - |
| Channel Sales Agent | ❌ | - | - | - | - | - | - | - | - | - |
| Partner Super User | ✅ (within own org) | ✅ | - | - | ✅ | - | - | - | ✅ | ✅ |
| Partner User | ⚠️ (draft only) | - | - | - | - | - | - | - | - | - |
| **Creator** *(existing)* | ✅ (own content) | - | ⚠️ (own content only) | ⚠️ (own content only) | - | - | - | - | ✅ (own commissions) | - |
| **Learner** *(existing)* | ❌ | - | - | - | - | - | - | - | - | - |

> [!NOTE]
> **Creator** and **Learner** roles already exist in the codebase (`Account.learningRole` enum: `['super_admin', 'admin', 'creator', 'learner']`). This matrix now includes them for completeness. Creators can currently manage their own courses and view their own earnings/commissions via the existing payment and withdrawal system.

### 2.2 Detailed Role Descriptions

#### AI in Nigeria Super User
- **Access Level:** Full system access
- **Codebase Mapping:** `Account.learningRole = 'super_admin'` + `Account.isSuperAdmin = true`
- **Capabilities:**
  - View, edit, and delete all data
  - Access to daily sales reports
  - Access to complete financial reports
  - Platform-wide administration (manages `SimpleLmsPlatformSetting`, `SimpleLmsCommissionSetting`)
  - **Can create other super users**
  - **Can manage (promote/demote) other super users**
  - Can assign/revoke super admin privileges
  - Can approve/reject course publish requests (`SimpleLmsRequest`)
  - Can approve/reject withdrawal requests (`SimpleLmsWithdrawal`)
  - Can manage all organizations and subscriptions
  - Can manage commission settings (global rate + per-account/per-course overrides)

> [!IMPORTANT]
> **Codebase finding:** The Account model has BOTH a `learningRole: 'super_admin'` enum value AND a separate `isSuperAdmin: Boolean` flag. The `getLearningRole()` method prioritizes `isSuperAdmin` first, then `isSystemAdmin`, then falls back to the `learningRole` field. Registration bootstraps the first user as super admin by setting BOTH `learningRole: 'super_admin'` AND `isSuperAdmin: true` AND `isSystemAdmin: true`. The super user management feature must keep these in sync.

#### AI in Nigeria Admin
- **Access Level:** Regular admin access
- **Codebase Mapping:** `Account.learningRole = 'admin'` or `Account.isSystemAdmin = true`
- **Capabilities:**
  - View platform data
  - Edit where permitted (limited course management, no financial control)
  - Cannot delete any data
  - Cannot access financials (cannot view `SimpleLmsPayment` totals, `SimpleLmsWithdrawal` data, or `SimpleLmsCommissionSetting`)
  - Can view and manage admin dashboard (course review queue)

> [!NOTE]
> **Codebase finding:** The `Account.statics.findSystemAdmins()` method returns users with `isSystemAdmin: true` OR `isSuperAdmin: true`, meaning super admins are also treated as system admins. This is correct and should be preserved.

#### Creator *(Existing Role — No Changes Required)*
- **Access Level:** Content creator
- **Codebase Mapping:** `Account.learningRole = 'creator'`
- **Capabilities:**
  - Create and manage own courses via Course Studio (`SimpleLmsCourse`, `SimpleLmsEnrollment`)
  - View own sales/earnings (via `SimpleLmsPayment` where `creatorAccount = self`)
  - Request withdrawals (`SimpleLmsWithdrawal`)
  - Self-enroll in courses
  - Upload media via Cloudinary (`cloudinaryService.js`)
  - Configure payout profile (`Account.payoutProfile`)
  - Configure creator settings (`Account.creatorSettings`)

#### Learner *(Existing Role — No Changes Required)*
- **Access Level:** Basic learner
- **Codebase Mapping:** `Account.learningRole = 'learner'` (default for new registrations)
- **Capabilities:**
  - Browse and enroll in public courses
  - Purchase paid courses (via Flutterwave integration)
  - Track learning progress (`SimpleLmsEnrollment.completedLessonKeys`, `progressPercent`)
  - Take quizzes (`SimpleLmsEnrollment.quizAttempts`)

#### Channel Partner Super User *(New Role)*
- **Access Level:** Partner organization administrator
- **Codebase Mapping:** `Account.learningRole = 'channel_partner_super'` *(new enum value)*
- **Capabilities:**
  - View all data within their partner organization
  - **Can create and publish courses within the partner organization** (courses are owned by the partner org, not the individual)
  - **Can edit and manage all courses created under the partner organization**
  - **Can approve or reject draft courses submitted by Channel Partner Users**
  - Add and remove agents (manage agent roster)
  - Must see signed-up agents list
  - Must see agent sales performance
  - Must see agent churn metrics
  - Must see commissions due to agents
  - Must see total agent activities
  - Can manage partner organization settings

> [!WARNING]
> **Codebase gap:** The existing `Organization` model uses HR-oriented roles (`owner, admin, hr_manager, recruiter, interviewer, staff`). Channel Partner organizations will need a separate set of member roles OR a new organization `type` field to distinguish partner orgs from HR orgs. See Section 4.2 for the proposed approach.

#### Channel Partner User *(New Role)*
- **Access Level:** Partner organization staff
- **Codebase Mapping:** `Account.learningRole = 'channel_partner_user'` *(new enum value)*
- **Capabilities:**
  - **Can create draft courses within the partner organization** (cannot publish — must be approved by a Channel Partner Super User)
  - **Can edit own draft courses only** (cannot edit courses created by others or published courses)
  - Sales report collation
  - Commission report collation
  - Can add agents (cannot remove)
  - Simple admin functions within their partner org

#### Channel Sales Agent *(New Role)*
- **Access Level:** Sales representative under a channel partner
- **Codebase Mapping:** `Account.learningRole = 'channel_sales_agent'` *(new enum value)*
- **Capabilities:**
  - **Cannot create courses** — agents sell courses created by the partner organization
  - Limited to own sales activity
  - Basic dashboard access (own sales, own commissions)
  - Can generate referral links for course sales
  - Can view the partner org's course catalog (to know what they are selling)
  - **Must be linked to a parent partner organization** (see Section 4.1)

#### Partner Super User *(New Role)*
- **Access Level:** Partner organization administrator (non-channel)
- **Codebase Mapping:** `Account.learningRole = 'partner_super'` *(new enum value)*
- **Capabilities:**
  - View all partner data
  - **Can create and publish courses within the partner organization**
  - **Can manage all courses under the partner organization**
  - Must see total sales figures
  - Must see sales churn
  - Must see commissions due
  - Must see total activities

#### Partner User *(New Role)*
- **Access Level:** Partner organization staff
- **Codebase Mapping:** `Account.learningRole = 'partner_user'` *(new enum value)*
- **Capabilities:**
  - **Can create draft courses within the partner organization** (cannot publish — requires Partner Super User approval)
  - **Can edit own draft courses only**
  - Sales report collation
  - Commission report collation
  - Simple admin functions within their partner org

---

## 3. Functional Requirements

### 3.1 Registration System

**REQ-001:** The system must support registration for different user types  
**REQ-002:** Registration must capture user intent (learn, teach, partner, channel_partner)  
**REQ-003:** New users must be assigned a default role based on registration type  
**REQ-004:** Admin approval may be required for partner/agent roles

> [!IMPORTANT]
> **Codebase gap — Registration intent:** The current registration system (`routes/auth.js`) only supports two intents: `learn` and `teach` (hardcoded in `LEARNING_INTENTS = ['learn', 'teach']`). The `Account.learningProfile.registrationIntent` enum also only allows `['learn', 'teach', 'unknown']`. Both must be extended to support `partner` and `channel_partner` intents. The `sanitizeIntent()` function in `auth.js` also needs updating.

> [!IMPORTANT]
> **Codebase gap — Role assignment:** Currently, all new registrations (except the bootstrap super admin) are assigned `learningRole: 'learner'` regardless of intent (`const roleFromIntent = 'learner'` on line 207 of `auth.js`). The registration flow must implement role-based assignment logic, likely with an approval step for partner/agent roles rather than immediate role assignment.

### 3.2 Authentication System

**REQ-005:** The system must support login for all user types  
**REQ-006:** Session management must persist across page loads  
**REQ-007:** Role-based redirects after login (different dashboards per role)  
**REQ-008:** Password reset functionality for all users

> [!NOTE]
> **Codebase status:** REQ-005 and REQ-006 are already implemented. Session uses `express-session` with 14-day cookie expiry, stored in the `seemplify_learning_session` cookie. REQ-007 is partially implemented — all roles redirect to `/simple-lms` after login. REQ-008 (password reset) has **no implementation** — there is no password reset route in `auth.js`.

### 3.3 Dashboard & Access Control

**REQ-009:** Each user type must see a dashboard appropriate to their access level  
**REQ-010:** Super users must see daily sales metrics  
**REQ-011:** Super users must see complete financial reports  
**REQ-012:** Partner super users must see agent-specific metrics  
**REQ-013:** Channel partners must manage their agent roster (add/remove)  
**REQ-014:** Role-based navigation menu items must be displayed/hidden appropriately

> [!NOTE]
> **Codebase status:** The admin dashboard exists at `views/admin-dashboard.ejs` (86KB) and the main LMS dashboard at `views/simple-lms.ejs` (123KB). The `resolveLearningRole()` function in `index.js` determines the user's effective role, but there is **no role-based middleware** that gates access to specific routes. Role-checking is done ad-hoc within individual route handlers. This needs to be formalized into a proper role-based access control middleware.

### 3.4 Super User Management

**REQ-014a:** Super users can create other super users  
**REQ-014b:** Super users can promote users to super user role  
**REQ-014c:** Super users can demote/revoke super user privileges from other super users  
**REQ-014d:** Super users can view list of all super users  
**REQ-014e:** Super user management actions must be logged for audit purposes  
**REQ-014f:** Cannot demote the last remaining super user (safety check)

> [!NOTE]
> **Codebase status:** The Account model already has `Account.statics.findSuperAdmins()` which queries `{ isSuperAdmin: true }`. The bootstrap logic in `auth.js` already checks `Account.exists({ $or: [{ isSuperAdmin: true }, { learningRole: 'super_admin' }] })` before bootstrapping the first super admin. The static methods provide a foundation, but no management UI or API endpoints exist yet.

> [!IMPORTANT]
> **Implementation detail:** When promoting a user to super_admin, BOTH `Account.learningRole` AND `Account.isSuperAdmin` (and potentially `Account.isSystemAdmin`) must be updated together to maintain consistency with the `getLearningRole()` method's priority logic. When demoting, the user's previous `learningRole` should be restored (e.g., back to `learner` or `creator`).

### 3.5 Partner Course Creation & Management

**REQ-014g:** Channel Partner Super Users and Partner Super Users can create and publish courses within their partner organization  
**REQ-014h:** Channel Partner Users and Partner Users can create draft courses within their partner organization, but cannot publish — drafts must be approved by the respective Super User  
**REQ-014i:** Channel Sales Agents **cannot** create courses — they can only sell courses owned by their partner organization  
**REQ-014j:** Courses created within a partner organization must be owned by the organization (`SimpleLmsCourse.organization = partnerOrgId`), not by the individual user  
**REQ-014k:** Partner Super Users can edit or archive any course within their organization; Partner Users can only edit their own drafts  
**REQ-014l:** Agents must have read-only access to view the partner org's course catalog so they know what they are selling

> [!IMPORTANT]
> **Codebase impact:** The existing `SimpleLmsCourse` model already has an `organization` field (ObjectId ref to `AiinOrganization`) and a `createdBy` field (ObjectId ref to `AiinAccount`). For partner-created courses, `organization` would be set to the partner org and `createdBy` to the individual creator. The `visibility` field supports `organization_private` and `organization_public` which map naturally to partner courses that are internal vs. available for agents to sell. However, the current Course Studio (`views/course-studio.ejs`) does not enforce org-level ownership — it must be updated to scope course creation and editing based on the user's partner role.

### 3.6 Agent Management (Channel Partners)

**REQ-015:** Channel Partner Super Users can invite/remove agents  
**REQ-016:** Agents must be associated with a parent partner organization  
**REQ-017:** Partner admins can view all agents under their organization  
**REQ-018:** Agent performance metrics must be trackable

> [!WARNING]
> **Codebase gap — Agent-to-partner relationship:** There is currently NO mechanism to link an agent (`channel_sales_agent` role) to a specific partner organization. The existing `Organization` model supports member management (add/remove/role), but its role enum (`owner, admin, hr_manager, recruiter, interviewer, staff`) is HR-focused and does not include agent roles. See Section 4.2 for the proposed approach.

### 3.6 Reporting & Analytics

**REQ-019:** Daily sales reports must be generated and accessible  
**REQ-020:** Financial reports must show revenue, commissions, payouts  
**REQ-021:** Agent sales reports must show individual and aggregate performance  
**REQ-022:** Churn metrics must be tracked and reported  
**REQ-023:** Commission due reports must be generated per agent

> [!NOTE]
> **Codebase status:** The existing data models support sales reporting. `SimpleLmsPayment` tracks all payments with `amountMinor`, `creatorCommissionMinor`, `platformShareMinor`, and `status`. `SimpleLmsWithdrawal` tracks payout requests. The admin dashboard (`admin-dashboard.ejs`) already renders some analytics. However, these are currently only creator-centric — there is no concept of agent-attributed sales or partner-level aggregation.

### 3.7 Commission Management

**REQ-024:** System must calculate commissions due to agents/partners  
**REQ-025:** Commission rates can be set globally or per agent  
**REQ-026:** Commission payout processing must be supported  
**REQ-027:** Commission reports must be exportable

> [!NOTE]
> **Codebase status — Existing commission infrastructure:** `SimpleLmsCommissionSetting` already supports:
> - Global commission rate (default 70% to creator, 30% platform)
> - Per-account overrides (`accountOverrides[]`)
> - Per-course overrides (`courseOverrides[]`)
>
> `SimpleLmsPayment` already tracks `creatorCommissionRate`, `creatorCommissionMinor`, and `platformShareMinor` per payment.
>
> **Gap:** The commission system is designed for **creator** commissions only (platform → creator split). Agent/partner commissions would be a different flow: when an agent generates a sale, their commission must be carved out from either the platform share or as an additional split. This requires a new commission layer (see Section 4.6).

---

## 4. Technical Requirements

### 4.1 User Model Extensions

**REQ-028:** Extend Account model with new role types:

```
Current learningRole enum:  ['super_admin', 'admin', 'creator', 'learner']
Proposed learningRole enum: ['super_admin', 'admin', 'creator', 'learner',
                             'channel_partner_super', 'channel_partner_user',
                             'channel_sales_agent', 'partner_super', 'partner_user']
```

> [!IMPORTANT]
> **Code location:** `src/models/Account.js` line 68-71.
> The `getLearningRole()` method (line 284-293) currently validates against a hardcoded array `['super_admin', 'admin', 'creator', 'learner']` and falls back to `'learner'` for any unrecognized value. This method AND the `resolveLearningRole()` function in `src/index.js` (line 79-88) must BOTH be updated to recognize the new role values.

**REQ-028a:** Add partner organization link to Account model:

```
partnerOrganization: {
  type: ObjectId,
  ref: 'AiinOrganization',
  default: null
}
```

> [!NOTE]
> **Rationale:** While the Account model already has an `organizations[]` membership array with org-level roles, partner/agent users need a direct, fast-lookup reference to their partner organization. This avoids scanning the entire memberships array for every request.

**REQ-029:** Extend `learningProfile.registrationIntent` enum:

```
Current:  ['learn', 'teach', 'unknown']
Proposed: ['learn', 'teach', 'partner', 'channel_partner', 'unknown']
```

> [!NOTE]
> **Code location:** `src/models/Account.js` line 74-78. Also update `LEARNING_INTENTS` constant in `src/routes/auth.js` line 10.

**REQ-030:** Add agent-to-partner relationship tracking (see REQ-028a above)

### 4.2 Organization Model Extensions

**REQ-031:** Add partner type field to Organization model:

```
partnerType: {
  type: String,
  enum: ['none', 'channel_partner', 'partner'],
  default: 'none',
  index: true
}
```

> [!IMPORTANT]
> **Design decision — Reuse vs. new model:** The existing `Organization` model (`src/models/Organization.js`) already has robust member management (add, remove, update role, transfer ownership, app access control), subscription/plan linkage, and settings. Rather than creating a completely separate partner model, the recommended approach is to **extend the existing Organization model** with a `partnerType` discriminator field. This preserves all existing infrastructure (member management, subscriptions, etc.) and avoids duplicating 500+ lines of tested code.

**REQ-032:** Add partner-specific member roles to Organization:

```
Current member roles:  ['owner', 'admin', 'hr_manager', 'recruiter', 'interviewer', 'staff']
Proposed member roles: ['owner', 'admin', 'hr_manager', 'recruiter', 'interviewer', 'staff',
                        'partner_admin', 'partner_user', 'sales_agent']
```

> [!NOTE]
> **Code location:** `src/models/Organization.js` line 29. This enum appears in TWO places: the Organization member sub-schema (line 29) AND the Account `organizationMembershipSchema` (line 10). Both must be kept in sync.

**REQ-033:** Add agent roster management and metrics to organization:

```
partnerSettings: {
  maxAgents: { type: Number, default: null },  // null = unlimited
  defaultAgentCommissionRate: { type: Number, min: 0, max: 100, default: 10 },
  agentInviteApproval: { type: Boolean, default: true },
  partnerStatus: { type: String, enum: ['pending', 'active', 'suspended'], default: 'pending' }
}
```

### 4.3 Role-Based Access Control Middleware *(New — Not in v1.0)*

> [!IMPORTANT]
> **Codebase gap:** The current auth middleware (`src/middleware/auth.js`) only provides `requireAuth` (checks if logged in) and `optionalAuth` (attaches user if logged in). There is **no role-based middleware**. All role checks are done inline within route handlers. This is fragile and error-prone.

**REQ-033a:** Create a `requireRole()` middleware factory:

```javascript
// Usage: router.get('/admin/users', requireAuth, requireRole(['super_admin', 'admin']), handler)
function requireRole(allowedRoles) { ... }
```

**REQ-033b:** Create a `requirePartnerAccess()` middleware for partner-specific routes:

```javascript
// Validates: user belongs to the partner org in the route param AND has appropriate role
function requirePartnerAccess(allowedPartnerRoles) { ... }
```

### 4.4 API Endpoints

**REQ-034:** POST /api/users/register - Register new user with role  
**REQ-035:** GET /api/users/me - Get current user with role details  
**REQ-036:** GET /api/dashboard/:role - Get role-specific dashboard data  
**REQ-037:** GET /api/partners/:id/agents - List agents under partner  
**REQ-038:** POST /api/partners/:id/agents - Add agent to partner  
**REQ-039:** DELETE /api/partners/:id/agents/:agentId - Remove agent  
**REQ-040:** GET /api/reports/sales - Get sales reports (role-filtered)  
**REQ-041:** GET /api/reports/commissions - Get commission reports

> [!NOTE]
> **Codebase status:** The existing API router is mounted at `/api/simple-lms` (see `index.js` line 664). New partner/agent API endpoints should follow this pattern or use a new `/api/partners` prefix. The existing `simpleLmsApiRouter` in `routes/simpleLms.js` (231KB) handles all current LMS API operations.

### 4.5 Super User Management API

**REQ-041a:** GET /api/super-users - List all super users (super admin only)  
**REQ-041b:** POST /api/super-users - Create new super user (super admin only)  
**REQ-041c:** PUT /api/super-users/:id/promote - Promote user to super user (super admin only)  
**REQ-041d:** PUT /api/super-users/:id/demote - Demote super user to regular role (super admin only)  
**REQ-041e:** DELETE /api/super-users/:id - Remove super user privileges (super admin only)

> [!NOTE]
> **Implementation note:** When promoting/demoting, must update: `Account.learningRole`, `Account.isSuperAdmin`, and `Account.isSystemAdmin` in a single atomic operation to maintain consistency with `getLearningRole()`.

### 4.6 Agent Commission Model *(New — Not in v1.0)*

> [!IMPORTANT]
> **Codebase gap:** The existing commission system (`SimpleLmsCommissionSetting`) only handles the platform-to-creator commission split. Agent commissions are a fundamentally different flow and need their own tracking.

**REQ-041f:** Create an agent commission tracking mechanism. When a sale is attributed to an agent:

```
AgentSaleAttribution: {
  payment: ObjectId → SimpleLmsPayment,
  agent: ObjectId → Account,
  partnerOrganization: ObjectId → Organization,
  commissionRatePercent: Number,
  commissionAmountMinor: Number,
  status: ['pending', 'approved', 'paid'],
  attributedAt: Date,
  paidAt: Date
}
```

**REQ-041g:** Agent sales attribution via referral codes or tracking links  
**REQ-041h:** Agent commission rates configurable at partner org level (via `partnerSettings.defaultAgentCommissionRate`) and overridable per-agent

### 4.7 Audit Log Model *(New — Not in v1.0)*

> [!IMPORTANT]
> **Codebase gap:** No audit logging infrastructure exists. REQ-014e requires logging super user management actions. This extends to all sensitive administrative actions.

**REQ-041i:** Create an audit log model:

```
AuditLog: {
  action: String,           // 'super_user.promote', 'super_user.demote', 'agent.add', etc.
  performedBy: ObjectId → Account,
  targetAccount: ObjectId → Account (optional),
  targetOrganization: ObjectId → Organization (optional),
  metadata: Mixed,
  ipAddress: String,
  createdAt: Date
}
```

### 4.8 UI/UX Requirements

**REQ-042:** Mobile-first responsive design  
**REQ-043:** Role-specific dashboard views  
**REQ-044:** Accessible navigation based on permissions

> [!NOTE]
> **Codebase status:** The existing views use EJS templates with inline CSS. The main dashboard (`simple-lms.ejs` at 123KB) and admin dashboard (`admin-dashboard.ejs` at 86KB) are already mobile-responsive. New partner/agent dashboards should follow the same EJS + inline CSS pattern for consistency. The branding system (`utils/branding.js`) supports dual-branding (AIIN Nigeria vs. Seemplify) and must be applied to all new views.

---

## 5. Non-Functional Requirements

### 5.1 Internationalization

**REQ-045:** Primary language: English  
**REQ-046:** Secondary languages (future): Pidgin, Hausa, Igbo, Yoruba  
**REQ-047:** Language selection in user settings

### 5.2 Offline Capability

**REQ-048:** Progressive Web App (PWA) support  
**REQ-049:** Service worker for offline data access  
**REQ-050:** Sync mechanism for offline-to-online data

### 5.3 Security *(New — Not in v1.0)*

**REQ-051:** All partner/agent management API endpoints must validate that the requesting user belongs to the target organization AND has an appropriate role  
**REQ-052:** Super user management actions must require re-authentication or a confirmation step  
**REQ-053:** Agent invitation links must be time-limited and single-use

> [!WARNING]
> **Codebase finding — Session security:** The session configuration in `index.js` (line 32-43) currently has `secure: false` for cookies. In production, this should be `secure: true` to prevent session hijacking over HTTP. Additionally, there is no CSRF protection middleware — this should be added before implementing sensitive administrative operations.

### 5.4 Password Reset *(New — Not in v1.0)*

**REQ-054:** Users must be able to reset their password via email  
**REQ-055:** Password reset tokens must expire after 1 hour  
**REQ-056:** Password reset must use the existing email service (`services/emailService.js`)

> [!NOTE]
> **Codebase status:** An `emailService.js` already exists in `src/services/` (1.4KB). This should be leveraged for sending password reset emails. Flutterwave integration (`flutterwaveService.js`) also exists for potential future payment-related notifications.

---

## 6. Current Implementation Status (Verified Against Codebase)

### 6.1 Already Implemented ✅

| Feature | Location | Details |
|---------|----------|---------|
| Basic Registration | `routes/auth.js` GET/POST `/register` | Supports `learn`/`teach` intents only; first user bootstrapped as super admin |
| Login | `routes/auth.js` GET/POST `/login` + `/admin/login` | Session-based auth with 14-day expiry |
| Logout | `routes/auth.js` GET/POST `/logout` | Clears session and cookie |
| User Roles (4 types) | `models/Account.js` `learningRole` enum | `super_admin`, `admin`, `creator`, `learner` |
| Super Admin Flags | `models/Account.js` `isSuperAdmin`, `isSystemAdmin` | Boolean flags with priority in `getLearningRole()` |
| Role Resolution | `index.js` `resolveLearningRole()` + `Account.getLearningRole()` | Prioritizes: `isSuperAdmin` → `isSystemAdmin` → `learningRole` field |
| Organization Model | `models/Organization.js` (525 lines) | Full member management, role control, ownership transfer, subscription linkage |
| Organization Memberships | `models/Account.js` `organizations[]` sub-schema | Bidirectional: Account ↔ Organization with role + app access |
| Team Model | `models/Team.js` (12KB) | Hierarchical teams with parent-child relationships |
| Hierarchy-Scoped Access | `utils/simpleLms.js` `getSimpleLmsAccessScope()` | Manager roles see their team subtree |
| Commission Settings | `models/SimpleLmsCommissionSetting.js` | Global 70% rate + per-account/per-course overrides |
| Payment Tracking | `models/SimpleLmsPayment.js` | Flutterwave integration with creator commission breakdown |
| Withdrawal System | `models/SimpleLmsWithdrawal.js` | Creator payout requests with approval workflow |
| Course Management | `models/SimpleLmsCourse.js` (359 lines) | Full CRUD, chapters/lessons, pricing, visibility, review pipeline |
| Enrollment System | `models/SimpleLmsEnrollment.js` (151 lines) | Org/team/self enrollment with progress tracking and quizzes |
| Permission System | `models/SimpleLmsPermission.js` | Per-org publish-without-review grants |
| Request System | `models/SimpleLmsRequest.js` | Course access, publish, and review requests |
| Platform Settings | `models/SimpleLmsPlatformSetting.js` | Global platform configuration |
| Subscription/Plans | `models/Subscription.js` (364 lines) + `models/Plan.js` | Full subscription lifecycle with grace periods, features, limits |
| Currency Service | `services/simpleLmsCurrencyService.js` | Multi-currency support (default NGN) |
| Cloudinary Media | `services/cloudinaryService.js` | Image/video upload for course content |
| Dual Branding | `utils/branding.js` | AIIN Nigeria vs. Seemplify based on hostname |
| App Access Control | `utils/appAccess.js` | Per-member app access filtering |
| Dashboard Views | `views/simple-lms.ejs` (123KB), `views/admin-dashboard.ejs` (86KB) | Full admin and user dashboards |
| Course Studio | `views/course-studio.ejs` (92KB) | Course creation/editing interface |
| Responsive UI | All EJS views | CSS mobile-first design |

### 6.2 Not Yet Implemented ❌

| Feature | Priority | Effort Estimate | Dependencies |
|---------|----------|-----------------|--------------|
| Extend `learningRole` enum with 5 new values | **Critical** | Small | None |
| Extend `registrationIntent` enum (+ auth.js intents) | **Critical** | Small | None |
| Role-based access middleware (`requireRole()`) | **Critical** | Medium | REQ-028 |
| Role-based registration flow (intent → role assignment) | **High** | Medium | REQ-028, REQ-029 |
| Channel Partner roles & dashboard | **High** | Large | REQ-028, REQ-031, REQ-033a |
| Partner roles & dashboard | **High** | Large | REQ-028, REQ-031, REQ-033a |
| Organization `partnerType` field | **High** | Small | None |
| Partner-specific Organization member roles | **High** | Medium | REQ-031, REQ-032 |
| Agent management system (add/remove/roster) | **High** | Large | REQ-031, REQ-032, REQ-028a |
| Agent sales attribution & tracking | **High** | Large | REQ-041f, REQ-041g |
| Agent commission model | **High** | Medium | REQ-041f, REQ-041h |
| Agent churn metrics | **Medium** | Medium | REQ-041f |
| Partner-specific dashboards (EJS views) | **High** | Large | REQ-043 |
| Super user management (create/promote/demote) | **High** | Medium | REQ-014a-f |
| Super user management UI | **High** | Medium | REQ-041a-e |
| Audit logging model & integration | **High** | Medium | REQ-041i |
| Password reset flow | **Medium** | Medium | REQ-054-056, `emailService.js` |
| Role-based login redirect | **Medium** | Small | REQ-007, REQ-028 |
| **Security hardening** (CSRF, secure cookies) | **High** | Small | REQ-051-053 |
| Multi-language support | **Low** | Large | REQ-045-047 |
| Offline/PWA capability | **Low** | Large | REQ-048-050 |

---

## 7. Implementation Phases

### Phase 1: Core User Roles & Access Control Foundation (Week 1–2)
- Extend `Account.learningRole` enum with 5 new role values
- Extend `learningProfile.registrationIntent` enum
- Add `partnerOrganization` field to Account
- Create `requireRole()` middleware
- Create `requirePartnerAccess()` middleware
- Update `getLearningRole()` and `resolveLearningRole()` to recognize new roles
- Update `auth.js` `LEARNING_INTENTS`, `sanitizeIntent()`, and registration flow
- Security hardening: add CSRF protection, set `secure: true` for production cookies

### Phase 1.5: Super User Management (Week 2–3)
- Build super user CRUD API (list, create, promote, demote)
- Add safety checks (cannot demote last super user, keep `isSuperAdmin`/`isSystemAdmin`/`learningRole` in sync)
- Create audit log model and integrate with super user actions
- UI for super user management in admin dashboard

### Phase 2: Partner Organization & Agent System (Week 3–5)
- Add `partnerType` field to Organization model
- Extend Organization member roles for partner contexts
- Add `partnerSettings` sub-schema to Organization
- Implement partner organization creation flow (with approval)
- Build agent roster management (invite, add, remove, list)
- Implement agent-to-partner linking via `Account.partnerOrganization`
- Create agent invitation system (time-limited invite links)
- Build partner/agent registration flow with intent-based routing

### Phase 3: Agent Sales Attribution & Commission (Week 5–7)
- Create agent sale attribution model (`AgentSaleAttribution`)
- Implement referral code / tracking link system for agents
- Build agent commission calculation (per-partner default + per-agent override)
- Integrate agent commission into payment flow (update `SimpleLmsPayment` processing)
- Create agent commission payout workflow (separate from creator withdrawal)

### Phase 4: Dashboards & Reports (Week 7–9)
- Create partner super user dashboard (agents, sales, churn, commissions)
- Create channel partner user dashboard (sales collation, commission view)
- Create agent dashboard (own sales, own commissions)
- Build daily sales report views (for super users and partner super users)
- Build financial reports (revenue, commissions, payouts — super user only)
- Build agent performance metrics (individual + aggregate)
- Build churn metrics tracking and display
- Commission reports with export functionality

### Phase 5: Polish & Hardening (Week 9–10)
- Password reset flow implementation
- Role-based login redirects (super user → admin dashboard, partner → partner dashboard, etc.)
- Mobile responsive refinements for all new views
- Apply dual-branding (AIIN Nigeria / Seemplify) to all new templates
- End-to-end testing of all role-based access paths
- Audit log review and completeness check

### Phase 6: Future Extensions (Post-MVP)
- i18n setup (English first, then Pidgin/Hausa/Igbo/Yoruba)
- Offline capability (PWA + service worker)
- Advanced analytics (trends, forecasting)
- Multi-factor authentication for super users

---

## 8. Open Questions

1. ~~Should channel partners and partners be separate organization types or use the same model with different flags?~~  
   **Resolved:** Use the existing Organization model with a new `partnerType` discriminator field (`'none' | 'channel_partner' | 'partner'`). This preserves all existing member management, subscription, and team infrastructure.

2. What specific churn metrics need to be tracked? (Consider: agent attrition rate, time-to-first-sale, sales decline over period, learner drop-off per agent)

3. Is there a maximum number of agents per partner? (Proposed: configurable via `partnerSettings.maxAgents`, defaulting to unlimited)

4. What approval workflow for agent registration? (Proposed: Channel Partner Super User invites via link → agent registers with link → auto-joined to partner org)

5. Should commission calculations be real-time or batched? (Recommendation: real-time attribution on payment success, batched payout processing)

6. ~~Should super user creation require multi-factor authentication?~~  
   **Recommendation:** Defer MFA to Phase 6. For now, require re-authentication (password re-entry) before super user promotion/demotion operations.

7. Should there be a limit on the number of super users? (Recommendation: No hard limit, but audit log all super user management actions)

8. Should super user demotion require confirmation/double approval? (Recommendation: Yes — require the acting super user to confirm via a modal dialog + re-enter password)

9. **[New]** How should the agent commission split work relative to the existing creator commission? Options:
   - Agent commission carved from the **platform share** (creator keeps their full commission)
   - Agent commission carved from the **total sale** (reducing both creator and platform shares proportionally)  
   **Recommendation:** Carve from platform share to avoid impacting creator earnings.

10. **[New]** Should partner organizations require subscription plans, or are they free-tier? The existing `Subscription`/`Plan` infrastructure supports per-org subscription status — should this gate partner features?

11. **[New]** Should the existing `Organization.hasPermission()` method (line 398-437) be extended with partner-specific permissions (e.g., `manage_agents`, `view_agent_metrics`, `manage_agent_commissions`), or should a separate permission system be used?

12. **[New]** For partner-created courses: Can agents sell **only** the courses owned by their partner organization, or can they also sell any publicly available course on the platform and earn agent commissions? This determines whether the agent referral system is scoped to the partner org's catalog or platform-wide. **Recommendation:** Start with org-scoped (agents sell their partner's courses), then expand to platform-wide in a later phase.

---

## 9. Appendix

### A. Existing Code References (Verified)

| File | Path | Lines | Purpose |
|------|------|-------|---------|
| Account model | `src/models/Account.js` | 300 | User accounts with learningRole, org memberships, payout profile |
| Organization model | `src/models/Organization.js` | 525 | Org management with members, roles, subscriptions |
| Team model | `src/models/Team.js` | ~500 | Hierarchical team structure |
| Auth routes | `src/routes/auth.js` | 279 | Login, register, logout |
| Auth middleware | `src/middleware/auth.js` | 42 | requireAuth, optionalAuth (session-based) |
| Main app entry | `src/index.js` | 693 | Express app setup, route mounting, role resolution |
| SimpleLms routes | `src/routes/simpleLms.js` | ~7000 | LMS operations, dashboard, admin, API |
| Commission settings | `src/models/SimpleLmsCommissionSetting.js` | 98 | Global + per-account/course commission rates |
| Payment model | `src/models/SimpleLmsPayment.js` | 118 | Flutterwave payment tracking with commission split |
| Withdrawal model | `src/models/SimpleLmsWithdrawal.js` | 135 | Creator payout request lifecycle |
| Enrollment model | `src/models/SimpleLmsEnrollment.js` | 151 | Course enrollment with progress and quiz tracking |
| Course model | `src/models/SimpleLmsCourse.js` | 359 | Course content with chapters, lessons, pricing |
| Permission model | `src/models/SimpleLmsPermission.js` | 71 | Per-org publish-without-review grants |
| Platform settings | `src/models/SimpleLmsPlatformSetting.js` | 131 | Global platform configuration |
| Request model | `src/models/SimpleLmsRequest.js` | 140 | Course access and publish requests |
| Subscription model | `src/models/Subscription.js` | 364 | Org subscription lifecycle with plans |
| App access utils | `src/utils/appAccess.js` | 49 | Per-member app access filtering |
| Branding utils | `src/utils/branding.js` | 24 | AIIN Nigeria vs. Seemplify dual-branding |
| SimpleLms utils | `src/utils/simpleLms.js` | 328 | Org hierarchy scoping, progress calculation |
| Currency service | `src/services/simpleLmsCurrencyService.js` | ~150 | Multi-currency support |
| Email service | `src/services/emailService.js` | ~50 | Email sending (available for password reset) |
| Cloudinary service | `src/services/cloudinaryService.js` | ~200 | Media upload for courses |
| Flutterwave service | `src/services/flutterwaveService.js` | ~80 | Payment processing |

### B. Critical Code Patterns to Preserve

1. **Dual role resolution:** `getLearningRole()` (Account method) and `resolveLearningRole()` (index.js function) must stay in sync
2. **Bootstrap super admin:** First registration auto-promotes to super_admin — must continue working
3. **Bidirectional org membership:** When adding/removing org members, BOTH `Organization.members[]` AND `Account.organizations[]` are updated
4. **Pre-save hooks:** All models use pre-save hooks for normalization — new models should follow this pattern
5. **Currency handling:** Amounts stored as minor units (kobo/cents), displayed via `formatCurrencyAmount()`
6. **Branding:** All views must call `resolveBranding(req.hostname)` for dual-brand support
7. **Session cookie name:** `seemplify_learning_session` — must not change

### C. Related Documents

- SimpleLms Documentation
- API Specification
- UI/UX Design Guidelines
