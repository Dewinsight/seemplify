# Hostinger CI without GitHub Actions dispatch

The KVM2 service polls canonical GitHub branches, records each first-parent
revision in a SQLite WAL queue, and uses two constrained containers to execute
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

Two jobs can execute concurrently. Each job container is capped at 1.5 vCPU and
4 GiB RAM with bridged networking, no swap or host Docker socket. Jobs in the same lane serialize;
the existing shared host deployment lock also serializes builds, migrations and
service mutations across lanes. The queue retains pending revisions and does
not cancel an active release when a newer commit arrives. A restart recovers
unfinished leases after removing only containers carrying their exact job label.
Deployments are therefore retried at least once after an interrupted service;
the existing immutable release and migration checks must remain idempotent.

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

Inspect job start/end times: two should overlap, the third should wait, and all
must finish successfully. Probe containers assert CPU, memory, swap and socket
isolation. On credential rotation, update the root-only file and encrypted vault,
rebuild and verify the AES-256 archive, then restart the coordinator. Revoking the
existing GitHub OAuth credential also revokes this service's API connection.
