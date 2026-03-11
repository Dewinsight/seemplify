# PRD-user-roles.md — Implementation Gap Analysis (Revised)

**Date:** 2026-03-11  
**Method:** Deep code audit tracing actual UI flows, templates, routes, models, and middleware

> [!IMPORTANT]
> **Correction:** The previous analysis was too generous in some areas and missed others. This revision traces every user journey end-to-end through the actual UI code. **The system is substantially more complete than initially apparent.** Most of the PRD's Section 6.2 ("Not Yet Implemented") has been built.

---

## How Someone Becomes a Partner (End-to-End Flow)

The user asked: *"I don't see how someone becomes a partner."* Here is the complete flow that exists:

### 1. Registration (`register.ejs`)
- Registration form shows **4 intent options**: Learn, Teach, **Partner**, and **Channel Partner**
- Selecting Partner/Channel Partner shows an **Organization Name** field and a note: *"Partner applications are reviewed by a platform admin before role activation."*
- Submit button dynamically changes to **"Apply as Partner"** or **"Apply as Channel Partner"**
- Agent invites also work: if a user arrives via invite link, they see the org name and are locked to agent role

### 2. Backend Processing (`auth.js`)
- `createPartnerApprovalRequest()` creates a `RoleApprovalRequest` with `requestType: 'partner_role_activation'`
- `createPartnerOrganizationForRequest()` auto-creates an `Organization` with `partnerType`, `partnerSettings`, and the user as `partner_admin` member
- Partner org starts with `partnerStatus: 'pending'`
- Audit log entry created for the request

### 3. Admin Approval (`admin-dashboard.ejs` → Partners section)
- Admin sees **"Partner Role Requests"** with dropdown to assign: `partner_user`, `partner_super`, `channel_partner_user`, or `channel_partner_super`
- Admin can approve/reject each request
- On approval: user's `learningRole` is set, org status changed to `active`
- Admin can also change partner org status (pending/active/suspended)

### 4. Post-Approval
- User is redirected to `/partner-dashboard` on login (via `getPostLoginRedirect()` in `learningRoles.js`)
- Agents are redirected to `/agent-dashboard`

---

## What Actually Exists in the UI

### Registration Form (`register.ejs` — 277 lines) ✅
- 4 intent options: Learn, Teach, Partner, Channel Partner
- Org name input for partner intents
- Agent invite flow with locked email and org display
- Dynamic submit buttons per intent

### Partner Dashboard (`partner-dashboard.ejs` — 803 lines) ✅
7 sections, all fully built:

| Section | Features |
|---------|----------|
| **Overview** | Agent count, total sales, commissions due, course counts, top agents table |
| **Agents** | Invite/add by email, agent list with name/email/join date/payout profile/commission rate override, remove agents |
| **Courses** | Partner courses table, approve/reject draft courses (partner super users only) |
| **Reports** | Daily sales with date range filters, agent/course filters, churn metrics (active agents, removed agents, attrition %, time to first sale, at-risk enrollments, learner drop-off %), **CSV export for sales and commissions** |
| **Commissions** | Per-agent per-sale breakdown (agent, course, sale amount, rate, commission, status, date), **Recommend for Payout** button |
| **Withdrawals** | Partner wallet (total sales, agent commissions, partner earnings, pending, paid out, available balance), withdrawal request form, withdrawal history with cancel |
| **Settings** | Max agents, default agent commission %, partner status, invite approval toggle, full org payout profile (bank name, account, SWIFT, email, currency, country) |

### Agent Dashboard (`agent-dashboard.ejs`) ✅
- Own sales, own commissions, payout profile management
- Referral code/link generation

### Admin Dashboard — Partners Section (`admin-dashboard.ejs` lines 1356-1560) ✅
- **Partner Organizations** table: name, type (channel_partner/partner), status, agent count, partner wallet (revenue, pending W/D, available), status change form
- **Partner Withdrawal Queue**: org name, type, amount, status, approve/reject/mark-paid forms
- **Partner Role Requests**: requester info, intent, requested role, approve with role dropdown (all 4 partner roles), reject, notes

### Admin Dashboard — Super Users Section ✅
- Lists system-level super users (correct per PRD — `super_admin` is the platform-level role)
- Create/promote/demote/delete super user controls
- Re-authentication required for sensitive actions

### Middleware (`middleware/roles.js`) ✅
- `requireRole(allowedRoles)` — validates user's learning role
- `requirePartnerAccess(allowedOrgRoles, options)` — validates user belongs to target partner org with correct org-level role

### Models ✅
All new models exist:
- `AgentSaleAttribution.js` (111 lines) — full commission tracking with `pending → recommended → approved → paid` lifecycle
- `AgentInvite.js` — time-limited invite tokens
- `AuditLog.js` (89 lines) — append-only, 24 action types, IP tracking

---

## Genuine Remaining Gaps

### 🔴 Security (Must Fix)

| Gap | Details |
|-----|---------|
| **No CSRF protection** | No `csurf` or equivalent middleware. All POST forms are unprotected. |
| **Secure cookie flag missing** | Cookie has `httpOnly: true` and `sameSite: 'lax'` but NOT `secure: true` for production. |
| **No self-referral prevention** | Agents can potentially earn commission on their own purchases. Need `agentId !== buyerAccountId` check in `resolveAgentReferralForCheckout()`. |

### 🟡 Functional Gaps (Medium Priority)

| Gap | Details |
|-----|---------|
| **No role upgrade for existing users** | An already-registered learner or creator has **no way** to apply for a partner/channel partner role. The partner application flow only exists in the registration form (`register.ejs`). There is no "Apply to become a Partner" option in the user's dashboard or settings. The admin can promote to `super_admin` via the Super Users panel, but **cannot assign partner roles to existing accounts.** This means the only path to becoming a partner is to register a new account with the partner intent. |
| **Course Studio org scoping** | Course Studio (`course-studio.ejs`) does not enforce organization-level ownership. Partner users can create courses but they may not be auto-scoped to their org. |
| **Standalone reports API** | No `GET /api/reports/sales` or `GET /api/reports/commissions` endpoints. Report data is embedded in dashboard renders, not available as standalone APIs. |
| **Role-based nav menu filtering** | Main nav bar doesn't hide/show items based on role. All logged-in users see the same navigation links. |
| **Creator earnings trace UI** | Admin can review withdrawals, but the per-sale breakdown trace (REQ-027r) showing exactly which sales contributed to the balance may not be visible in the admin withdrawal review. |

### 🟢 Low Priority / Deferred

| Gap | Details |
|-----|---------|
| **i18n / Multi-language** (REQ-045-047) | Deferred to Phase 6 per PRD |
| **PWA / Offline** (REQ-048-050) | Deferred to Phase 6 per PRD |

---

## Why It May Appear Incomplete

The user reported: *"I don't see how someone becomes a partner."* Possible reasons:

1. **No test data**: If no one has registered with `partner` or `channel_partner` intent, the Partners section in admin will show "No partner organizations found" and "No partner role requests found."
2. **Approval required**: Partner registrations are NOT auto-activated. They sit in the role request approval queue until the super admin approves. If the queue is empty, nothing appears.
3. **Separate dashboards**: Partners see `/partner-dashboard`, agents see `/agent-dashboard`. These are separate from the main `/simple-lms` and `/admin` dashboards.
4. **Super Users ≠ Partner Super Users**: The admin "Super Users" panel manages platform-level `super_admin` accounts (correct per PRD). Channel Partner Super Users and Partner Super Users are partner organization roles, managed within the Partners section.

---

## Files Involved (New Since PRD)

| File | Purpose |
|------|---------|
| `src/utils/learningRoles.js` (174 lines) | All 9 roles, intent maps, post-login redirect |
| `src/middleware/roles.js` (96 lines) | `requireRole()`, `requirePartnerAccess()` |
| `src/routes/superUser.js` (538 lines) | Super user CRUD with re-auth and audit logging |
| `src/routes/partnerApi.js` (375 lines) | Agent roster CRUD, partner org API |
| `src/routes/partner.js` (~560 lines) | Partner dashboard routes (all 7 sections) |
| `src/routes/agent.js` (218 lines) | Agent dashboard, referral links, payout settings |
| `src/models/AgentSaleAttribution.js` (111 lines) | Commission tracking model |
| `src/models/AgentInvite.js` (~50 lines) | Time-limited agent invite tokens |
| `src/models/AuditLog.js` (89 lines) | Append-only audit log |
| `src/utils/agentReferral.js` (~30 lines) | Referral code builder/normalizer |
| `src/views/register.ejs` (277 lines) | Registration with all 4 intents |
| `src/views/partner-dashboard.ejs` (803 lines) | Full partner dashboard UI |
| `src/views/agent-dashboard.ejs` | Agent dashboard UI |
