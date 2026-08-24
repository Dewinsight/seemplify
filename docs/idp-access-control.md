# IdP role and permission management

Seemplify Identity is the authorization authority for organization-scoped product access. Products may enforce resource relationships (for example, whether a person is a direct report), but they must not use a local role to restore a permission omitted or denied by the IdP matrix.

## Policy levels and precedence

Effective access is resolved in this order:

1. The IdP platform policy defines the permission catalogue and reusable global roles.
2. The organization may add grants or denies to a global role, or create an organization-only role.
3. Additional roles and direct grants or denies may be assigned to an organization member.
4. Product assignment (`appAccess`) removes products the member cannot enter.
5. A deny from any applicable organization role or member exception wins over every grant.

The canonical organization owner always retains `identity:access.manage`, `identity:roles.assign`, `identity:organization.delete`, and `identity:owner.transfer` so a bad override cannot permanently lock the organization. Organization administrators cannot grant permissions marked `delegable: false`; permissions whose scope is `platform` are non-delegable by default and are excluded from built-in organization roles.

## Administration surfaces

- `/admin/access-control` — IdP-wide product catalogue and global role templates. System administrators can inspect; super administrators can change the policy.
- `/organizations/:organizationId/access-control` — organization role overrides, custom roles, member assignments, direct exceptions, effective-access preview, and audit history.

Mutations are rate-limited, same-origin protected, audited, and revision checked. A stale editor receives HTTP `409` and must refresh before saving.
Audit history is returned only to platform administrators or organization roles with `identity:audit.read`; member-level assignments require member visibility or access-management authority.

## Signed OIDC contract

The current organization and every organization entry include:

```json
{
  "authorization": {
    "schemaVersion": 1,
    "policyRevision": 1,
    "organizationRevision": 1,
    "roleKeys": ["employee"],
    "roleNames": ["Employee"],
    "permissionsByApp": {
      "leave-management": ["request_leaves", "view_own_leaves"]
    },
    "permissionScopesByApp": {
      "leave-management": {
        "request_leaves": "self",
        "view_own_leaves": "self"
      }
    }
  }
}
```

The UserInfo root also exposes current-organization aliases: `authorization`, `roles`, `product_permissions`, `platform_roles`, and `platform_permissions`.

An app key with an empty array is an authoritative deny. A missing app key means the product was not assigned. During migration only, the absence of the entire versioned authorization object may use a legacy role fallback.

## Product adapter rule

Each product must:

- select only its own key in `permissionsByApp`;
- treat an empty permission array as authoritative;
- enforce the permission before applying team, department, direct-report, ownership, or other resource scope;
- keep system administration separate from organization authorization;
- reject product-local role or permission mutations for IdP-managed organizations;
- refresh its mirrored access on OIDC sign-in and honor `organizationRevision`.

The catalogue contract test verifies that every organization-managed Hub product has a matrix and that the permission constants enforced by product adapters are represented centrally.

Workspace projects only the `messaging`, `community`, and `automation-hub` matrices into its session. It mirrors the current organization matrix from the signed IdP roster so access-control webhooks can take effect without trusting a stale browser token. HTTP routes and Socket.IO room joins enforce exact product permissions before resource-level membership checks. The Angular shell hides unavailable navigation and routes direct access to a permission-specific recovery screen.

Experience Management stores the signed `experience-management` matrix against each mirrored space membership in SQLite and PostgreSQL runtime schema 34. Its API applies the matrix before journey capability and space-role checks, while the shell uses the same effective list for navigation and the Space settings denied state.

Attendance, Performance, Payroll, Leave, Recruiter, Approver, Seemplify Learning, and Frappe LMS consume only their assigned product matrix. Frappe LMS retains a coarse role projection for framework compatibility, but that projection is derived from the IdP matrix and is not an independent authorization source.
