# LMS OIDC Integration Plan

**Date:** January 13, 2026  
**Status:** ✅ IMPLEMENTED  
**Goal:** Implement LMS-specific roles with OIDC SSO integration

---

## Overview

This plan implements:
1. **LMS Roles** - Special instructor/student roles separate from organization roles
2. **OIDC Integration** - SSO login for LMS with role claims
3. **Role Assignment UI** - Admin role configuration + access request for non-admins
4. **Login with Seemplify** - OAuth button on LMS login page

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Identity Provider (IDP)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Account   │  │  LMS Roles  │  │     OIDC Provider       │  │
│  │   Model     │◄─┤  (New!)     │  │  /authorize, /token     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      IDP Hub (Frontend)                          │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ LMS Card Click → Check Role → Admin: Select Role Modal      ││
│  │                              → Non-Admin: Request Access    ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Frappe LMS                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ OAuth Login │  │ Role Claim  │  │  Map to Frappe Roles    │  │
│  │  Button     │  │  Handler    │  │  (Instructor/Student)   │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: IDP - LMS Roles Model

### 1.1 Create LmsRole Schema

**File:** `Identityprovider/src/models/LmsRole.js`

```javascript
const LmsRoleSchema = new mongoose.Schema({
  account: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true
  },
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    required: true
  },
  role: {
    type: String,
    enum: ['instructor', 'student', 'course_creator', 'moderator'],
    required: true
  },
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount'
  },
  assignedAt: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  }
})
```

### 1.2 LMS Role Permissions

| Role | Permissions |
|------|-------------|
| **instructor** | Create courses, manage batches, grade assignments, view analytics |
| **student** | Enroll in courses, submit assignments, view certificates |
| **course_creator** | Create/edit courses, manage content |
| **moderator** | Moderate discussions, manage users |

---

## Phase 2: IDP - OIDC Client for LMS

### 2.1 Add LMS Client Configuration

**File:** `Identityprovider/clients.json`

```json
{
  "client_id": "lms",
  "client_secret": "lms-seemplify-secret-2026",
  "redirect_uri_patterns": [
    "https://lms.seemplifyai.com/api/method/frappe.integrations.oauth2_logins.custom",
    "https://lms.seemplifyai.com/api/method/frappe.integrations.oauth2_logins.login_via_oauth2",
    "http://localhost:8000/api/method/frappe.integrations.oauth2_logins.custom"
  ],
  "allowed_origins": [
    "https://lms.seemplifyai.com",
    "http://localhost:8000",
    "https://auth.seemplifyai.com"
  ],
  "response_types": ["code"],
  "grant_types": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_method": "client_secret_post"
}
```

### 2.2 LMS-Specific Claims

Add to OIDC claims:
```javascript
{
  lms_role: 'instructor' | 'student' | 'course_creator' | 'moderator',
  lms_permissions: ['create_courses', 'enroll_courses', ...],
  lms_organization: { id, name }
}
```

---

## Phase 3: IDP Hub - Role Assignment UI

### 3.1 Hub App Config Update

**File:** `Identityprovider/src/config/hubApps.js`

Change LMS from `authType: 'direct'` to `authType: 'oidc'`:
```javascript
{
  appId: 'lms',
  name: 'Seemplify LMS',
  authType: 'oidc',           // Changed from 'direct'
  clientId: 'lms',
  requiresLmsRole: true,      // New flag for special handling
  ...
}
```

### 3.2 Role Selection Modal (Admins)

When admin clicks LMS card without a role:
- Show modal: "Select your LMS role"
- Options: Instructor, Student, Course Creator
- Auto-assign and redirect

### 3.3 Access Request (Non-Admins)

When non-admin clicks LMS card without a role:
- Show modal: "Request Access to LMS"
- Options: Request as Student, Request as Instructor
- Submit creates access request for admin approval

---

## Phase 4: LMS - Social Login Configuration

### 4.1 Configure Social Login Provider

In Frappe LMS, create Social Login Key for Seemplify:
```
Provider Name: Seemplify
Client ID: lms
Client Secret: lms-seemplify-secret-2026
Base URL: https://auth.seemplifyai.com
Authorize URL: /oidc/auth
Token URL: /oidc/token
Userinfo URL: /oidc/me
```

### 4.2 Create Custom OAuth Handler

**File:** `lms/lms/lms/oauth_handler.py`

```python
import frappe
from frappe import _

def process_seemplify_login(user_info):
    """
    Handle Seemplify OIDC login with role claims
    """
    email = user_info.get('email')
    lms_role = user_info.get('lms_role')
    
    # Map OIDC role to Frappe role
    role_mapping = {
        'instructor': 'LMS Instructor',
        'student': 'LMS Student', 
        'course_creator': 'LMS Course Creator',
        'moderator': 'LMS Moderator'
    }
    
    frappe_role = role_mapping.get(lms_role, 'LMS Student')
    
    # Assign role to user
    if not frappe.db.exists('Has Role', {'parent': email, 'role': frappe_role}):
        user = frappe.get_doc('User', email)
        user.add_roles(frappe_role)
```

### 4.3 Login Page Button

Add "Login with Seemplify" button to login page via hooks or template override.

---

## Phase 5: API Endpoints

### 5.1 IDP API Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/lms/roles/:userId` | Get user's LMS role |
| POST | `/api/lms/roles` | Assign LMS role (admin only) |
| DELETE | `/api/lms/roles/:roleId` | Remove LMS role |
| POST | `/api/lms/access-requests` | Submit access request |
| GET | `/api/lms/access-requests` | List pending requests (admin) |
| PUT | `/api/lms/access-requests/:id` | Approve/deny request |

### 5.2 Route File

**File:** `Identityprovider/src/routes/lmsRoles.js`

---

## Implementation Order (TODOs)

### Phase 1: IDP Backend
- [ ] Create `LmsRole` model
- [ ] Create `LmsAccessRequest` model  
- [ ] Add LMS permissions to `permissions.js`
- [ ] Create `/api/lms/*` routes
- [ ] Add LMS claims to OIDC userinfo

### Phase 2: IDP Hub UI
- [ ] Update LMS app config (authType: 'oidc')
- [ ] Create role selection modal component
- [ ] Create access request modal component
- [ ] Handle LMS card click with role check
- [ ] Add admin role management UI

### Phase 3: OIDC Client Setup
- [ ] Add LMS client to `clients.json`
- [ ] Configure redirect URIs
- [ ] Test OIDC flow

### Phase 4: Frappe LMS Integration
- [ ] Create Social Login Key in Frappe
- [ ] Create custom OAuth handler
- [ ] Add "Login with Seemplify" button
- [ ] Map OIDC roles to Frappe roles
- [ ] Create LMS-specific Frappe roles

### Phase 5: Testing & Documentation
- [ ] Test full SSO flow
- [ ] Test role assignment
- [ ] Test access request flow
- [ ] Update documentation

---

## Database Schema Changes

### MongoDB (IDP)

```
Collection: lmsroles
{
  _id: ObjectId,
  account: ObjectId (ref: AiinAccount),
  organization: ObjectId (ref: AiinOrganization),
  role: String (enum),
  assignedBy: ObjectId,
  assignedAt: Date,
  isActive: Boolean
}

Collection: lmsaccessrequests
{
  _id: ObjectId,
  requestedBy: ObjectId (ref: AiinAccount),
  organization: ObjectId (ref: AiinOrganization),
  requestedRole: String (enum),
  status: String (pending/approved/denied),
  reviewedBy: ObjectId,
  reviewedAt: Date,
  createdAt: Date
}
```

### MariaDB (Frappe LMS)

Roles to create:
- `LMS Instructor`
- `LMS Student`
- `LMS Course Creator`
- `LMS Moderator`

---

## Security Considerations

1. **Role Assignment**: Only org admins/owners can assign LMS roles
2. **Access Requests**: Require admin approval before granting access
3. **Token Validation**: Validate LMS claims on every protected route
4. **Audit Logging**: Log all role changes and access requests

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/models/LmsRole.js` | CREATE | LMS role model |
| `src/models/LmsAccessRequest.js` | CREATE | Access request model |
| `src/routes/lmsRoles.js` | CREATE | API routes |
| `src/utils/permissions.js` | MODIFY | Add LMS permissions |
| `src/config/hubApps.js` | MODIFY | Update LMS app config |
| `src/index.js` | MODIFY | Add LMS claims to OIDC |
| `clients.json` | MODIFY | Add LMS client |
| `lms/lms/oauth_handler.py` | CREATE | Custom OAuth handler |
| `lms/lms/hooks.py` | MODIFY | Add login hooks |

---

## Success Criteria

1. ✅ Users can login to LMS via "Login with Seemplify" button
2. ✅ LMS role is included in OIDC claims
3. ✅ Admins can assign LMS roles from hub
4. ✅ Non-admins can request access
5. ✅ Frappe maps OIDC role to correct permissions
6. ✅ Role changes reflect immediately on next login

---

## References

- [Frappe Social Login Documentation](https://frappeframework.com/docs/user/en/social-login)
- [OIDC Provider Configuration](https://github.com/panva/node-oidc-provider)
- [Seemplify IDP Architecture](./SSO_CONFIGURATION_GUIDE.md)
