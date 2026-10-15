# Hostinger CI without GitHub Actions dispatch

The KVM2 service polls canonical GitHub branches, records each first-parent
revision in a SQLite WAL queue, and uses constrained containers to execute
the existing deployment workflows through pinned `act` 0.2.89. GitHub Actions
billing or dispatch availability does not control this queue. Seemplify's public
repository continues to use its working KVM8 Actions pool.

Only these CRM lanes execute code: frontend `development`/`staging`, and backend
`develop`/`staging`. Pull-request code is never executed by this service. Before
checkout, an installed trusted API-only scanner verifies the immutable changed
blobs. A failed or incomplete scan blocks execution. The source checkout remains
at the exact queued SHA. Without modifying that checked-out tree, the local
workflow adapter disables remote cache inputs and the Actions-driver condition,
and delegates workflow concurrency to the durable host queue.

The current KVM2 has 2 vCPU and 8 GiB RAM. One heavy job executes at a time;
additional accepted revisions remain queued. Each job container is capped at 1.5 vCPU and
3500 MiB RAM with bridged networking, no swap or host Docker socket. Jobs in the same lane serialize;
the existing shared host deployment lock also serializes builds, migrations and
service mutations across lanes. The queue retains pending revisions and does
not cancel an active release when a newer commit arrives. A restart recovers
unfinished leases after removing only containers carrying their exact job label.
Deployments are therefore retried at least once after an interrupted service;
the existing immutable release and migration checks must remain idempotent.
The coordinator admits a job only when MemAvailable covers its configured memory
limit plus 512 MiB of headroom. It keeps polling and retaining pushes while waiting.
The independent BuildKit builder uses 1 CPU / 3 GiB, no swap, max-parallelism=1
and disk GC limits; builds and migrations share the deployment lock.
Native lightweight scanner agents are capped separately at .5 CPU / 512 MiB each.

The execution image is built locally rather than published in a registry.
`ensure-image.sh` checks it before service startup and every job, rebuilds a
missing image from the trusted installed Dockerfile, and keeps a small isolated
container running so ordinary Docker image/system pruning cannot remove it.
The keeper has no network, credentials or host mounts and uses a read-only root
filesystem. Install this helper and the Dockerfile alongside `runner_queue.py`;
the existing native runner retains the base image needed for a local rebuild.

The coordinator alone reads its root-only GitHub credential. It is never passed
to test containers. The existing deployment SSH credential is provided to trusted
deployment jobs as before. Backend routes also read only the four allowlisted
Cloudinary settings from their existing root-only lane environment file so the
unchanged missing-only settings gate receives a complete account. Secret values
are written to a temporary mode-0600 file outside the checkout, masked by act,
and removed after the job. Other application and database secrets are excluded.
Runtime CI credentials live in
`/opt/seemplify/secrets/hostinger-ci`, with encrypted recovery entries in the
sibling access vault. Repository variables and caches are read at execution.
Only Git source creation uses the normal 022 umask so non-root application
images can read packaged files. Credentials, job artifacts and their enclosing
directories retain the coordinator's restrictive 077 umask.
`HOSTINGER_CI_DRIVER=local` selects the local queue; the Actions deployment job
must have the matching driver guard before this variable is enabled. Set it to
`actions` only after stopping/draining the local service when switching back.

GitHub receives `hostinger-ci/<lane>` and `hostinger-ci/polinrider-scan` commit
statuses. Full workflow logs remain root-only on the private Hostinger server,
under `/var/lib/hostinger-ci/jobs/<id>/job.log`. These are independent statuses,
not replacement or fabricated GitHub Actions jobs. Existing repository review
and malware rules remain enabled.

## Operations

```sh
systemctl status hostinger-ci.service
python3 /opt/hostinger-ci/runner_queue.py status
python3 /opt/hostinger-ci/runner_queue.py enqueue --route crm-frontend-dev
python3 /opt/hostinger-ci/runner_queue.py enqueue --route crm-backend-staging
python3 /opt/hostinger-ci/runner_queue.py retry --job 12
```

Manual enqueue accepts only the current allowlisted branch head. Duplicate push
identities are ignored; a failed job can be explicitly retried. Status delivery
retries independently of deployment so a temporary GitHub API failure does not
rerun a successful release. `verification.json` records the actual live container
revision and health; a skipped workflow or mismatching revision cannot pass.
Transient read-only GitHub requests receive at most three attempts. Authorization
and scan failures still block execution; deployment commands are never retried
by this network policy.

For a read-only queue test, enqueue three probes with distinct nonces:

```sh
python3 /opt/hostinger-ci/runner_queue.py enqueue --route crm-frontend-dev --kind probe --nonce 1
python3 /opt/hostinger-ci/runner_queue.py enqueue --route crm-frontend-dev --kind probe --nonce 2
python3 /opt/hostinger-ci/runner_queue.py enqueue --route crm-frontend-dev --kind probe --nonce 3
```

With the production one-worker configuration, inspect that probes serialize
and all finish successfully. For an isolated acceptance test with two workers,
two should overlap and the third should wait; do not raise production workers
without checking host headroom. Probe containers assert their configured CPU, memory, swap and socket
isolation. On credential rotation, update the root-only file and encrypted vault,
rebuild and verify the AES-256 archive, then restart the coordinator. Revoking the
existing GitHub OAuth credential also revokes this service's API connection.

## Current CRM host and recovery

CRM moved on 2026-10-15 to Hostinger KVM2 2065023 / 89.116.229.22.
Canonical URLs use dev-crm.cernel.ng, staging-crm.cernel.ng and their
dev-crm-api / staging-crm-api counterparts. Historical scripts called the old
1903452 / 191.215.40.99 host kvm2; it is retained KVM4 rollback storage and
legacy proxy only, with its coordinator/runners/application databases stopped.
New Dokploy must have 1536 MiB memory and NODE_OPTIONS heap1024 MiB; Traefik
must join both bridge and dokploy-network. Root-only runtime recovery, updated
database connection handover, pinned SSH host key and TLS CA are encrypted in
the sibling access vault/archive. Never restore an old database over live writes.

Backend jobs also persist Jest's dependency/transform cache in the named
`hostinger-ci-jest-cache` volume at `/tmp/jest_0`. Only allowlisted canonical
backend branches receive this volume. Jest retains responsibility for cache
invalidation; no test results are cached or skipped and workflow test commands
remain unchanged. This avoids discarding compiled test dependencies after each
ephemeral job. The volume contains test tooling artifacts, not CI credentials.
Backend execution uses a fresh checkout copied to a stable private path per
route under `state_dir/workspaces`. This keeps Jest's project-root cache key
stable across jobs; pending jobs in that route remain serialized. Source
symlinks are preserved, stale generated files are removed, and both workspaces
and the original per-job checkout are cleaned after execution. Credentials and
adapted workflows stay in the separate private job directory.
