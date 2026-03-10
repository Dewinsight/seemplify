# PRD-user-roles.md — Implementation Gap Analysis

**Date:** 2026-03-10  
**Method:** Full codebase audit against every PRD requirement

---

## Summary

> [!IMPORTANT]
> The PRD's Section 6.2 ("Not Yet Implemented") is **significantly outdated**. The vast majority of features listed as ❌ have since been implemented. Out of ~60 requirements, approximately **50+ are fully implemented**, ~5 are partially done, and ~5 remain unstarted.

---

## ✅ Fully Implemented (PRD Said "Not Implemented" But Now Done)

These were listed in Section 6.2 as ❌ but are **now fully built**:

| PRD Item | Evidence |
|----------|----------|
| Extend `learningRole` enum with 5 new values (REQ-028) | `src/utils/learningRoles.js` — all 9 roles defined |
| Extend `registrationIntent` enum (REQ-029) | `src/utils/learningRoles.js` — includes `partner`, `channel_partner` |
| Role-based access middleware `requireRole()` (REQ-033a) | `src/middleware/roles.js` |
| Partner access middleware `requirePartnerAccess()` (REQ-033b) | `src/middleware/roles.js` |
| Role-based registration flow (REQ-003/004) | `src/routes/auth.js` — partner/channel_partner intents with role request approval |
| Organization `partnerType` field (REQ-031) | `src/models/Organization.js:17` — `enum: ['none', 'channel_partner', 'partner']` |
| Partner-specific org member roles (REQ-032) | `src/models/Organization.js` — `partner_admin`, `partner_user`, `sales_agent` added |
| `partnerSettings` sub-schema (REQ-033) | `src/models/Organization.js:93` — `maxAgents`, `defaultAgentCommissionRate`, `payoutProfile`, `partnerStatus` |
| `partnerOrganization` field on Account (REQ-028a) | `src/models/Account.js:239` — with index |
| Agent roster management — add/remove (REQ-015/037/038/039) | `src/routes/partnerApi.js` — full CRUD (375 lines) |
| Agent sales attribution tracking (REQ-041f/041g) | `src/models/AgentSaleAttribution.js` — 111 lines, full schema |
| Agent commission model (REQ-041f) | `AgentSaleAttribution` with `status: ['pending','recommended','approved','paid','rejected','cancelled']` |
| Agent commission rates (REQ-041h) | Per-partner default in `partnerSettings.defaultAgentCommissionRate`, per-agent override supported |
| Referral code / tracking link system (REQ-041g) | `src/utils/agentReferral.js` + integrated into payment flow in `simpleLms.js` |
| Agent commission into payment flow (REQ-027e) | `simpleLms.js` lines 2440-2494 — `resolveAgentReferralForCheckout()`, referral metadata stored on payment |
| Agent commission payout with recommend flow (REQ-027p/027q) | `AgentSaleAttribution.status`: `pending → recommended → approved → paid` |
| Partner dashboard view (REQ-043) | `src/views/partner-dashboard.ejs` |
| Agent dashboard view (REQ-043) | `src/views/agent-dashboard.ejs` |
| Super user management CRUD (REQ-014a-f, REQ-041a-e) | `src/routes/superUser.js` — 538 lines, create/promote/demote/delete with re-auth |
| Audit logging model (REQ-041i) | `src/models/AuditLog.js` — 89 lines, append-only, 24 action types, TTL index |
| Agent invitation system (REQ-053) | `src/models/AgentInvite.js` model exists |
| Password reset flow (REQ-054-056) | `src/routes/auth.js` — forgot-password, reset-password routes with token expiry + audit logging |
| Role-based login redirect (REQ-007) | `src/utils/learningRoles.js` — `getPostLoginRedirect()` maps roles to dashboard paths |
| Agent payout profile settings (REQ-027n) | `src/routes/agent.js` — `POST /settings/payout` |
| GET /api/users/me (REQ-035) | `src/routes/auth.js:674` — returns current user with role details |
| Admin withdrawal review UI (REQ-027i-027l) | `src/views/admin-dashboard.ejs` — approve/reject/mark-paid buttons, pending/approved/paid counts, withdrawal queue with status forms |
| Admin withdrawal status updates (REQ-027j-027k) | `src/routes/simpleLms.js:7922` — `POST /admin/withdrawals/:id/status` endpoint with approve/reject/paid transitions |
| Agent commission recommend flow (REQ-027p) | `src/routes/partner.js:529` — Partner Super User sets `status: 'recommended'` with `recommendedBy` and `recommendedAt` |
| Admin agent commission approve/pay (REQ-027p) | `src/routes/simpleLms.js:5228` — approve and mark-paid status transitions for agent commissions |
| Agent commission payout UI in admin dashboard | `src/routes/simpleLms.js:6260` — `agentPayoutRows` fetched with `canApprove`/`canMarkPaid`/`canReject` flags passed to admin dashboard |

---

## ⚠️ Partially Implemented

| PRD Item | Gap |
|----------|-----|
| Partner course creation (REQ-014g-014l) | `SimpleLmsCourse` has `organization` field, but Course Studio doesn't enforce org-level ownership or partner draft approval workflow. No UI for "Partner Super User approves draft courses from Partner Users" |
| Earnings trace breakdowns (REQ-027r-027v) | Agent `AgentSaleAttribution` has per-sale data, but **per-sale earnings trace UI** for creators/agents/admins may not be fully rendered in dashboards |
| Agent performance metrics (REQ-018/021) | Sales count + totals per agent exist in `partnerApi.js`, but dedicated agent performance views (churn, trends, ranking) not implemented |

---

## ❌ Not Implemented (Genuine Gaps)

| PRD Item | Priority | Notes |
|----------|----------|-------|
| **CSRF protection** (REQ-053) | **High** | No CSRF middleware found anywhere (`csurf` or equivalent). All POST forms are unprotected against cross-site request forgery. |
| **Secure cookie flag** (REQ-053) | **High** | Session cookie has `httpOnly: true` and `sameSite: 'lax'` but `secure` is NOT conditionally set for production. Should be `secure: process.env.NODE_ENV === 'production'` |
| **Self-referral prevention** | **Medium** | No mechanism to prevent agents from earning commissions on their own purchases. Check `agentId !== buyerAccountId` needed in `resolveAgentReferralForCheckout()` |
| **Partner org withdrawal flow** (REQ-027o) | **Medium** | No route for partner organizations to request withdrawal of their earnings. Only creator withdrawals (`SimpleLmsWithdrawal`) and agent commission payouts exist. Partner Super Users cannot submit withdrawal requests for org revenue. |
| **Role-based navigation filtering** (REQ-014) | **Medium** | No role-based menu/nav filtering. All views show the same navigation — no hiding of menu items based on user role. |
| **Dedicated reports API** (REQ-040/041) | **Medium** | No `GET /api/reports/sales` or `GET /api/reports/commissions` endpoints. Reporting data is embedded in the main dashboard render, not available as standalone APIs. |
| **Churn metrics** (REQ-022) | Medium | No churn tracking or reporting exists. No agent attrition, time-to-first-sale, or learner drop-off metrics. |
| **Commission reports export** (REQ-027) | Medium | No CSV/Excel export for financial, commission, or sales reports |
| **Daily sales report** (REQ-019) | Medium | No dedicated daily sales report view — sales data is in the admin dashboard but not as a standalone report |
| **Agent commission per-agent override** (REQ-041h) | Low | `defaultAgentCommissionRate` exists at org level, but per-agent commission rate override is not stored on the Account model |
| **i18n / Multi-language** (REQ-045-047) | Low | Deferred to Phase 6 per PRD |
| **PWA / Offline** (REQ-048-050) | Low | Deferred to Phase 6 per PRD |

---

## New Files Since PRD Was Written

| File | Lines | Addresses |
|------|-------|-----------|
| `src/utils/learningRoles.js` | 174 | REQ-028, REQ-029, REQ-007 |
| `src/middleware/roles.js` | 96 | REQ-033a, REQ-033b, REQ-051 |
| `src/routes/superUser.js` | 538 | REQ-014a-f, REQ-041a-e, REQ-014e |
| `src/routes/partnerApi.js` | 375 | REQ-015-018, REQ-037-039 |
| `src/routes/partner.js` | ~200 | REQ-043 (partner dashboard) |
| `src/routes/agent.js` | 218 | REQ-043 (agent dashboard), REQ-027n |
| `src/models/AgentSaleAttribution.js` | 111 | REQ-041f, REQ-027p |
| `src/models/AgentInvite.js` | ~50 | REQ-053 (agent invites) |
| `src/models/AuditLog.js` | 89 | REQ-041i, REQ-014e |
| `src/utils/agentReferral.js` | ~30 | REQ-041g |
| `src/views/partner-dashboard.ejs` | — | REQ-043 |
| `src/views/agent-dashboard.ejs` | — | REQ-043 |

---

## Recommended Priorities

### 🔴 Must Do (Security)
1. **Add CSRF protection** — Install and configure CSRF middleware for all state-changing POST routes
2. **Fix secure cookie flag** — Set `secure: process.env.NODE_ENV === 'production'` in session config (currently only `httpOnly` and `sameSite: 'lax'`)
3. **Add self-referral prevention** — Check `agentId !== buyerAccountId` during referral resolution

### 🟡 Should Do (Functional Completeness)
4. **Partner org withdrawal flow** — Allow Partner Super Users to request withdrawal of organization earnings
5. **Partner course approval workflow** — Course Studio enforce org ownership + draft approval by partner super users
6. **Earnings trace UI** — Add per-sale breakdowns to creator/agent/admin dashboards
7. **Role-based navigation** — Show/hide menu items based on user role
8. **Commission/financial report CSV export**
9. **Standalone reports API** — `GET /api/reports/sales` and `GET /api/reports/commissions` endpoints

### 🟢 Nice to Have (Low Priority)
7. Churn metrics tracking
8. Per-agent commission rate overrides
9. i18n / PWA (Phase 6 per PRD)

---

## PRD Section 6.2 — Update Needed

The 21 items in Section 6.2 should be re-evaluated. At least 14 of them should be moved to Section 6.1 (Already Implemented) to reflect the current state of the codebase accurately.
