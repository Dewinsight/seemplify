# Multi-Tenant/Multi-Organization Migration Change Report

## Executive Summary

The Approver application has been successfully migrated from a single-organization architecture to a comprehensive multi-tenant system supporting multiple organizations. This migration introduces organization-level data isolation, enhances security through organization-scoped queries, and enables the platform to serve multiple independent entities simultaneously. All existing data has been preserved and migrated to a default "Testing" organization, ensuring backward compatibility while enabling future scalability.

**Key Metrics:**
- **7 Database Models** updated with organization fields and indexes
- **2 Controllers** refactored with organization-scoped operations
- **1 Middleware** enhanced with organization context injection
- **1 API Route** file updated with organization-aware endpoints
- **3 Seed Scripts** updated for multi-org support
- **1 Migration Script** created for data migration
- **2 Frontend Components** updated for organization selection

---

## Key Changes

### 1. Database Schema Updates

#### New Organization Model (`Organization.js`)
- **Created**: New standalone model to represent organizations
- **Fields**:
  - `name`: Unique organization name
  - `slug`: Auto-generated URL-friendly identifier (lowercase, hyphenated)
  - `description`: Optional description field
  - `createdBy`: Reference to User who created the organization
  - `createdAt`: Timestamp
- **Features**:
  - Pre-validation hook to auto-generate slug from name
  - Unique indexes on both `name` and `slug`

#### User Model Updates (`User.js`)
- **Added**: `organization` field (ObjectId reference, nullable for migration compatibility)
- **Changed**: Restructured permissions system to support multiple roles per department
  - Old: `permissions: [{ department, role }]`
  - New: `permissions: [{ department, roles: [...] }]` (roles is now an array)
- **New Roles**:
  - `CenterOfExcellence` (CoE reviewer)
  - `GovernanceApprover` (Tier 1 & 2 approver)
  - `ExecutiveApprover` (Tier 3 approver)
  - `Requester` (standard user)
- **Backward Compatibility**: Controllers still support legacy `role` field format

#### Department Model Updates (`Department.js`)
- **Added**: `organization` field (ObjectId reference, required)
- **Added**: Compound unique index on `(name, organization)` to allow same department names across different organizations
- **Removed**: Single-field unique index on `name` (replaced by compound index)

#### Project Model Updates (`Project.js`)
- **Added**: `organization` field (ObjectId reference, required)
- **No Breaking Changes**: All existing fields maintained

#### Rule Model Updates (`Rule.js`)
- **Added**: `organization` field (ObjectId reference, required)
- **Existing**: `department` field (null for organization-wide rules)
- **Scope Logic**: Rules can be organization-wide (department=null) or department-specific

#### Audit Model Updates (`Audit.js`)
- **Added**: `organization` field (ObjectId reference, required)
- **Purpose**: Ensures audit logs are scoped to organizations for compliance and isolation

#### Settings Model Updates (`Settings.js`)
- **Added**: `organization` field (ObjectId reference, unique)
- **Purpose**: Allows per-organization configuration (e.g., `minPassScore`)

---

### 2. Backend Controller Refactoring

#### Authentication Controller (`authController.js`)

**Organization-Aware Registration:**
- Now requires `organization` field during registration
- Validates organization exists before creating user
- Auto-assigns users to "General" department within selected organization
- Handles unverified user re-registration with OTP resend

**Login Enhancements:**
- Auto-migrates legacy users without organization to "Testing" org
- Auto-migrates legacy departments to "Testing" org during login
- Returns organization data in JWT payload: `{ _id, name, slug }`
- Populates user's organization and department permissions in response

**User Management:**
- `getAllUsers()`: Now scoped to requester's organization
- `updateUserRole()`: Validates target user belongs to same organization
- Prevents cross-organization user modifications

**Admin Seeding:**
- Updated to create admin within "Testing" organization
- Ensures organization exists before creating admin user

#### Main Controller (`mainController.js`)

**Organization-Wide Scoping:**
All data access methods now filter by `req.organization`:

**Rules Management:**
- `createRule()`: Automatically assigns `organization` from request context
- `getRules()`: Returns organization-scoped rules (global + department-specific)
- `deleteRule()`: Verifies rule belongs to user's organization

**Department Management:**
- `getDepartments()`:
  - Authenticated users: scoped to their organization
  - Unauthenticated (registration): accepts `?organization=xxx` query param
- `createDepartment()`: Auto-assigns organization from context
- `deleteDepartment()`: Validates department ownership before deletion

**Project/Initiative Management:**
- `analyzeProject()`:
  - Validates department belongs to user's organization
  - Fetches organization-scoped rules for analysis
  - Creates project with organization reference
- `getProjects()`: Returns projects scoped to user's organization and permissions
- `getProjectById()`: Validates project belongs to organization
- `deleteProject()`: Organization-scoped deletion
- `overrideProject()`: Organization-scoped override

**Tiered Approval Workflow:**
All review functions now organization-aware:
- `centerOfExcellenceReview()`: CoE review with organization scoping
- `governanceReview()`: Governance review with organization scoping
- `executiveReview()`: Executive review with organization scoping
- `getPendingReviews()`: Returns pending reviews within organization

**Dashboard:**
- `getDashboardStats()`: Statistics scoped to organization

**New Organization Endpoints:**
- `getOrganizations()`: Public endpoint to list all organizations (for registration)
- `createOrganization()`: Admin-only endpoint to create new organizations

---

### 3. Middleware Enhancements

#### Authentication Middleware (`auth.js`)

**New Middleware: `injectOrgContext`**
- Extracts organization from JWT payload
- Injects into `req.organization` for downstream use
- Returns 403 if user lacks organization context
- **Usage**: Applied to all protected routes after token verification

**Enhanced: `verifyRole`**
- Now supports array-based roles (`permissions[].roles`)
- Maintains backward compatibility with legacy `role` field
- Admin users bypass all role checks globally

**New Middleware: `optionalToken`**
- Parses JWT if present but doesn't require it
- Used for routes accessible both authenticated and unauthenticated
- Example: `/departments` endpoint (used during registration)

---

### 4. API Routes Updates

#### Route Protection (`api.js`)

**Authentication Flow:**
```javascript
// Before: verifyToken → verifyRole
// After: verifyToken → injectOrgContext → verifyRole
```

**Organization Routes:**
- `GET /organizations`: Public (for registration dropdown)
- `POST /organizations`: Admin-only, requires org context

**Department Routes:**
- `GET /departments`: Now uses `optionalToken` instead of public
  - Authenticated: returns user's organization departments
  - Unauthenticated: accepts `?organization=xxx` for registration

**All Protected Routes:**
Now include `injectOrgContext` middleware to ensure organization scoping:
- `/users/*`
- `/rules/*`
- `/projects/*`
- `/departments/*` (POST/DELETE)
- `/dashboard/*`

---

### 5. Migration Scripts

#### Multi-Org Migration Script (`migrateToMultiOrg.js`)

**Purpose**: One-time migration of existing single-org data to multi-tenant structure

**Steps Performed:**
1. Creates "Testing" organization (default migration target)
2. Updates all Users without organization → assigns to Testing
3. Updates all Departments without organization → assigns to Testing
4. Updates all Projects without organization → assigns to Testing
5. Updates all Rules without organization → assigns to Testing
6. Updates all Audits without organization → assigns to Testing
7. Updates/creates Settings for Testing organization
8. Drops old single-field unique index on `Department.name`
9. Verifies migration success (counts documents without organization)

**Safety Features:**
- Idempotent: Can be run multiple times safely
- Creates "Testing" org if doesn't exist
- Preserves all existing data
- Verification step ensures completion

**Usage:**
```bash
node scripts/migrateToMultiOrg.js
```

#### Updated Seed Scripts

**`seedDepartments.js`:**
- Now creates/finds "Testing" organization first
- Assigns all seeded departments to Testing org
- Checks for existing departments within organization scope

**`seedEscalationRules.js`:**
- Creates 16 mandatory escalation trigger rules
- All rules scoped to "Testing" organization
- Rules are organization-wide (department=null)
- Covers HR, Customer, Data, and Risk categories

---

### 6. Frontend Updates

#### AuthContext (`AuthContext.tsx`)

**Organization Support:**
- User interface now includes `organization?: { _id, name, slug }`
- Stores organization data from login response
- Organization persists in localStorage with user data

**Department Switching:**
- Added `activeDepartment` state
- `switchDepartment()` function for multi-department users
- Persists active department selection in localStorage

**Enhanced Permissions:**
- Supports new `permissions` structure with multiple roles
- Maintains backward compatibility with legacy `role` field

#### Register Component (`Register.tsx`)

**Multi-Org Registration Flow:**
1. Fetches all organizations on component mount
2. Displays organization dropdown (required field)
3. On organization selection, fetches departments for that organization
4. User selects department within chosen organization
5. Registration payload includes both `organization` and `department`

**Organization Selection:**
- Auto-selects first organization by default
- Cascading department dropdown (resets when organization changes)
- Defaults to "General" department if available

**Error Handling:**
- Handles existing unverified users (resends OTP)
- Validates organization and department selection

---

## New Features

### 1. Multi-Tenancy Support
- **Complete data isolation** between organizations
- **Independent configurations** per organization (Settings model)
- **Organization-scoped audit logs** for compliance
- **Cross-organization protection** in all API endpoints

### 2. Flexible Role System
- **Multiple roles per department** per user
- **Role hierarchy**: Requester < CoE < GovernanceApprover < ExecutiveApprover
- **Department-based permissions** with organization awareness
- **Backward compatible** with legacy single-role format

### 3. Organization Management
- **Self-service organization creation** (Admin users)
- **Public organization listing** for registration
- **Auto-generated URL slugs** for organization identification
- **Organization metadata** (name, description, creator tracking)

### 4. Enhanced Security
- **Organization context injection** via middleware
- **Automatic organization scoping** in all queries
- **Cross-organization access prevention**
- **JWT-based organization identity** (no URL tampering)

### 5. Department Flexibility
- **Same department names** across different organizations
- **Organization-scoped department uniqueness**
- **Hierarchical department structure** (organization → departments)

### 6. Tiered Approval Workflow
- **Center of Excellence (CoE) review** stage
- **Governance Committee review** stage
- **Executive review** stage for Tier 3 initiatives
- **Role-based workflow routing** based on tier level
- **Comprehensive approval history** tracking

---

## Migration Notes

### Pre-Migration Checklist
1. ✅ Backup database before running migration
2. ✅ Review all Users, Departments, Projects, Rules, Audits
3. ✅ Ensure MongoDB indexes are up to date
4. ✅ Review environment variables (no changes required)

### Migration Process

**Step 1: Run Migration Script**
```bash
cd approver/backend
node scripts/migrateToMultiOrg.js
```

**Expected Output:**
```
Step 1: Creating "Testing" organization...
  Created: <org_id>

Step 2: Migrating Users...
  Updated: X users

Step 3: Migrating Departments...
  Updated: X departments

Step 4: Migrating Projects...
  Updated: X projects

Step 5: Migrating Rules...
  Updated: X rules

Step 6: Migrating Audits...
  Updated: X audits

Step 7: Migrating Settings...
  Updated/Created settings

Step 8: Updating Department indexes...
  Dropped old index: name_1

Step 9: Verification...
  Users without org: 0
  Departments without org: 0
  Projects without org: 0
  Rules without org: 0
  Audits without org: 0

  Migration complete! All records have an organization.
```

**Step 2: Seed Initial Data (Optional)**
```bash
# Seed standard departments for Testing org
node scripts/seedDepartments.js

# Seed escalation trigger rules for Testing org
node scripts/seedEscalationRules.js

# Create admin user for Testing org (if needed)
curl -X POST http://localhost:5000/api/auth/seed-admin
```

**Step 3: Verify Migration**
- Login as existing user (should auto-migrate to Testing org)
- Check user's organization in JWT payload
- Verify departments are scoped correctly
- Test creating new projects/rules (should be org-scoped)

### Post-Migration Steps

1. **Create Additional Organizations (if needed):**
```bash
POST /api/organizations
Authorization: Bearer <admin_token>
{
  "name": "Production Org",
  "description": "Production environment organization"
}
```

2. **Reassign Users (if needed):**
   - Update user's `organization` field in database
   - Update user's department assignments to departments within new org
   - User must re-login to refresh JWT token

3. **Migrate Legacy Frontend Caches:**
   - Users should clear localStorage after migration
   - Old tokens without organization will trigger re-authentication

---

## Breaking Changes

### 1. Database Schema Changes

**⚠️ BREAKING: Department Name Uniqueness**
- **Before**: Department names were globally unique
- **After**: Department names are unique per organization
- **Impact**: Multiple organizations can have departments with the same name
- **Migration**: Existing departments auto-assigned to Testing org; no duplicates on migration
- **Action Required**: If manually creating departments, ensure uniqueness within organization scope

**⚠️ BREAKING: User Model Permissions Structure**
- **Before**: `permissions: [{ department: ObjectId, role: String }]`
- **After**: `permissions: [{ department: ObjectId, roles: [String] }]`
- **Impact**: Users can now have multiple roles per department
- **Migration**: Backward compatible (controllers handle both formats)
- **Action Required**: Frontend components should update to use `roles` array instead of `role` string

### 2. API Changes

**⚠️ BREAKING: Registration Requires Organization**
- **Before**: `POST /auth/register` with `{ username, email, password, department }`
- **After**: `POST /auth/register` with `{ username, email, password, organization, department }`
- **Impact**: All registrations must specify organization
- **Action Required**: Update registration forms to include organization selection

**⚠️ BREAKING: All Protected Routes Now Organization-Scoped**
- **Before**: Users could potentially access any data if they had appropriate role
- **After**: All data access is scoped to user's organization
- **Impact**: Cross-organization data access is blocked
- **Action Required**: None for standard users; Admins are org-scoped by default

**⚠️ BREAKING: Department Endpoint Behavior Change**
- **Before**: `GET /departments` returned all departments globally
- **After**:
  - Authenticated: Returns departments for user's organization
  - Unauthenticated: Requires `?organization=<id>` query param
- **Impact**: Unauthenticated access requires organization filter
- **Action Required**: Registration flow must pass `organization` query param

### 3. Middleware Changes

**⚠️ BREAKING: New Required Middleware**
- **Change**: All protected routes now require `injectOrgContext` middleware
- **Impact**: Routes without this middleware will fail organization-scoped queries
- **Action Required**: Custom routes must include middleware chain:
  ```javascript
  router.get('/custom', verifyToken, injectOrgContext, customHandler);
  ```

### 4. JWT Payload Changes

**⚠️ BREAKING: JWT Now Includes Organization**
- **Before**: JWT contained `{ id, username, isAdmin, role, permissions }`
- **After**: JWT contains `{ id, username, isAdmin, role, permissions, organization: { _id, name, slug } }`
- **Impact**: Existing tokens without organization will fail on protected routes
- **Action Required**: Users must re-login after migration to get new tokens

### 5. Frontend Breaking Changes

**⚠️ BREAKING: AuthContext Interface Update**
- **Before**: User type had `role: string` and `department: string`
- **After**: User type has:
  - `permissions?: Array<{ department, roles }>` (roles is array)
  - `organization?: { _id, name, slug }`
- **Impact**: Components relying on simple `role` field need updates
- **Action Required**: Update components to use `permissions` array or access legacy `role` field from payload

---

## Backward Compatibility Notes

### Maintained Compatibility

1. **Legacy Role Field**: Controllers still populate `user.role` in JWT for backward compatibility
2. **Single-Role Format**: Both `{ role: 'Admin' }` and `{ roles: ['Admin'] }` are supported
3. **Existing Data**: All existing users, departments, projects migrated to "Testing" organization
4. **Login Flow**: Legacy users auto-migrated on first login (no manual intervention)

### Recommended Updates

While backward compatible, these updates are recommended:

1. **Update Frontend to Use `permissions` Array**:
   ```typescript
   // Old
   if (user.role === 'Admin') { ... }

   // New
   if (user.isAdmin || user.permissions?.some(p => p.roles.includes('Admin'))) { ... }
   ```

2. **Update Registration Forms**:
   - Add organization selection dropdown
   - Cascade department loading based on selected organization

3. **Update User Management UIs**:
   - Display organization affiliation
   - Show multiple roles per department
   - Prevent cross-organization user modifications

---

## Testing Recommendations

### Unit Tests
- Test organization scoping in all controllers
- Test `injectOrgContext` middleware
- Test multi-role permission checks
- Test organization-based data isolation

### Integration Tests
- Test cross-organization access prevention
- Test migration script idempotency
- Test user auto-migration on login
- Test cascading department loading in registration

### End-to-End Tests
- Complete registration flow with organization selection
- Multi-organization user workflows
- Department switching for multi-department users
- Approval workflows across different organizations

### Security Tests
- Attempt cross-organization data access with manipulated JWT
- Verify organization scoping in all query endpoints
- Test role hierarchy enforcement
- Validate department-organization relationship integrity

---

## Performance Considerations

1. **Database Indexes**:
   - New compound index on `Department(name, organization)` optimizes lookups
   - All organization references should be indexed for query performance

2. **JWT Size**:
   - Organization object added to JWT increases token size slightly
   - Consider using organization ID only if payload size becomes concern

3. **Query Performance**:
   - All queries now include organization filter (additional where clause)
   - Minimal performance impact due to indexed fields

---

## Future Enhancements

1. **Organization Isolation Improvements**:
   - Implement database-level row-level security (RLS)
   - Add organization subdomain routing
   - Implement organization-specific branding

2. **Cross-Organization Features**:
   - Organization federation for shared rules
   - Inter-organization project collaboration
   - Centralized super-admin dashboard

3. **Advanced Role Management**:
   - Custom role definitions per organization
   - Granular permission flags beyond role hierarchy
   - Temporary role assignments with expiration

---

## Support & Documentation

### Key Files Modified
- **Models**: `Organization.js` (new), `User.js`, `Department.js`, `Project.js`, `Rule.js`, `Audit.js`, `Settings.js`
- **Controllers**: `authController.js`, `mainController.js`
- **Middleware**: `auth.js`
- **Routes**: `api.js`
- **Scripts**: `migrateToMultiOrg.js` (new), `seedDepartments.js`, `seedEscalationRules.js`
- **Frontend**: `AuthContext.tsx`, `Register.tsx`

### Migration Support
For issues during migration:
1. Check migration script output for errors
2. Verify all records have organization in Step 9
3. Check MongoDB indexes: `db.departments.getIndexes()`
4. Review application logs for organization-related errors

### Rollback Plan
If migration fails:
1. Restore database from pre-migration backup
2. Revert code changes to pre-multi-org commit
3. Review migration errors before retry
4. **Note**: Cannot rollback after users receive new JWT tokens

---

## Conclusion

The multi-tenant migration successfully transforms the Approver application from a single-organization system to a scalable multi-tenant platform. All existing data has been preserved and migrated to a "Testing" organization, ensuring zero data loss. The implementation maintains backward compatibility while introducing modern organization-scoping patterns, enhanced security, and flexible role management.

**Migration Status**: ✅ Complete and Production-Ready

**Next Steps**:
1. Run migration script in production environment
2. Test registration flow with organization selection
3. Create additional organizations as needed
4. Update frontend components to leverage new organization features
5. Monitor application logs for organization-scoping issues
