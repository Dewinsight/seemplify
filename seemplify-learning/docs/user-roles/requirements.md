# Functional & Non-Functional Requirements
# AI in Nigeria Learning Platform — User Roles & Access Control

**Version:** 1.0  
**Date:** March 10, 2026  
**Companion to:** [PRD-user-roles.md](./PRD-user-roles.md)

---

## 1. Functional Requirements

### 1.1 User Registration & Onboarding

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-REG-01 | System must support 4 registration intents: `learn`, `teach`, `partner`, `channel_partner` | Critical | Registration form includes intent selector; intent stored in `learningProfile.registrationIntent` |
| FR-REG-02 | Default role assignment based on intent: `learn → learner`, `teach → learner` (upgraded to creator via onboarding), `partner → partner_user` (pending approval), `channel_partner → channel_partner_user` (pending approval) | Critical | New account's `learningRole` matches intent mapping |
| FR-REG-03 | Partner/channel partner registrations must require admin approval before role activation | High | Account created with `learningRole: 'learner'` and a pending approval request; role upgraded only after admin approval |
| FR-REG-04 | First user registered in the system must be bootstrapped as `super_admin` | Critical | Existing bootstrap logic preserved: sets `learningRole`, `isSuperAdmin`, `isSystemAdmin` |
| FR-REG-05 | Partner registration must capture organization name and partner type | High | Registration form collects org name; Organization created with `partnerType` set |
| FR-REG-06 | Agent registration must be invitation-only via a time-limited link from a Channel Partner Super User | High | No self-registration for agents; invite link expires after configurable period |

### 1.2 Authentication & Session Management

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-AUTH-01 | All user types must log in via the same `/login` endpoint | Critical | Single login form; role-specific redirect after authentication |
| FR-AUTH-02 | Role-based redirect after login | High | `super_admin/admin → /admin`, `channel_partner_super/partner_super → /partner-dashboard`, `channel_sales_agent → /agent-dashboard`, `creator → /simple-lms`, `learner → /simple-lms` |
| FR-AUTH-03 | Password reset via email | Medium | User submits email → receives reset link → link expires in 1 hour → password updated |
| FR-AUTH-04 | Session expiry: 14 days (existing) | Critical | No change to existing session configuration |
| FR-AUTH-05 | Re-authentication required for sensitive actions (super user promotion/demotion) | High | Password re-entry modal before super user management actions |

### 1.3 Role-Based Access Control

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-RBAC-01 | `requireRole(allowedRoles)` middleware must gate all protected routes | Critical | Routes return 403 for unauthorized roles; middleware checks `getLearningRole()` |
| FR-RBAC-02 | `requirePartnerAccess(allowedPartnerRoles)` middleware must validate org membership + role | Critical | Routes return 403 if user is not a member of the target partner org |
| FR-RBAC-03 | Navigation menu items must show/hide based on user role | High | Each EJS view conditionally renders nav items using `resolveLearningRole()` |
| FR-RBAC-04 | API endpoints must validate role before returning data | Critical | All `/api/` endpoints check role; partner endpoints also verify org membership |

### 1.4 Super User Management

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-SU-01 | Super users can list all super users | High | `GET /api/super-users` returns all accounts with `isSuperAdmin: true` |
| FR-SU-02 | Super users can create new super users from existing accounts | High | `POST /api/super-users` sets `learningRole`, `isSuperAdmin`, `isSystemAdmin` atomically |
| FR-SU-03 | Super users can promote any user to super user | High | `PUT /api/super-users/:id/promote` updates all three fields |
| FR-SU-04 | Super users can demote other super users | High | `PUT /api/super-users/:id/demote` restores previous role |
| FR-SU-05 | Cannot demote the last remaining super user | Critical | API returns 400 if `Account.countDocuments({ isSuperAdmin: true }) === 1` |
| FR-SU-06 | All super user management actions must be audit-logged | High | `AuditLog` entry created for every promote/demote/create action |

### 1.5 Partner Organization Management

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-PO-01 | Admin can create partner organizations with `partnerType: 'channel_partner'` or `'partner'` | High | Organization created via admin dashboard with type set |
| FR-PO-02 | Partner org must have at least one super user (Channel Partner Super User or Partner Super User) | High | Cannot remove last super user from partner org |
| FR-PO-03 | Partner settings configurable: `maxAgents`, `defaultAgentCommissionRate`, `agentInviteApproval` | High | Settings editable by partner super users via partner dashboard |
| FR-PO-04 | Partner org status lifecycle: `pending → active → suspended` | High | Status change requires platform admin approval |

### 1.6 Agent Management

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-AG-01 | Channel Partner Super Users can invite agents via email link | High | Invite email sent with time-limited registration link |
| FR-AG-02 | Channel Partner Super Users can remove agents | High | Agent's `learningRole` reverted; membership removed from org |
| FR-AG-03 | Channel Partner Users can add agents (cannot remove) | High | Add-only permission enforced; remove button hidden/disabled |
| FR-AG-04 | Agent list view shows: name, email, join date, sales count, commission earned | High | Partner dashboard renders agent roster with metrics |
| FR-AG-05 | Agent must be linked to exactly one partner organization | Critical | `Account.partnerOrganization` set on agent registration; cannot join multiple partner orgs |

### 1.7 Partner Course Creation & Management

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-PC-01 | Partner Super Users can create and publish courses within their org | High | Course created with `organization = partnerOrgId`; visibility set to `organization_public` on publish |
| FR-PC-02 | Partner Users can create draft courses (cannot publish) | High | Course status locked to `draft` until partner super user approves |
| FR-PC-03 | Partner Super Users can approve/reject draft courses | High | Approval workflow updates course `status` from `draft` to `published` |
| FR-PC-04 | Partner Super Users can edit/archive any course in their org | High | Full CRUD on all org-owned courses |
| FR-PC-05 | Partner Users can edit only their own drafts | High | Edit restricted to `createdBy === currentUser._id && status === 'draft'` |
| FR-PC-06 | Agents can view (read-only) their partner org's course catalog | High | Agent dashboard shows org courses with sales links; no edit capability |
| FR-PC-07 | Agents cannot create courses | Critical | Course creation UI hidden for `channel_sales_agent` role |

### 1.8 Agent Sales Attribution & Commission

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-SC-01 | Agents can generate unique referral links for courses | High | Link format: `/courses/:id?ref=AGENT_CODE`; code stored in session |
| FR-SC-02 | Sales made via agent referral link are attributed to that agent | High | `AgentSaleAttribution` record created on successful payment |
| FR-SC-03 | Agent commission calculated from platform share (not creator share) | High | Creator commission unaffected; agent commission = `platformShareMinor × agentRate` |
| FR-SC-04 | Commission rates configurable per partner org and per agent | High | Defaults from `partnerSettings.defaultAgentCommissionRate`; per-agent override supported |
| FR-SC-05 | Agent commission payout via separate workflow from creator withdrawals | Medium | New payout approval flow for agent commissions |

### 1.9 Dashboards & Reporting

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-DASH-01 | Super User dashboard shows: daily sales, total revenue, total commissions, total payouts, user counts by role | High | Admin dashboard enhanced with financial summary cards |
| FR-DASH-02 | Partner Super User dashboard shows: agent roster, agent performance, sales by agent, churn metrics, commissions due | High | New partner dashboard view with all partner-specific data |
| FR-DASH-03 | Channel Partner User dashboard shows: sales summary, commission reports, agent list (add-only) | High | Simplified version of partner super user dashboard |
| FR-DASH-04 | Agent dashboard shows: own sales, own commissions, referral link generator, org course catalog | High | New agent dashboard view with self-scoped data |
| FR-DASH-05 | Sales reports must be filterable by date range, agent, course | Medium | Filter controls on all report views |
| FR-DASH-06 | Commission reports must be exportable as CSV | Medium | Export button on commission report pages |

### 1.10 Notifications

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-NOT-01 | Agent invite email sent when Channel Partner Super User invites an agent | High | Email sent via `emailService.js` with invite link |
| FR-NOT-02 | Notification to partner super user when a draft course is submitted for approval | Medium | In-app notification via existing `Notification` model |
| FR-NOT-03 | Notification to partner user when their draft course is approved/rejected | Medium | In-app notification with approval status and notes |
| FR-NOT-04 | Notification to agents when a new course is added to the partner org catalog | Low | Batch notification to all agents in the org |
| FR-NOT-05 | Notification to creator when their withdrawal request is approved, rejected, or paid | High | Email + in-app notification with status and notes |
| FR-NOT-06 | Notification to system admin when a new withdrawal request is submitted | Medium | In-app notification in admin dashboard |

### 1.11 Payment Collection (Flutterwave)

> **Existing system — continues unchanged.** The Flutterwave payment integration is already implemented. These requirements document the current behavior to ensure it is preserved and understood in context of the new user roles.

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-PAY-01 | Course payments must be processed via Flutterwave payment gateway | Critical | `SimpleLmsPayment` created with `provider: 'flutterwave'`; checkout URL generated via `flutterwaveService.createFlutterwavePaymentLink()` |
| FR-PAY-02 | Payment flow: initiate → redirect to Flutterwave checkout → redirect back → verify transaction | Critical | Payment status lifecycle: `initiated → pending → successful / failed / cancelled` |
| FR-PAY-03 | On successful payment verification, creator commission must be calculated automatically | Critical | `creatorCommissionMinor = amountMinor × (commissionRate / 100)`; `platformShareMinor = amountMinor - creatorCommissionMinor`; rate sourced from `SimpleLmsCommissionSetting` (global 70% default, with per-account or per-course overrides) |
| FR-PAY-04 | Learner must be auto-enrolled in the course upon successful payment | Critical | `SimpleLmsEnrollment` created with `status: 'active'`, `assignedBy: 'self'` |
| FR-PAY-05 | Payment verification must be idempotent — re-verifying the same transaction must not create duplicate enrollments or commissions | Critical | Check `SimpleLmsPayment.status` before processing; skip if already `successful` |
| FR-PAY-06 | Payment supports multiple methods: card, bank transfer, USSD | High | Configured in `flutterwaveService.js` via `payment_options: 'card,banktransfer,ussd'` |
| FR-PAY-07 | If an agent referral code (`?ref=AGENT_CODE`) is present on the course page, it must persist through the Flutterwave checkout redirect and be attributed on payment success | High | Referral code stored in session before redirect; agent attribution created after payment verification |

### 1.12 Withdrawal & Payout Management

> **Existing system — partially implemented.** The `SimpleLmsWithdrawal` model exists with a full lifecycle, but the admin UI for reviewing and processing withdrawals, and the documentation of the manual payout process, needs to be formalized.

#### 1.12.1 Creator Withdrawal Requests

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-WD-01 | Creators can request withdrawal of their earned commissions | Critical | Creator submits withdrawal request; `SimpleLmsWithdrawal` created with `status: 'pending'` |
| FR-WD-02 | Withdrawal request must capture the creator's payout profile at time of request | Critical | `payoutProfileSnapshot` frozen from `Account.payoutProfile` (bank name, account number, account name, bank code, SWIFT code, payment email, country, notes) |
| FR-WD-03 | Creator must have a configured payout profile before requesting withdrawal | High | Withdrawal form disabled / error shown if `Account.payoutProfile` is incomplete |
| FR-WD-04 | Withdrawal amount must not exceed the creator's available balance (total earned minus already withdrawn/pending) | Critical | Server-side validation; available balance = `SUM(SimpleLmsPayment.creatorCommissionMinor WHERE status='successful') - SUM(SimpleLmsWithdrawal.amountMinor WHERE status IN ['pending', 'approved', 'paid'])` |
| FR-WD-05 | Creator can add notes to their withdrawal request | Low | `SimpleLmsWithdrawal.notes` field (max 1200 chars) |
| FR-WD-06 | Creator can cancel a pending withdrawal request (only while `status: 'pending'`) | Medium | Cancel button on pending withdrawals; status updated to `cancelled` |
| FR-WD-07 | Creator can view their withdrawal history with status for each request | High | Withdrawal list shows: amount, date, status (pending/approved/paid/rejected/cancelled), admin notes |

#### 1.12.2 Admin Withdrawal Review & Approval

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-WD-08 | System admins (super_admin) can view all pending withdrawal requests | Critical | Admin dashboard shows withdrawal queue with: creator name, amount, currency, requested date, payout profile |
| FR-WD-09 | System admins can approve a pending withdrawal | Critical | Status changed to `approved`; `reviewedBy` set to admin's account ID; `reviewedAt` set to current time |
| FR-WD-10 | System admins can reject a pending withdrawal with notes explaining why | High | Status changed to `rejected`; `adminNotes` populated; creator notified |
| FR-WD-11 | After approving, system admin manually processes the payout via bank transfer (outside the system) then marks the withdrawal as paid | Critical | Admin clicks "Mark as Paid" → enters transaction reference → status changed to `paid`; `paidBy` set to admin; `paidAt` set; `transactionRef` stored |
| FR-WD-12 | Withdrawal review must show the frozen payout profile snapshot (not the creator's current profile, which may have changed) | High | Admin views `payoutProfileSnapshot` from the withdrawal record, not `Account.payoutProfile` |
| FR-WD-13 | Admin can add notes to any withdrawal at any stage | Medium | `adminNotes` field (max 3000 chars) editable by admin |

#### 1.12.3 Agent Commission Payout (New — Parallel to Creator Withdrawal)

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-WD-14 | Agent commission payouts follow the same centralized lifecycle: `pending → recommended → approved → paid` | High | `AgentSaleAttribution.status` transitions through system admin |
| FR-WD-15 | Partner Super Users can **recommend** agent commission payouts within their org (flags for system admin review) | High | Partner dashboard shows pending agent commissions; "Recommend for Payout" button changes status to `recommended` |
| FR-WD-16 | **System Admin** reviews recommended agent payouts, approves, transfers money manually (outside the system), then marks as paid | Critical | Same "Mark as Paid" workflow as creator withdrawals; `paidBy` set to admin |
| FR-WD-17 | System Admin can view and manage all agent commission payouts across all partner orgs in a single queue | Critical | Admin withdrawal queue includes: creator withdrawals, partner org withdrawals, AND agent commission payouts |

#### 1.12.4 Payout Profiles (All Earning Roles)

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-WD-18 | All earning roles (Creator, Agent, Partner) must configure `Account.payoutProfile` before receiving payouts | Critical | Payout button disabled if payout profile is incomplete; inline prompt to complete setup |
| FR-WD-19 | Agents configure their own bank details via Agent Dashboard → Settings | High | Agent can set: bank name, account number, account name, bank code, currency |
| FR-WD-20 | Partner organizations have an org-level payout profile (`Organization.partnerSettings.payoutProfile`) | High | Partner Super User configures org bank details; used for org-level course sales revenue |
| FR-WD-21 | Partner Super User can view agent's payout profile for reference; System Admin sees it when processing the payout | High | Agent bank details displayed in both partner review and admin payout views |

#### 1.12.5 Earnings Trace & Breakdown

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-WD-22 | Creator earnings must show sale-by-sale trace: course name, buyer, date, sale amount, commission rate, commission earned | High | Each `SimpleLmsPayment` displayed with calculated creator share |
| FR-WD-23 | Agent commissions must show sale-by-sale trace: course name, buyer, date, sale amount, platform share, agent rate, agent commission | High | Each `AgentSaleAttribution` displayed with full money flow |
| FR-WD-24 | Admin withdrawal review must show the contributing sales breakdown for the creator's balance | Critical | Admin can verify withdrawal amount against actual sales before approving |
| FR-WD-25 | Partner Super User commission review must show per-agent sale-by-sale attribution with amounts and percentages | High | Partner sees each sale that generated agent commission |
| FR-WD-26 | Admin financial dashboard must show complete per-sale money flow: total → creator (%) → platform (%) → agent (% of platform) → net platform revenue | Critical | Full trace with status of each party's payout (pending/paid) |

---

## 2. Non-Functional Requirements

### 2.1 Security

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| NFR-SEC-01 | CSRF protection on all state-changing endpoints | Critical | CSRF token in forms; API rejects requests without valid token |
| NFR-SEC-02 | Session cookies must use `secure: true` in production | Critical | Environment-based config: `secure: process.env.NODE_ENV === 'production'` |
| NFR-SEC-03 | Agent invite links must be single-use and time-limited (24h default) | High | Invite token invalidated after first use or expiry |
| NFR-SEC-04 | Role escalation must be impossible via API parameter tampering | Critical | Server-side role validation; `learningRole` never set from client input |
| NFR-SEC-05 | Partner org data isolation: users can only access data within their org | Critical | All queries scoped by `organization` field; no cross-org data leakage |
| NFR-SEC-06 | Audit log is append-only (no updates or deletes) | High | No update/delete operations on AuditLog collection |
| NFR-SEC-07 | Passwords hashed with bcrypt (12 rounds) — preserve existing | Critical | No change to existing `bcrypt.hash(password, 12)` |

### 2.2 Performance

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| NFR-PERF-01 | Dashboard pages must load in < 2 seconds | High | Measured on standard connection; lazy-load heavy analytics |
| NFR-PERF-02 | Agent roster list must support pagination (max 50 per page) | Medium | Cursor-based or offset pagination |
| NFR-PERF-03 | Commission calculation must not block payment processing | High | Async attribution after payment success webhook |
| NFR-PERF-04 | Database indexes on all new query patterns | High | Indexes defined in model schemas for `partnerType`, `partnerOrganization`, agent queries |
| NFR-PERF-05 | Sales report aggregation must use MongoDB aggregation pipeline (not in-memory) | Medium | `SimpleLmsPayment.aggregate()` for all report queries |

### 2.3 Scalability

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| NFR-SCALE-01 | System must support up to 100 partner organizations | Medium | No hardcoded limits; query performance validated at 100 orgs |
| NFR-SCALE-02 | System must support up to 500 agents per partner organization | Medium | Agent list pagination; no full-array scans |
| NFR-SCALE-03 | Commission reports must handle up to 10,000 transactions per month | Medium | Aggregation pipeline performance validated |

### 2.4 Reliability

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| NFR-REL-01 | Role changes must be atomic (no partial state) | Critical | `learningRole`, `isSuperAdmin`, `isSystemAdmin` updated in single `save()` or `updateOne()` |
| NFR-REL-02 | Agent commission attribution must not lose data on payment webhook failures | High | Idempotent webhook handler; retry logic for attribution |
| NFR-REL-03 | Last-super-user-demotion guard must be race-condition safe | High | Use `findOneAndUpdate` with count check in query filter |
| NFR-REL-04 | Flutterwave payment verification must be idempotent — duplicate webhooks or page reloads must not double-process | Critical | Check `SimpleLmsPayment.status !== 'initiated'` before processing; return early for already-verified payments |
| NFR-REL-05 | Withdrawal status transitions must be guarded against race conditions | High | Use `findOneAndUpdate` with `status: 'pending'` in query to prevent double-approval |

### 2.5 Usability

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| NFR-USE-01 | All new views must be mobile-first responsive | High | Tested on 375px viewport (iPhone SE) |
| NFR-USE-02 | Dual-branding (AIIN Nigeria / Seemplify) applied to all new views | High | `resolveBranding(req.hostname)` called in all new route handlers |
| NFR-USE-03 | Role transitions must show confirmation dialogs | Medium | Modal confirmation before promote/demote/remove actions |
| NFR-USE-04 | Error messages must be user-friendly (no stack traces) | High | All catch blocks return sanitized error messages |

### 2.6 Maintainability

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| NFR-MAINT-01 | All new models must follow existing code patterns (pre-save hooks, proper indexing, validation) | High | Code review checklist for each new model |
| NFR-MAINT-02 | Role enums must be defined in a single source of truth | High | Shared constant file for role lists; no inline hardcoded arrays |
| NFR-MAINT-03 | API error responses must follow consistent format `{ error: string, code: string }` | Medium | Standardized error response helper |

### 2.7 Compatibility

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| NFR-COMPAT-01 | Existing `learner`, `creator`, `admin`, `super_admin` roles must continue working without any change | Critical | No regression to existing users; zero-migration for current accounts |
| NFR-COMPAT-02 | Existing Organization model methods (`addMember`, `removeMember`, `updateMemberRole`, `transferOwnership`) must work for partner orgs | Critical | All existing tests pass; no breaking changes to Organization API |
| NFR-COMPAT-03 | Existing Commission system (`SimpleLmsCommissionSetting`) must remain creator-focused | High | Agent commission is a new parallel system; no changes to creator commission flow |

### 2.8 Internationalization (Future)

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| NFR-I18N-01 | All user-facing strings must be extractable for future i18n | Low | No hardcoded strings in views; template variables used |
| NFR-I18N-02 | Currency formatting must support NGN, USD, GBP, EUR | Low | Existing `simpleLmsCurrencyService.js` already supports this |

### 2.9 Offline Capability (Future)

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| NFR-OFF-01 | PWA manifest and service worker for offline access | Low | Basic PWA shell; course content cached for offline viewing |
| NFR-OFF-02 | Offline sales data sync on reconnection | Low | IndexedDB queue for offline captures; sync on connectivity |
