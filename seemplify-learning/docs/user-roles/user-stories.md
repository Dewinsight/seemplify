# User Stories
# AI in Nigeria Learning Platform — User Roles & Access Control

**Version:** 1.0  
**Date:** March 10, 2026  
**Companion to:** [PRD-user-roles.md](./PRD-user-roles.md)

---

## Epic 1: Core Role Infrastructure

### US-1.1 — Extend Role Enum
**As a** platform developer  
**I want to** extend the `learningRole` enum in the Account model  
**So that** the system can distinguish between all 9 user types

**Acceptance Criteria:**
- `Account.learningRole` enum includes: `super_admin`, `admin`, `creator`, `learner`, `channel_partner_super`, `channel_partner_user`, `channel_sales_agent`, `partner_super`, `partner_user`
- `getLearningRole()` method recognizes all 9 values
- `resolveLearningRole()` in `index.js` recognizes all 9 values
- Existing users with `learner`, `creator`, `admin`, `super_admin` roles unaffected

**Technical Notes:**
- Files: `src/models/Account.js` (lines 68-71, 284-293), `src/index.js` (lines 79-88)

---

### US-1.2 — Role-Based Access Middleware
**As a** platform developer  
**I want to** create reusable middleware for role-based route protection  
**So that** routes are consistently protected without duplicating role checks

**Acceptance Criteria:**
- `requireRole(['super_admin', 'admin'])` middleware returns 403 for unauthorized roles
- `requirePartnerAccess(['partner_admin', 'partner_user'])` validates org membership + role
- Middleware attaches the resolved role to `req.learningRole` for downstream use
- Works with existing `requireAuth` middleware in the chain

**Technical Notes:**
- New file: `src/middleware/roles.js`
- Must call `getLearningRole()` or `resolveLearningRole()` for consistency

---

### US-1.3 — Registration Intent Extension
**As a** new user registering as a partner  
**I want to** select my intent (learn, teach, partner, channel partner)  
**So that** the system can route me to the appropriate onboarding flow

**Acceptance Criteria:**
- Registration form shows intent options: Learn, Teach, Partner, Channel Partner
- `learningProfile.registrationIntent` stores the selected intent
- `partner` and `channel_partner` intents create the account with `learningRole: 'learner'` and a pending approval request
- `learn` and `teach` intents continue working as before

**Technical Notes:**
- Files: `src/routes/auth.js` (line 10: `LEARNING_INTENTS`, line 207: `roleFromIntent`)
- Files: `src/models/Account.js` (lines 74-78: `registrationIntent` enum)
- Registration form: `src/views/register.ejs`

---

## Epic 2: Super User Management

### US-2.1 — List Super Users
**As a** super admin  
**I want to** view a list of all super users  
**So that** I know who has full system access

**Acceptance Criteria:**
- Super user management section in admin dashboard
- Table shows: name, email, promoted date, promoted by
- Only visible to users with `isSuperAdmin: true`

---

### US-2.2 — Promote User to Super Admin
**As a** super admin  
**I want to** promote an existing user to super admin  
**So that** I can delegate full platform control

**Acceptance Criteria:**
- Search/select user by email or name
- Confirmation dialog with password re-entry
- Sets `learningRole: 'super_admin'`, `isSuperAdmin: true`, `isSystemAdmin: true`
- Audit log entry created with action `super_user.promote`
- Success notification shown

---

### US-2.3 — Demote Super Admin
**As a** super admin  
**I want to** demote another super admin  
**So that** I can revoke full platform access when needed

**Acceptance Criteria:**
- Demote button on each super user row (except self)
- Confirmation dialog with password re-entry
- Cannot demote the last remaining super admin (error shown)
- Restores previous role (defaults to `learner` if unknown)
- Audit log entry created with action `super_user.demote`

---

## Epic 3: Partner Organization System

### US-3.1 — Create Partner Organization
**As a** super admin  
**I want to** create a new partner organization  
**So that** partners can onboard and start operating on the platform

**Acceptance Criteria:**
- Form collects: org name, description, partner type (channel_partner / partner), initial super user email
- Organization created with `partnerType` set
- Initial user promoted to `channel_partner_super` or `partner_super`
- Partner settings initialized with defaults (`maxAgents: null`, `defaultAgentCommissionRate: 10`)

**Technical Notes:**
- Extends existing `Organization` model with `partnerType` field
- Reuses `Organization.addMember()` method

---

### US-3.2 — Partner Organization Dashboard
**As a** Channel Partner Super User  
**I want to** see my partner organization's dashboard  
**So that** I can manage my team and track performance

**Acceptance Criteria:**
- Dashboard shows: agent count, total sales, total commissions due, courses count
- Quick-action cards: Invite Agent, Create Course, View Reports
- Agent performance summary (top 5 agents by sales)
- Recent activity feed

---

### US-3.3 — Partner Settings Management
**As a** Channel Partner Super User  
**I want to** configure my organization's settings  
**So that** I can control agent limits and commission rates

**Acceptance Criteria:**
- Settings page with: max agents, default commission rate, invite approval toggle
- Only accessible by partner super users
- Changes saved immediately with success confirmation

---

## Epic 4: Agent Management

### US-4.1 — Invite Agent
**As a** Channel Partner Super User  
**I want to** invite a new sales agent to my organization  
**So that** they can start selling courses on behalf of my organization

**Acceptance Criteria:**
- Invite form collects agent email
- System sends invite email with time-limited registration link (24h expiry)
- Agent registers via link → auto-joined to partner org with `channel_sales_agent` role
- Invite link is single-use
- Agent count checked against `partnerSettings.maxAgents`

---

### US-4.2 — Agent Can Also Be Invited by Channel Partner User
**As a** Channel Partner User  
**I want to** invite a new agent  
**So that** I can help grow our sales team

**Acceptance Criteria:**
- Channel Partner Users see the invite form (same as US-4.1)
- Channel Partner Users CANNOT remove agents (remove button hidden)
- Invites by Channel Partner Users may require super user approval if `partnerSettings.agentInviteApproval` is true

---

### US-4.3 — Remove Agent
**As a** Channel Partner Super User  
**I want to** remove an agent from my organization  
**So that** I can manage my team composition

**Acceptance Criteria:**
- Remove button on agent roster (super users only)
- Confirmation dialog before removal
- Agent's `learningRole` reverted to `learner`
- Agent's `partnerOrganization` set to null
- Agent removed from org's member list
- Agent's pending commissions remain payable (not forfeited)

---

### US-4.4 — View Agent Roster
**As a** Channel Partner Super User  
**I want to** view all agents in my organization  
**So that** I can assess my team at a glance

**Acceptance Criteria:**
- Paginated agent list (50 per page)
- Columns: name, email, joined date, status, total sales, total commission, last active
- Search/filter by name or email
- Sort by: name, sales count, commission earned, join date

---

## Epic 5: Partner Course Creation

### US-5.1 — Partner Super User Creates Course
**As a** Channel Partner Super User  
**I want to** create a course for my organization  
**So that** my agents can sell it to learners

**Acceptance Criteria:**
- Course Studio accessible from partner dashboard
- Course created with `organization = partnerOrgId`
- Partner super user can set pricing, visibility, chapters/lessons
- Course can be published directly by partner super user (no platform admin approval needed)
- Published courses appear in the org's course catalog for agents

**Technical Notes:**
- Reuses existing Course Studio (`views/course-studio.ejs`) with org context
- `SimpleLmsCourse.organization` already supports org linking

---

### US-5.2 — Partner User Creates Draft Course
**As a** Channel Partner User  
**I want to** create a draft course for my organization  
**So that** I can contribute content that the super user can review

**Acceptance Criteria:**
- Course Studio accessible with limited permissions
- Course created with `organization = partnerOrgId`, `status: 'draft'`
- Publish button disabled/hidden — shows "Submit for Review" instead
- Notification sent to partner super user when draft submitted

---

### US-5.3 — Partner Super User Approves Draft Course
**As a** Channel Partner Super User  
**I want to** review and approve a draft course  
**So that** quality content reaches our agents and learners

**Acceptance Criteria:**
- Draft course queue in partner dashboard  
- Review actions: Approve (publishes), Reject (with notes), Request Changes
- Notification sent to author on approval/rejection
- Approved course appears in org catalog immediately

---

### US-5.4 — Agent Views Course Catalog
**As a** Channel Sales Agent  
**I want to** view my organization's available courses  
**So that** I know what I can sell and generate referral links

**Acceptance Criteria:**
- Agent dashboard shows org's published courses
- Each course card shows: title, price, description, referral link button
- No edit/delete/create actions visible
- "Copy Referral Link" button generates unique agent-attributed URL

---

## Epic 6: Agent Sales & Commission

### US-6.1 — Agent Generates Referral Link
**As a** Channel Sales Agent  
**I want to** generate a unique referral link for a course  
**So that** sales through my link are attributed to me

**Acceptance Criteria:**
- "Get Referral Link" button on each course in agent catalog
- Link format: `https://domain.com/courses/:id/:slug?ref=AGENT_CODE`
- `AGENT_CODE` is unique per agent (derived from account sub or generated)
- Link copied to clipboard on click

---

### US-6.2 — Sale Attributed to Agent
**As a** platform system  
**I want to** attribute a sale to the referring agent  
**So that** the agent earns their commission

**Acceptance Criteria:**
- When a learner makes a purchase via referral link, `ref` param captured in session
- On successful payment, `AgentSaleAttribution` record created
- Attribution includes: payment ID, agent ID, partner org ID, commission rate, commission amount
- Creator commission unaffected (agent commission carved from platform share)

---

### US-6.3 — Agent Views Own Commissions
**As a** Channel Sales Agent  
**I want to** see my earned commissions  
**So that** I can track my earnings and expected payouts

**Acceptance Criteria:**
- Agent dashboard shows: total earned, pending payout, paid out
- Transactions list with: course name, sale date, amount, commission rate, commission earned, status
- Filterable by date range

---

### US-6.4 — Partner Super User Views Commission Reports
**As a** Channel Partner Super User  
**I want to** see commission reports for all my agents  
**So that** I can manage payouts and track team performance

**Acceptance Criteria:**
- Commission report shows per-agent breakdown
- Summary: total commissions due, total paid, total pending
- Export to CSV
- Filterable by agent, date range, payment status

---

## Epic 7: Platform Admin Views

### US-7.1 — Admin Daily Sales Dashboard
**As a** super admin  
**I want to** see daily sales metrics  
**So that** I can monitor platform health

**Acceptance Criteria:**
- Dashboard card: today's sales count and revenue
- Trend: sales over last 30 days (chart or sparkline)
- Breakdown: by course, by creator, by partner org
- Filterable by date range

---

### US-7.2 — Admin Financial Reports
**As a** super admin  
**I want to** see complete financial reports  
**So that** I can manage platform revenue and payouts

**Acceptance Criteria:**
- Revenue breakdown: total sales, creator commissions, platform share, agent commissions
- Pending payouts: creator withdrawals + agent commissions awaiting payment
- **Withdrawal queue**: list of pending/approved withdrawal requests with actions
- Period comparison (this month vs. last month)
- Export to CSV

---

### US-7.3 — Admin Partner Overview
**As a** super admin  
**I want to** see all partner organizations and their status  
**So that** I can manage the partner ecosystem

**Acceptance Criteria:**
- Partner list with: org name, type, status, agent count, total sales
- Quick actions: activate, suspend, view details
- Drill-down to individual partner org dashboard

---

## Epic 8: Security & Audit

### US-8.1 — Audit Log Trail
**As a** super admin  
**I want to** view an audit log of all sensitive actions  
**So that** I can investigate security events

**Acceptance Criteria:**
- Audit log page in admin dashboard
- Shows: timestamp, action, performed by, target, IP address
- Logged actions: super user management, partner org creation/suspension, agent add/remove, role changes
- Filterable by action type, performer, date range
- Append-only (no edit/delete)

---

### US-8.2 — Password Reset Flow
**As a** user who forgot my password  
**I want to** reset my password via email  
**So that** I can regain access to my account

**Acceptance Criteria:**
- "Forgot Password?" link on login page
- Form collects email → sends reset link
- Reset link expires after 1 hour
- New password must meet minimum requirements (8 chars, as per existing)
- Redirect to login with success message after reset

**Technical Notes:**
- Uses existing `emailService.js`
- New model field or temporary token in `Account` or separate token collection

---

## Epic 9: Payment Collection & Withdrawal Management

### US-9.1 — Creator Views Earnings Summary
**As a** course creator  
**I want to** see my total earnings, available balance, and pending withdrawals  
**So that** I know how much I can withdraw

**Acceptance Criteria:**
- Earnings dashboard shows: total earned (all time), total withdrawn, total pending withdrawal, available balance
- Available balance = total earned - (pending + approved + paid withdrawals)
- Transaction list shows individual sales with: course name, buyer, amount, commission rate, commission earned, date
- All amounts in minor units formatted via `formatCurrencyAmount()` with correct currency symbol

**Technical Notes:**
- Data source: `SimpleLmsPayment` where `creatorAccount = self` and `status = 'successful'`
- `SimpleLmsWithdrawal` where `creatorAccount = self` for withdrawal totals

---

### US-9.2 — Creator Requests Withdrawal
**As a** course creator  
**I want to** request a withdrawal of my earnings  
**So that** I can receive my money

**Acceptance Criteria:**
- Withdrawal form shows: available balance, amount input, optional notes
- Creator must have a complete payout profile (bank name, account number, account name) before submitting
- If payout profile is incomplete, show prompt to configure it in settings
- Amount cannot exceed available balance (validated server-side)
- On submit: `SimpleLmsWithdrawal` created with `status: 'pending'`, `payoutProfileSnapshot` frozen from current profile
- Success message: "Withdrawal request submitted. You'll be notified when it's reviewed."
- Creator can cancel a pending request (status reverts to `cancelled`)

**Technical Notes:**
- `Account.payoutProfile` fields: `accountName`, `accountNumber`, `bankName`, `bankCode`, `swiftCode`, `paymentEmail`, `country`, `notes`
- Snapshot is frozen at request time — if creator later changes bank details, the withdrawal still shows the original profile

---

### US-9.3 — Admin Reviews Withdrawal Requests
**As a** system admin (super_admin)  
**I want to** view and review all pending withdrawal requests  
**So that** I can approve or reject payouts

**Acceptance Criteria:**
- Admin dashboard shows a "Pending Withdrawals" section/tab
- List shows: creator name, creator email, amount, currency, requested date, payout profile snapshot
- Admin can view the frozen payout profile (bank name, account number, account name — from the **snapshot**, not the creator's current profile)
- Approve action: sets `status: 'approved'`, `reviewedBy: adminId`, `reviewedAt: now`
- Reject action: modal with required notes field; sets `status: 'rejected'`, `adminNotes` populated
- Creator notified on approve/reject

---

### US-9.4 — Admin Marks Withdrawal as Paid (Manual Payout)
**As a** system admin  
**I want to** manually transfer money to the creator's bank account and then mark the withdrawal as paid in the system  
**So that** the creator's records are accurate and the payout is tracked

**Acceptance Criteria:**
- After approving a withdrawal, admin sees it in an "Approved — Awaiting Payout" queue
- Admin performs the actual bank transfer **outside the system** (via their bank's portal, Flutterwave dashboard, or manual transfer)
- Admin returns to the system and clicks "Mark as Paid"
- "Mark as Paid" modal collects: transaction reference (optional but recommended), admin notes (optional)
- On confirm: `status: 'paid'`, `paidBy: adminId`, `paidAt: now`, `transactionRef` stored
- Creator notified that payout has been completed
- The withdrawal is now finalized — no further status changes allowed

**Technical Notes:**
- `SimpleLmsWithdrawal` status lifecycle: `pending → approved → paid` (happy path) or `pending → rejected` or `pending → cancelled` (by creator)
- The system does NOT initiate bank transfers automatically — all payouts are manual
- `transactionRef` is for the admin's own tracking (e.g., bank transfer reference number)

---

### US-9.5 — Agent Commission Payout Flow
**As a** Partner Super User  
**I want to** review my agents' earned commissions and recommend them for payout  
**So that** the system admin can process the payments

**Acceptance Criteria:**
- Partner dashboard shows "Agent Commissions" section
- List shows: agent name, total pending commission, number of attributed sales, date range
- Partner Super User can click **"Recommend for Payout"** (batch or individual)
- Status changes from `pending` → `recommended` (flagged for system admin review)
- Partner Super User can view agent payout profiles (bank details) for reference
- Partner Super User **cannot** approve or mark as paid — that is system admin's job
- System Admin sees recommended agent payouts in the unified withdrawal queue
- System Admin approves → manually transfers money → marks as paid (same workflow as creator withdrawals)
- `AgentSaleAttribution.status`: `pending → recommended → approved → paid`

**Technical Notes:**
- Unlike creator withdrawals, agent commissions don't have a separate "withdrawal request" — they accumulate automatically per sale
- Payout can be batched: recommend all pending commissions for an agent at once
- System admin's withdrawal queue shows three types: creator withdrawals, partner org withdrawals, agent commissions

---

### US-9.6 — Agent Configures Payout Profile
**As a** channel sales agent  
**I want to** set up my bank details so my partner organization knows where to send my commissions  
**So that** I can receive my earned money

**Acceptance Criteria:**
- Agent Dashboard → Settings shows a "Payout Profile" section
- Fields: bank name, account number, account name, bank code, currency (default NGN)
- Validation: all required fields must be filled before commissions can be paid out
- Agent sees a warning banner if payout profile is incomplete
- Uses existing `Account.payoutProfile` structure — no new model needed

---

### US-9.7 — Agent Views Earnings with Sale-by-Sale Trace
**As a** channel sales agent  
**I want to** see exactly which course sales generated my commissions, with amounts and percentages  
**So that** I can verify my earnings are accurate

**Acceptance Criteria:**
- Agent earnings view shows summary cards: total earned, paid out, pending payout
- Sale-by-sale trace table showing: course name, buyer, sale date, sale amount, platform share, agent commission rate (%), agent commission earned
- Each row traces: `Sale: ₦5,000 → Creator: ₦3,500 (70%) → Platform: ₦1,500 (30%) → My Commission: ₦1,500 × 10% = ₦150`
- Running totals at the bottom: total earned, total pending, total paid

**Technical Notes:**
- Data source: `AgentSaleAttribution` joined with `SimpleLmsPayment` and `SimpleLmsCourse`
- Agent should NOT see other agents' data

---

### US-9.8 — Partner Organization Requests Withdrawal
**As a** Partner Super User  
**I want to** request a withdrawal of my organization's earnings from course sales  
**So that** the organization can receive its revenue

**Acceptance Criteria:**
- Partner dashboard shows org-level earnings: total course sales, org commission earned, withdrawn, available balance
- Partner Super User can request withdrawal (same lifecycle as creator: `pending → approved → paid`)
- Org payout profile (bank details) configured in `Organization.partnerSettings.payoutProfile`
- `payoutProfileSnapshot` frozen from org profile at request time
- System Admin reviews and processes the payout manually (same as creator withdrawals)

**Technical Notes:**
- New: `SimpleLmsWithdrawal` needs to support org-level withdrawals (`organization` field alongside `creatorAccount`)
- Org earnings source: `SimpleLmsPayment` where `course.organization = partnerOrgId`

---

### US-9.9 — Admin Sees Earnings Trace in Withdrawal Review
**As a** system admin  
**I want to** see the detailed sale-by-sale breakdown that generated a creator's earnings when reviewing their withdrawal request  
**So that** I can verify the withdrawal amount is legitimate before approving

**Acceptance Criteria:**
- Withdrawal review detail view shows:
  - Creator's total earnings from all sales (with individual sale list)
  - Each sale: course name, buyer, date, amount, commission rate (%), creator's share, platform's share
  - Subtraction: total earned − already withdrawn − currently pending = available balance
  - Requested withdrawal amount vs. available balance (highlighted if close to balance)
- Admin can expand each sale to see full money flow (including agent commission if applicable)
- Example: `Sale: ₦10,000 → Creator: ₦7,000 (70%) → Platform: ₦3,000 (30%) → Agent: ₦300 (10%) → Net: ₦2,700`

**Technical Notes:**
- Joins `SimpleLmsPayment` (where `creatorAccount = withdrawalCreator`), `SimpleLmsCourse`, `AgentSaleAttribution` (if exists)
- Performance: paginate sales list; show summary first, expand for details
