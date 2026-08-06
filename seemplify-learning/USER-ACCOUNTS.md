# Seemplify Learning Platform - User Accounts

**Generated:** March 13, 2026  
**Environment:** localhost:5012 (Development)

---

## Login Credentials Summary

| Email | Password | Dashboard Access |
|-------|----------|------------------|
| Michaelegbo@gmail.com | Obiageli_1 | Admin Console |
| tonyegboo@gmail.com | Digital_1 | Agent Dashboard |
| tonyegbo1@gmail.com | Digital_1 | Partner Dashboard |

---

## All User Accounts

### 1. Michael Tony Egbo
- **Email:** michaelegbo@gmail.com
- **Learning Role:** super_admin
- **Is Super Admin:** true
- **Is System Admin:** true
- **Organization:** None
- **Dashboard:** Admin Console (full platform access)

### 2. Obiageli Egbo
- **Email:** tonyegbo1@gmail.com
- **Learning Role:** channel_partner_super
- **Is Super Admin:** false
- **Is System Admin:** false
- **Organization:** Uconnect Human Resources Ltd
- **Dashboard:** Partner Dashboard

### 3. JOVEES (Tony Egbo)
- **Email:** tonyegboo@gmail.com
- **Learning Role:** channel_sales_agent
- **Is Super Admin:** false
- **Is System Admin:** false
- **Organization:** Uconnect Human Resources Ltd (likely)
- **Dashboard:** Agent Dashboard

### 4. Michael Egbo
- **Email:** michael.egbo@aiinnigeria.com
- **Learning Role:** admin
- **Is Super Admin:** false
- **Is System Admin:** true
- **Organization:** None
- **Dashboard:** Admin Console

### 5. Michael Egbo
- **Email:** michael.egbo@dewinsight.com
- **Learning Role:** learner
- **Is Super Admin:** false
- **Is System Admin:** false
- **Organization:** None
- **Dashboard:** Standard LMS (learner view)

---

## Role Definitions

| Role | Description | Permissions |
|------|-------------|-------------|
| super_admin | Platform Super Administrator | Full system access, can manage users, courses, payments, partners, and all settings |
| admin | Platform Administrator | Can manage courses, view analytics, manage creators |
| channel_partner_super | Channel Partner Super User | Can manage agents, courses, view all partner data |
| channel_partner_user | Channel Partner Staff | Can create draft courses, view reports (no publish rights) |
| channel_sales_agent | Sales Agent | Can sell courses, view own sales and commissions |
| partner_super | Partner Super User | Can manage courses within partner org, view reports |
| partner_user | Partner Staff | Can create draft courses within partner org |
| creator | Content Creator | Can create and sell own courses |
| learner | Standard Learner | Can browse and enroll in courses |

---

## Partner Organizations

### Uconnect Human Resources Ltd
- **Type:** Channel Partner
- **Partner Super User:** tonyegbo1@gmail.com
- **Agents:** tonyegboo@gmail.com (channel_sales_agent)

---

## Notes

- The admin panel shows 5 users with direct role assignments
- The platform has 1 Super User (michaelegbo@gmail.com)
- There is 1 Partner Organization (Uconnect Human Resources Ltd)
- 3 users are associated with partner roles (channel_partner_super, channel_sales_agent)
- The agent dashboard is accessible at `/agent-dashboard`
- The partner dashboard is accessible at `/partner-dashboard`
