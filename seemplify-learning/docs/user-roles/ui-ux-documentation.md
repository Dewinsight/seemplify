# UI/UX Documentation
# AI in Nigeria Learning Platform — User Roles & Access Control

**Version:** 1.0  
**Date:** March 10, 2026  
**Companion to:** [PRD-user-roles.md](./PRD-user-roles.md)

---

## 1. Design Principles

### 1.1 Core UX Principles
- **Role transparency:** Users must always know what role they are operating as
- **Progressive disclosure:** Show only what the user's role permits; hide what they can't access
- **Consistency:** All new views follow the existing EJS + inline CSS pattern from `simple-lms.ejs` and `admin-dashboard.ejs`
- **Mobile-first:** All views designed for 375px (iPhone SE) first, then scaled up
- **Dual-brand ready:** All views use `resolveBranding(req.hostname)` for AIIN Nigeria vs. Seemplify theming

### 1.2 Existing Design System Reference

The platform uses server-rendered EJS templates with inline CSS. Key existing patterns:

| Pattern | Where Used | Description |
|---------|------------|-------------|
| Card-based layout | `simple-lms.ejs`, `admin-dashboard.ejs` | Content in rounded cards with shadow |
| Stat cards | `admin-dashboard.ejs` | Colored metric cards at top of dashboards |
| Data tables | `admin-dashboard.ejs` | Responsive tables with sort controls |
| Sidebar navigation | `simple-lms.ejs` | Collapsible sidebar with role-based items |
| Modal dialogs | `simple-lms.ejs` | Centered overlay modals for confirmations |
| Form layout | `register.ejs`, `teach-onboarding.ejs` | Stacked form fields with labels |
| Tab navigation | `simple-lms.ejs` | Horizontal tab bar for view switching |

---

## 2. Navigation Architecture

### 2.1 Global Navigation by Role

```
┌─────────────────────────────────────────────────────────────────┐
│  ROLE                  │  PRIMARY NAV ITEMS                     │
├────────────────────────┼────────────────────────────────────────┤
│  Super Admin           │  Dashboard · Users · Partners ·        │
│                        │  Courses · Reports · **Withdrawals** · │
│                        │  Settings · Super User Mgmt · Audit Log│
├────────────────────────┼────────────────────────────────────────┤
│  Admin                 │  Dashboard · Users · Courses ·         │
│                        │  Reports (limited)                     │
├────────────────────────┼────────────────────────────────────────┤
│  Channel Partner       │  Partner Dashboard · Agents ·          │
│  Super User            │  Courses · Reports · Commissions ·    │
│                        │  Settings                             │
├────────────────────────┼────────────────────────────────────────┤
│  Channel Partner User  │  Dashboard · Agents (add only) ·      │
│                        │  Courses (drafts) · Reports ·         │
│                        │  Commissions                          │
├────────────────────────┼────────────────────────────────────────┤
│  Channel Sales Agent   │  Agent Dashboard · Course Catalog ·   │
│                        │  My Sales · My Commissions ·          │
│                        │  Referral Links                       │
├────────────────────────┼────────────────────────────────────────┤
│  Partner Super User    │  Partner Dashboard · Courses ·        │
│                        │  Reports · Commissions · Settings     │
├────────────────────────┼────────────────────────────────────────┤
│  Partner User          │  Dashboard · Courses (drafts) ·       │
│                        │  Reports · Commissions                │
├────────────────────────┼────────────────────────────────────────┤
│  Creator               │  LMS Dashboard · Course Studio ·      │
│                        │  My Courses · **Earnings** ·           │
│                        │  **Withdrawals** · Settings            │
├────────────────────────┼────────────────────────────────────────┤
│  Learner               │  Browse Courses · My Learning ·       │
│                        │  Cart · Settings                      │
└────────────────────────┴────────────────────────────────────────┘
```

### 2.2 URL Structure

| View | Route | Roles Allowed |
|------|-------|---------------|
| Platform Admin Dashboard | `/admin` | `super_admin`, `admin` |
| Super User Management | `/admin/super-users` | `super_admin` |
| Partner Organization List | `/admin/partners` | `super_admin`, `admin` |
| Audit Log | `/admin/audit-log` | `super_admin` |
| Partner Dashboard | `/partner-dashboard` | `channel_partner_super`, `channel_partner_user`, `partner_super`, `partner_user` |
| Agent Management | `/partner-dashboard/agents` | `channel_partner_super`, `channel_partner_user` |
| Partner Course Studio | `/partner-dashboard/courses` | `channel_partner_super`, `channel_partner_user`, `partner_super`, `partner_user` |
| Partner Reports | `/partner-dashboard/reports` | `channel_partner_super`, `channel_partner_user`, `partner_super`, `partner_user` |
| Partner Commission Reports | `/partner-dashboard/commissions` | `channel_partner_super`, `channel_partner_user`, `partner_super`, `partner_user` |
| Partner Settings | `/partner-dashboard/settings` | `channel_partner_super`, `partner_super` |
| Agent Dashboard | `/agent-dashboard` | `channel_sales_agent` |
| Agent Course Catalog | `/agent-dashboard/courses` | `channel_sales_agent` |
| Agent Sales Report | `/agent-dashboard/sales` | `channel_sales_agent` |
| Agent Commissions | `/agent-dashboard/commissions` | `channel_sales_agent` |
| LMS Dashboard | `/simple-lms` | All authenticated (existing) |
| Course Studio | `/simple-lms?view=course-studio` | `creator`, `super_admin`, `admin`, partner roles (existing) |
| Creator Earnings | `/simple-lms?view=earnings` | `creator` (existing) |
| Creator Withdrawals | `/simple-lms?view=withdrawals` | `creator` |
| Admin Withdrawal Queue | `/admin/withdrawals` | `super_admin` |
| Admin Agent Payouts | `/admin/agent-payouts` | `super_admin` |
| Agent Earnings | `/agent-dashboard/earnings` | `channel_sales_agent` |
| Agent Settings (Payout Profile) | `/agent-dashboard/settings` | `channel_sales_agent` |

---

## 3. View Specifications

### 3.1 Registration Page Enhancement

**File:** `src/views/register.ejs` (modify existing)

**Changes:**
- Add intent selector with 4 options: "I want to Learn", "I want to Teach", "I'm a Partner", "I'm a Channel Partner"
- Partner/Channel Partner options expand to show: Organization Name field
- Submit button text changes based on intent: "Start Learning" / "Start Teaching" / "Apply as Partner" / "Apply as Channel Partner"
- Partner applications show a note: "Your application will be reviewed by our team"

```
┌─────────────────────────────────────────────────┐
│ Register for [Brand Name] Learning              │
│                                                 │
│  Full Name:     [________________________]      │
│  Email:         [________________________]      │
│  Password:      [________________________]      │
│                                                 │
│  I want to:                                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────┐│
│  │ ● Learn │ │ ○ Teach │ │ ○ Partner│ │○ Chan.││
│  └─────────┘ └─────────┘ └─────────┘ └───────┘│
│                                                 │
│  [If Partner/Channel selected:]                 │
│  Organization:  [________________________]      │
│  ⓘ Your application will be reviewed           │
│                                                 │
│  [ Start Learning ]                             │
│                                                 │
│  Already have an account? Sign in               │
└─────────────────────────────────────────────────┘
```

---

### 3.2 Partner Dashboard

**File:** `src/views/partner-dashboard.ejs` (new)

**Layout:** Full-width with collapsible sidebar; stat cards at top; content area below.

```
┌──────────────────────────────────────────────────────────┐
│   [Brand Logo]  Partner Dashboard         [User ▾] [⚙]  │
├──────────┬───────────────────────────────────────────────┤
│  ≡ Nav   │                                               │
│          │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────┐│
│ Dashboard│  │ 12      │ │ ₦450K   │ │ ₦45K    │ │ 8    ││
│ Agents   │  │ Agents  │ │ Sales   │ │ Comms.  │ │ Crs. ││
│ Courses  │  └─────────┘ └─────────┘ └─────────┘ └──────┘│
│ Reports  │                                               │
│ Comms.   │  ┌──────────────────────────────────────────  │
│ Settings │  │  Top Agents by Sales                       │
│          │  │  ┌──────────────────────────────────────── │
│          │  │  │ Name    │ Sales │ Commission │ Status   │
│          │  │  │─────────│───────│────────────│──────────│
│          │  │  │ Agent 1 │  42   │ ₦12,600    │ Active   │
│          │  │  │ Agent 2 │  35   │ ₦10,500    │ Active   │
│          │  │  └──────────────────────────────────────── │
│          │  │                                            │
│          │  │  Recent Activity                           │
│          │  │  • Agent Adaeze joined — 2h ago            │
│          │  │  • Course "AI Basics" published — 5h ago   │
│          │  │  • Agent Chinedu made ₦15K sale — 1d ago   │
│          │  └──────────────────────────────────────────  │
└──────────┴───────────────────────────────────────────────┘
```

---

### 3.3 Agent Management View

**File:** `src/views/partner-agents.ejs` (new, or tab within partner-dashboard)

```
┌──────────────────────────────────────────────────────────┐
│  Agent Management                    [+ Invite Agent]    │
│                                                          │
│  Search: [_________________]  Status: [All ▾]            │
│                                                          │
│  ┌───────────────────────────────────────────────────── │
│  │ Name        │ Email          │ Sales │ Commission │ ⋯│
│  │─────────────│────────────────│───────│────────────│──│
│  │ Adaeze O.   │ ada@email.com  │  42   │ ₦12,600   │🗑│
│  │ Chinedu M.  │ chi@email.com  │  35   │ ₦10,500   │🗑│
│  │ Bola T.     │ bol@email.com  │  28   │ ₦8,400    │🗑│
│  └───────────────────────────────────────────────────── │
│                                                          │
│  Showing 1-50 of 127 agents    [← Prev] [Next →]        │
└──────────────────────────────────────────────────────────┘
```

**Invite Agent Modal:**
```
┌──────────────────────────────────────┐
│  Invite New Agent                    │
│                                      │
│  Email: [______________________]     │
│                                      │
│  ⓘ An invitation email will be sent │
│    with a registration link that     │
│    expires in 24 hours.              │
│                                      │
│  [Cancel]            [Send Invite]   │
└──────────────────────────────────────┘
```

---

### 3.4 Agent Dashboard

**File:** `src/views/agent-dashboard.ejs` (new)

```
┌──────────────────────────────────────────────────────────┐
│  [Brand Logo]  Agent Dashboard            [User ▾]       │
├──────────┬───────────────────────────────────────────────┤
│  ≡ Nav   │                                               │
│          │  Welcome, Adaeze 👋                            │
│ Dashboard│                                               │
│ Courses  │  ┌─────────┐ ┌─────────┐ ┌──────────────┐   │
│ My Sales │  │ ₦45,200 │ │ ₦12,600 │ │ ₦8,400       │   │
│ Comms.   │  │ Sales   │ │ Earned  │ │ Pending Payout│   │
│          │  └─────────┘ └─────────┘ └──────────────┘   │
│          │                                               │
│          │  Course Catalog — [Partner Name]               │
│          │  ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│          │  │ AI Fund.│ │ ML 101  │ │ Data Sci│        │
│          │  │ ₦5,000  │ │ ₦8,000  │ │ ₦12,000 │        │
│          │  │[Get Link]│ │[Get Link]│ │[Get Link]│       │
│          │  └─────────┘ └─────────┘ └─────────┘        │
│          │                                               │
│          │  Recent Sales                                 │
│          │  • "AI Fundamentals" — ₦5,000 — 2h ago       │
│          │  • "ML 101" — ₦8,000 — 1d ago                │
└──────────┴───────────────────────────────────────────────┘
```

---

### 3.5 Super User Management View

**File:** `src/views/admin-super-users.ejs` (new, or tab within admin-dashboard)

```
┌──────────────────────────────────────────────────────────┐
│  Super User Management               [+ Add Super User] │
│                                                          │
│  ┌───────────────────────────────────────────────────── │
│  │ Name        │ Email           │ Since      │ Actions │
│  │─────────────│─────────────────│────────────│─────────│
│  │ Michael E.  │ mike@email.com  │ Jan 2026   │  —      │
│  │ Sarah K.    │ sara@email.com  │ Feb 2026   │ [Demote]│
│  │ James O.    │ jame@email.com  │ Mar 2026   │ [Demote]│
│  └───────────────────────────────────────────────────── │
│                                                          │
│  ⓘ You cannot demote yourself. The last remaining       │
│    super user cannot be demoted.                         │
└──────────────────────────────────────────────────────────┘
```

**Promote/Demote Confirmation Modal:**
```
┌──────────────────────────────────────┐
│  ⚠ Confirm Super User Demotion      │
│                                      │
│  You are about to remove super admin │
│  access from Sarah K.                │
│                                      │
│  Enter your password to confirm:     │
│  [______________________]            │
│                                      │
│  [Cancel]              [Confirm]     │
└──────────────────────────────────────┘
```

---

### 3.6 Partner Course Management

**File:** Extends existing `course-studio.ejs` or new `partner-courses.ejs`

**Course List (Partner View):**
```
┌──────────────────────────────────────────────────────────┐
│  Courses — [Partner Org Name]           [+ Create Course]│
│                                                          │
│  Tabs: [All] [Published] [Drafts] [Pending Review]       │
│                                                          │
│  ┌───────────────────────────────────────────────────── │
│  │ Title          │ Status    │ Author   │ Sales │ Actn │
│  │────────────────│───────────│──────────│───────│──────│
│  │ AI Fundamentals│ Published │ Michael  │  42   │ ✏ 📊│
│  │ ML 101         │ Published │ Sarah    │  35   │ ✏ 📊│
│  │ Data Sci Intro │ Draft     │ Bola     │  —    │ ✅ ❌│
│  └───────────────────────────────────────────────────── │
│                                                          │
│  ✏ = Edit    📊 = Analytics   ✅ = Approve   ❌ = Reject │
└──────────────────────────────────────────────────────────┘
```

---

### 3.7 Admin Partner Overview

**File:** `src/views/admin-partners.ejs` (new, or tab within admin-dashboard)

```
┌──────────────────────────────────────────────────────────┐
│  Partner Organizations              [+ Create Partner]   │
│                                                          │
│  ┌───────────────────────────────────────────────────── │
│  │ Org Name     │ Type    │ Status │ Agents │ Sales    │
│  │──────────────│─────────│────────│────────│──────────│
│  │ TechSales NG │ Channel │ Active │   45   │ ₦2.1M   │
│  │ EduPartners  │ Partner │ Active │   —    │ ₦890K   │
│  │ AI Academy   │ Channel │ Pending│    0   │ —       │
│  └───────────────────────────────────────────────────── │
│                                                          │
│  [Activate] [Suspend] [View Details] on row hover/click  │
└──────────────────────────────────────────────────────────┘
```

---

### 3.8 Admin Unified Payout Queue

**File:** `src/views/admin-withdrawals.ejs` (new, or tab within admin-dashboard)

> All payouts flow through this single admin queue: creator withdrawals, partner org withdrawals, AND agent commission payouts.

```
┌──────────────────────────────────────────────────────────────┐
│  Withdrawal Requests                                         │
│                                                              │
│  Tabs: [Pending (3)] [Recommended (2)] [Approved - Awaiting   │
│        Payout (1)] [Paid] [Rejected]                          │
│                                                              │
│  ┌──────────────────────────────────────────────────────────│
│  │ Type     │ Name       │ Amount   │ Requested │ Bank     │⋯│
│  │──────────│────────────│──────────│───────────│──────────│──│
│  │ Creator  │ Ada O.     │ ₦45,000  │ Mar 8     │GTB *1234 │✅❌│
│  │ Creator  │ Chinedu M. │ ₦120,000 │ Mar 7     │UBA *5678 │✅❌│
│  │ Partner  │ TechOrg Ltd│ ₦85,000  │ Mar 6     │Acc *9012 │✅❌│
│  └──────────────────────────────────────────────────────────│
│                                                              │
│  ✅ = Approve   ❌ = Reject (with notes)                      │
│                                                              │
│  [Recommended Tab — Agent Commissions flagged by Partner:]   │
│  ┌──────────────────────────────────────────────────────────│
│  │ Agent       │ Partner Org │ Amount  │ Recommended │Bank  │⋯│
│  │─────────────│─────────────│─────────│─────────────│──────│──│
│  │ Chinedu M.  │ TechOrg Ltd │ ₦950    │ Mar 8       │GTB * │✅❌│
│  │ Bola T.     │ EduPartners │ ₦1,200  │ Mar 7       │UBA * │✅❌│
│  └──────────────────────────────────────────────────────────│
│                                                              │
│  ✅ = Approve   ❌ = Reject (with notes)                      │
│                                                              │
│  [Approved - Awaiting Payout Tab:]                           │
│  ┌──────────────────────────────────────────────────────────│
│  │ Type     │ Name       │ Amount   │ Approved  │ Bank     │⋯│
│  │──────────│────────────│──────────│───────────│──────────│──│
│  │ Creator  │ Sarah K.   │ ₦85,000  │ Mar 5     │Zen *3456 │💰│
│  │ Agent    │ James O.   │ ₦620     │ Mar 4     │FBN *7890 │💰│
│  └──────────────────────────────────────────────────────────│
│                                                              │
│  💰 = Mark as Paid (after manual bank transfer)              │
└──────────────────────────────────────────────────────────────┘
```

**"Mark as Paid" Modal:**
```
┌──────────────────────────────────────┐
│  Mark Withdrawal as Paid             │
│                                      │
│  Creator: Sarah K.                   │
│  Amount: ₦85,000                     │
│  Bank: Zenith Bank - ****3456        │
│                                      │
│  Transaction Ref:                    │
│  [______________________]            │
│  ⓘ Enter your bank transfer          │
│    reference number                  │
│                                      │
│  Admin Notes (optional):             │
│  [______________________]            │
│                                      │
│  [Cancel]         [Confirm Paid]     │
└──────────────────────────────────────┘
```

**"Reject" Modal:**
```
┌──────────────────────────────────────┐
│  Reject Withdrawal Request           │
│                                      │
│  Creator: Ada O.                     │
│  Amount: ₦45,000                     │
│                                      │
│  Reason for rejection (required):    │
│  [______________________]            │
│  [______________________]            │
│                                      │
│  ⚠ The creator will be notified     │
│    with your notes.                  │
│                                      │
│  [Cancel]              [Reject]      │
└──────────────────────────────────────┘
```

---

### 3.9 Creator Earnings & Withdrawal View

**File:** Within `src/views/simple-lms.ejs` (existing, extend with new tab/view)

```
┌──────────────────────────────────────────────────────────────┐
│  My Earnings                                                 │
│                                                              │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌──────────────┐│
│  │ ₦285,000  │ │ ₦145,000  │ │ ₦45,000   │ │ ₦95,000      ││
│  │ Total     │ │ Withdrawn │ │ Pending   │ │ Available    ││
│  │ Earned    │ │           │ │ Withdrawal│ │ Balance      ││
│  └───────────┘ └───────────┘ └───────────┘ └──────────────┘│
│                                                              │
│                              [Request Withdrawal]            │
│                                                              │
│  Tabs: [Sales History] [Withdrawal History]                  │
│                                                              │
│  [Sales History Tab:]                                        │
│  ┌──────────────────────────────────────────────────────────│
│  │ Course         │ Buyer      │ Amount │ My Share │ Date   │
│  │────────────────│────────────│────────│──────────│────────│
│  │ AI Fundamentals│ learner@.. │ ₦5,000 │ ₦3,500   │ Mar 8  │
│  │ ML 101         │ student@.. │ ₦8,000 │ ₦5,600   │ Mar 7  │
│  └──────────────────────────────────────────────────────────│
│                                                              │
│  [Withdrawal History Tab:]                                   │
│  ┌──────────────────────────────────────────────────────────│
│  │ Amount    │ Status     │ Requested │ Paid      │ Notes  │
│  │───────────│────────────│───────────│───────────│────────│
│  │ ₦85,000   │ 🟢 Paid    │ Feb 20    │ Feb 25    │ —      │
│  │ ₦60,000   │ 🟢 Paid    │ Jan 15    │ Jan 20    │ —      │
│  │ ₦45,000   │ 🟡 Pending │ Mar 8     │ —         │ [Cancel]│
│  └──────────────────────────────────────────────────────────│
└──────────────────────────────────────────────────────────────┘
```

**Request Withdrawal Modal:**
```
┌──────────────────────────────────────┐
│  Request Withdrawal                  │
│                                      │
│  Available Balance: ₦95,000          │
│                                      │
│  Amount: ₦ [______________]          │
│                                      │
│  Payout to:                          │
│  GTBank - 0123456789 - Ada Obi       │
│  [Change payout details →]           │
│                                      │
│  Notes (optional):                   │
│  [______________________]            │
│                                      │
│  ⓘ Withdrawals are manually reviewed │
│    and processed within 3-5 business │
│    days.                             │
│                                      │
│  [Cancel]       [Submit Request]     │
└──────────────────────────────────────┘
```

---

### 3.10 Agent Earnings & Commission Trace

**File:** Within agent dashboard view (new)

```
┌──────────────────────────────────────────────────────────────┐
│  My Commissions                                              │
│                                                              │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐              │
│  │ ₦950     │ │ ₦560     │ │ ₦390     │              │
│  │ Total    │ │ Paid     │ │ Pending  │              │
│  │ Earned   │ │ Out      │ │ Payout   │              │
│  └───────────┘ └───────────┘ └───────────┘              │
│                                                              │
│  Sale-by-Sale Trace:                                         │
│  ┌──────────────────────────────────────────────────────────│
│  │ Course       │ Buyer     │ Sale   │ Plat. │ Rate│ Mine │
│  │──────────────│───────────│────────│───────│─────│──────│
│  │ AI Fundament.│ learn@..  │ ₦5,000 │ ₦1,500│ 10% │ ₦150 │
│  │ ML 101       │ stud@..   │ ₦8,000 │ ₦2,400│ 10% │ ₦240 │
│  │ Data Science │ new@..    │₦12,000 │ ₦3,600│ 10% │ ₦360 │
│  └──────────────────────────────────────────────────────────│
│                                                              │
│  [Expand row] shows full trace:                              │
│  Sale: ₦5,000 → Creator: ₦3,500 (70%)                        │
│  → Platform: ₦1,500 (30%) → My Commission: ₦1,500 × 10% = ₦150│
│                                                              │
│  ⚠ Payout Profile: [Set up bank details →]                  │
│    (or shows: GTBank - ****1234 - Chinedu M.)                │
└──────────────────────────────────────────────────────────────┘
```

---

### 3.11 Admin Withdrawal Detail with Earnings Trace

**File:** Modal/detail view within admin withdrawal queue

```
┌──────────────────────────────────────────────────────────────┐
│  Withdrawal Review — Ada O.                                  │
│                                                              │
│  Requested: ₦45,000  │  Date: Mar 8  │  Status: Pending       │
│                                                              │
│  Payout Profile (frozen at request time):                    │
│  ┌──────────────────────────────────────────────────────────│
│  │ Bank: GTBank  │ Acct: 0123456789  │ Name: Ada Obi      │
│  └──────────────────────────────────────────────────────────│
│                                                              │
│  Balance Verification:                                       │
│  ┌──────────────────────────────────────────────────────────│
│  │ Total Earned (all time):           ₦285,000                │
│  │ Already Withdrawn (paid):          ₦145,000                │
│  │ Other Pending Withdrawals:          ₦0                     │
│  │ Available Balance:                 ₦140,000                │
│  │ This Request:                      ₦45,000       ✅        │
│  │ Remaining After Approval:           ₦95,000                │
│  └──────────────────────────────────────────────────────────│
│                                                              │
│  Contributing Sales (12 sales):       [▼ Expand All]         │
│  ┌──────────────────────────────────────────────────────────│
│  │ Course        │ Buyer     │ Date  │ Sale   │ Rate│ Share│
│  │───────────────│───────────│───────│────────│─────│──────│
│  │ AI Fundament. │ learn@..  │ Mar 8 │ ₦5,000 │ 70% │₦3,500│
│  │ ML 101        │ stud@..   │ Mar 7 │ ₦8,000 │ 70% │₦5,600│
│  │ Data Science  │ new@..    │ Mar 6 │₦12,000 │ 70% │₦8,400│
│  │ ...8 more...  │           │       │        │     │      │
│  └──────────────────────────────────────────────────────────│
│                                                              │
│  ▼ Expanded row shows full money flow:                        │
│  ┌──────────────────────────────────────────────────────────│
│  │ Sale: ₦5,000 ("AI Fundamentals" — Mar 8)                   │
│  │ ├── Creator (Ada O.):    ₦3,500 (70%)                     │
│  │ ├── Platform Share:      ₦1,500 (30%)                     │
│  │ │   ├── Agent (Chinedu):  ₦150 (10% of platform)          │
│  │ │   └── Net Platform:    ₦1,350                            │
│  │ └── Total:              ₦5,000 ✓                          │
│  └──────────────────────────────────────────────────────────│
│                                                              │
│  [Reject with Notes]              [Approve]                  │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. Interaction Patterns

### 4.1 Role Indicator
- A subtle badge showing the user's current role in the top nav bar
- Examples: `[Super Admin]`, `[Partner Admin]`, `[Agent - TechSales NG]`
- Helps users understand their current access level context

### 4.2 Confirmation Modals
- Used for all destructive or sensitive actions: demote, remove agent, suspend partner
- Must include password re-entry for super user management actions
- Consistent styling: centered, overlay backdrop, cancel/confirm buttons

### 4.3 Toast Notifications
- Success: green toast (auto-dismiss 3s) — "Agent invited successfully"
- Error: red toast (persist until dismissed) — "Cannot demote the last super user"
- Info: blue toast (auto-dismiss 5s) — "Draft submitted for review"
- Follow existing toast pattern from `simple-lms.ejs`

### 4.4 Empty States
- Agent roster empty: "No agents yet. Invite your first agent to start selling."
- Partner courses empty: "No courses yet. Create your first course to get started."
- No sales data: "No sales recorded yet. Share referral links to start earning."

### 4.5 Loading States
- Skeleton cards for dashboard stats while API loads
- Table row shimmer while data loads
- Button spinner for form submissions

---

## 5. Responsive Breakpoints

| Breakpoint | Width | Layout Changes |
|-----------|-------|----------------|
| Mobile | < 768px | Sidebar collapsed to hamburger; tables scroll horizontally; stat cards stack vertically |
| Tablet | 768px – 1024px | Sidebar auto-collapsed (icon-only); tables show key columns only |
| Desktop | > 1024px | Full sidebar; all table columns visible; multi-column stat cards |

---

## 6. Accessibility

### 6.1 Requirements
- All interactive elements must have unique `id` attributes for testing
- All buttons/links must have descriptive `aria-label` attributes
- Color alone must not convey information (icons + text for status indicators)
- Keyboard navigation must work for all modals and form controls
- Tab order must follow visual reading order

### 6.2 Color Usage for Roles
- Super Admin: Purple badge (`#7C3AED`)
- Admin: Blue badge (`#2563EB`)
- Channel Partner Super: Orange badge (`#EA580C`)
- Channel Partner User: Amber badge (`#D97706`)
- Channel Sales Agent: Green badge (`#059669`)
- Partner Super: Teal badge (`#0D9488`)
- Partner User: Slate badge (`#475569`)
- Creator: Indigo badge (`#4F46E5`)
- Learner: Gray badge (`#6B7280`)
