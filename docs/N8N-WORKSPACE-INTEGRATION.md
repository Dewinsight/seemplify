# n8n Workspace integration

## Product boundary

Anytime is Seemplify's automation product. Its first runtime is one pinned,
self-hosted n8n deployment, but all Seemplify-specific code remains in the
Seemplify repositories:

- Workspace owns the private nodes, guarded context/action APIs, editor wrapper,
  release flag, and native-engine cutover;
- Identity owns product assignment and the Automations Hub card;
- the Workspace repository owns the custom n8n image, Docker Compose manifest,
  backup, deployment, and rollback scripts;
- n8n owns workflow editing and orchestration only. It has no direct Workspace
  database access and is never a second identity or authorization authority.

The same editor is presented inside Workspace at `/automations` and externally
from the Identity Hub. Both entry points reach the same n8n deployment and use
the same Workspace-brokered identity path.

## First-release scope

The initial node catalogue covers Workspace messaging, pages, notes, boards,
calendar, people, roles, and teams. Generic HTTP, code, command, filesystem,
public webhook, community package, AI, identity-administration, HR, payroll,
time, and external-provider nodes are excluded. Broader application nodes can
be added after each product exposes an allow-listed, audited API contract.

The existing native Automation Center remains the live editor and runtime while
`N8N_WORKSPACE_ENABLED=false`. At cutover, n8n becomes the only writer and the
native engine stops ingesting and executing work. Existing native records remain
readable for migration and audit; they are not deleted by this release.

The current custom package provides manual, scheduled, and error-driven n8n
workflows. It does not yet provide Workspace event-trigger parity or a migration
path for existing native workflow definitions. Public replacement therefore
also remains gated on a tested trigger bridge plus migration and rollback proof.

## Identity and editor launch

End users do not use n8n's native password or OIDC login. The only interactive
OIDC client retained for the integration is `n8n-workspace-node`, used by a
private node credential to call Workspace. The former direct `n8n` OIDC client
is deliberately absent.

Identity's `automation-hub` card launches
`https://workspace.seemplifyai.com/automations?editor=standalone`. Workspace
resolves the active organization, re-checks the subject, verified email,
canonical membership, and current permission matrix through a body-bound
signed Identity service request. That request uses a 32-byte HKDF-SHA256 key
derived from the existing pairwise Workspace OIDC client secret with fixed salt
`seemplify:workspace-platform-integration:hkdf-salt:v1` and versioned info
`seemplify:workspace-platform-integration:v1`.
Identity rejects the generic Experience/platform key on this route, and
Workspace neither mounts nor falls back to that sibling key. Workspace then
signs a single-use 30-second asymmetric JWT,
and posts it to
`https://automations.seemplifyai.com/rest/auth/embed`. The embedded iframe and
the full-page editor use this same POST exchange; tokens never appear in URLs.

The exchanged identity must be opaque and unique for every `{organization,
person}` pair in both `sub` and synthetic verified `email`. This prevents n8n's
email fallback from linking the same person across organization storage spaces.
The synthetic address uses the reserved non-deliverable `.invalid` namespace.
Workspace never mints n8n owner, administrator, or built-in `global:member`
access. Production requires a pre-provisioned custom global role whose slug is
exactly `global:seemplify-workspace-editor` and whose global scope set is empty.
n8n 2.36.8 tags and unscoped/global variables are instance-wide, so embedded
users must not receive global tag or variable list/read scopes. Deployment
verifies the empty persisted scope set and requires the slug to exactly match
the trusted-key allow-list and Workspace's `N8N_EMBED_ROLE`.

n8n cannot express the complete Seemplify permission matrix in this first
release. Editor entry and delegated-node OAuth therefore use a deliberately
coarse gate: the user must hold all Automations read/create/edit/delete/run,
execution read/manage, connection read/manage, and settings-manage permissions.
Every actual Workspace node operation still re-checks its narrower product and
object permission against fresh Identity claims.

Native login, invitation, password-reset, user-directory, and public API routes
remain blocked at the public n8n gateway. The root-owned instance owner is a
break-glass operator only and is accessed through an audited local tunnel, not
the public editor.

## Tenant-isolation release gate

Opaque per-organization identities prevent personal-space collision, but that
alone is not sufficient for a multi-tenant release. Before public cutover, the
licensed n8n instance must also prove one of these hard boundaries:

1. one n8n project per Identity organization, with IdP-managed membership and
   the Workspace OAuth credential/action organization bound to that project; or
2. an equivalent server-enforced mapping that prevents a user who belongs to
   two organizations from storing Organization B credentials or execution data
   in Organization A's n8n space.

The deployment is fail-closed until that boundary, custom role, cross-tab/org
switch behavior, offboarding, logout, and session-expiry behavior have passed
authenticated acceptance. A configuration flag or hidden credential field is
not accepted as tenant enforcement.

Phase-one provisioning deliberately gives each `{organization, person}`
identity an isolated personal project with sharing disabled. That is safe for
individual authoring, but it is not yet an organization-shared automation
workspace: teammates cannot co-edit or jointly own workflows until a licensed,
IdP-managed organization project and role model is implemented and tested.

## Node execution contract

The private `@seemplify/n8n-nodes-workspace` package supplies:

- **Seemplify Workspace Context**, which lists only resources visible to the
  delegated user in the bound organization;
- **Seemplify Workspace**, which runs a schema-validated allow-listed action
  using a required stable idempotency key.

Every node request carries a Seemplify Identity access token. Workspace calls
a body-bound signed Identity introspection endpoint on every request. Identity
accepts only a live opaque token issued to the exact `n8n-workspace-node`
client, rebuilds active organization membership, and returns fresh permission
claims. Workspace intersects those claims with its local mirror so a token from
another Seemplify client or stale local state can never restore a revoked
permission. The API then checks the underlying resource permission and
object-level organization boundary.

Every write stores a durable receipt unique to organization, actor, and
idempotency key, including a canonical input digest. Concurrent duplicates are
blocked by a startup-verified unique database index. A successful replay returns
the stored result; an in-flight, failed, mismatched, or indeterminate outcome
fails closed. The action node requires an explicit stable source or business
operation key reused across retries; it never derives a key from n8n's current
execution ID. Any failure after domain-handler invocation is recorded as
indeterminate and requires manual verification rather than a blind retry.

## Runtime and Docker contract

The custom image extends the exact pinned `n8n:2.36.8` base digest and installs
the private node package from the Workspace repository. It does not fork n8n
core. The canonical Compose stack runs on Seemplify's existing Docker/Hostinger
infrastructure with PostgreSQL, immutable image digests, root-owned file
secrets, a restricted public gateway, execution pruning, explicit node
allow-lists, disabled community packages, and persistent database/home volumes.

Required protected runtime material includes:

- n8n database user, name, and password files;
- n8n encryption key and Enterprise/Embed activation key;
- a credentials-overwrite document containing only the
  `n8n-workspace-node` client secret;
- the Workspace embed signing key pair and trusted-key document;
- matching Identity/Workspace OIDC client-secret inputs for the versioned HKDF
  derivation; an optional future file-backed input may override them only when
  it can be added to the encrypted recovery vault;
- the minimal custom-role slug and verified scope manifest;
- the root-only break-glass owner values and deployment registry credentials.

No plaintext value belongs in Git. Production material stays under
`/opt/seemplify/secrets`; the portable access inventory remains encrypted under
the repository's existing vault process. Data backups do not persist the
derived HMAC key; the already-vaulted OIDC input is its recovery source. This
release adds no stored secret: it domain-separates that OIDC material and
never uses the raw OIDC value as a MAC key. The tradeoff is coordinated
rotation—Identity and Workspace must receive the same new OIDC client secret in
one rollout or signed internal calls fail closed. A future vault-backed
direction-specific file input removes that coupling.

Backups include a native n8n PostgreSQL dump, the n8n home volume, and a paused,
checksum-verified snapshot of the legacy Automation Hub SQLite volume. Dark
deployment and cutover fail when the legacy recovery copy is unavailable.

## Mandatory production gates

1. Obtain written n8n Embed/Enterprise entitlement covering the customer-facing
   embedded editor, token exchange, custom roles, and tenant project model.
2. Provision the protected licence, key, role, project, OAuth, database, owner,
   and registry material; never commit it.
3. Build and scan the pinned image; verify the real custom-node loader and the
   exact allowed-node inventory. Any vulnerability exception must match an
   exact advisory and dependency path.
4. Dark-deploy the immutable tested image with no public Traefik ownership and
   prove licence features, `/rest/auth/embed`, key correspondence, blocked
   native login endpoints, role scopes, project isolation, and backup restore.
5. Add and verify the Workspace event-trigger bridge and migrate or explicitly
   archive every legacy workflow before claiming replacement parity. Inventory
   active developer-app subscriptions and pending deliveries plus queued,
   delayed, waiting, and approval runs; native event publishing currently owns
   those paths as well as workflow dispatch.
6. Run authenticated desktop/mobile acceptance for Identity launch, Workspace
   iframe, standalone POST exchange, denied assignment, revoked permissions,
   cross-tenant IDs, org switching, logout/offboarding, expiry, one real context
   call, and one idempotent action/replay.
7. Enable Identity Hub, Workspace n8n, native-engine disablement, and public
   router ownership as one coordinated cutover. Verify the exact live Identity,
   Workspace, and image revisions independently.
8. Roll back only after restoring the native flags and proving the legacy
   container/router healthy; preserve all n8n data for investigation.

The code may ship dormant with release flags disabled. The n8n container must
not be publicly deployed or used as a replacement until every external licence,
tenant-isolation, event-parity, and migration gate above passes.

This initial release hard-blocks `cutover` in source because unforgeable
n8n-project-to-Identity-organization credential binding and organization-scoped
browser sessions are not implemented yet. A multi-organization user's editable
credential could otherwise mix one organization's data into another n8n
project, and n8n's single host cookie cannot keep two organization editor
sessions isolated. Acceptance files or environment flags alone cannot remove
that block; a reviewed implementation and automated hostile tests are required.

References: [n8n token exchange for embedding](https://docs.n8n.io/deploy/host-n8n/deploy-as-an-oem-integration/set-up-token-exchange/),
[n8n projects](https://docs.n8n.io/user-management/rbac/projects/), and
[private nodes](https://docs.n8n.io/integrations/creating-nodes/deploy/install-private-nodes/).
