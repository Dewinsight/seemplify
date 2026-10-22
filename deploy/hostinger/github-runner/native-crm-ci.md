# Native CRM CI workers

CRM's remaining GitHub Actions jobs use `[self-hosted, dewinsight-crm-build]`.
Two repository-scoped agents, `crm-native-backend-srv2082470` and
`crm-native-frontend-srv2082470`, run on application host `srv2082470`.
The existing lightweight scanner containers and local release driver remain
separate. Keep `HOSTINGER_CI_DRIVER=local` and the native deployment guard until
the durable release queue has been explicitly drained and retired.

Each agent uses a different unprivileged Linux account and home under
`/var/lib/hostinger-actions/{backend,frontend}`. Neither account is in the Docker
group or has sudo. Its Docker client connects only to its own rootless engine
at `/run/user/<uid>/docker.sock`; never mount or grant access to the production
Docker socket. The rootless engines support service containers and image builds.
Test PostgreSQL is published only on `127.0.0.1:5432`; the production forwarding
endpoint on a different address remains separate.
The account homes remain mode 0700 and credential files remain private. Runner
source creation uses umask 022 so Docker build contexts and packaged assets
remain readable by non-root application users in the resulting images.
CPU CI accounts and the local execution image set ONNX's supported optional
asset install flag to `skip`; the npm package already bundles its native CPU
binding. CPU inference is retained, while unused CUDA downloads are avoided.
Backend image build stages use that same CPU-only install policy. A synthetic
native ONNX Identity model returned 42 from input 42 before applying this policy.

`hostinger-native-ci.slice` caps the native agents and their user service
managers together at 2 CPUs / 7 GiB, no swap. A runner process has a 4-GiB
ceiling, and each CI user service manager (including its rootless engine and
all container scopes) has a 4-GiB ceiling within the aggregate slice.
This host's rootless systemd container-scope creation requires interactive
authorization. The isolated engine therefore uses the cgroupfs compatibility
setting (Docker reports cgroup driver `none`); individual Docker resource flags
are ignored. The host systemd service and aggregate slice enforce the stated
ceilings through the user service manager, including container scopes created
beside the engine service. Never substitute
per-container Docker flags for those host limits or remove the shared lease.
Only one native job or local release may hold
`/run/lock/hostinger-ci-compute.lock`. The job-start hook holds a lease tied to
the actual Runner.Worker PID and start time, including post-job cleanup. Before
admission it also requires 7.5 GiB available RAM and 12 GiB free disk.
The local driver's optional `compute_lock` config uses that same lock for the
entire job. Other hosts without this config retain their existing behavior.
Do not reuse the narrower deployment-mutation lock for this purpose.
Job-start lease waiting counts toward GitHub's job timeout. Explicit heavy
workflow timeouts therefore allow 180 minutes for shared-slot queueing plus
execution; resource ceilings and existing test commands remain in force.

Provision prerequisites (`uidmap`, `rootlesskit`, `slirp4netns`,
`fuse-overlayfs`, DBus user sessions), a PostgreSQL client, the runner's runtime
libraries and Playwright Chromium's system libraries through host maintenance.
CI jobs install Chromium without `--with-deps`, since they cannot use sudo.
The existing rootful Docker/Swarm service must remain running and unchanged.
The installer uses the system AppArmor-confined `/usr/bin/rootlesskit`; it does
not disable the host's unprivileged-user-namespace restriction.

Install `native-ci-hook.py` and `install-native-crm-ci.sh` as root-owned files in
`/opt/hostinger-native-ci`. The installer verifies the matching Docker 29.1.3
rootless-extras and Docker runtime archives at
`/opt/hostinger-native-tools/29.1.3/{rootless-extras,docker}.tgz`
before extracting them. Matching Docker/containerd/runc binaries stay private
to the CI engines; the production binaries and Docker service are unchanged.
Stage the reviewed GitHub runner archive, verify its
published checksum, and extract it into each user's `runner` directory.
Register each agent with a short-lived repository registration token using the
normal GitHub runner setup. Never commit tokens or credentials. Configure its
absolute work directory as its home plus `/_work`, then enable
`hostinger-crm-ci-{backend,frontend}.service`.

Completed-job hooks remove checked-out source, temporary payloads, Docker login
credentials and containers/unused volumes from only that user's rootless
engine. The hook first verifies the engine reports rootless mode. It retains
runner registration and tool caches, and bounds old BuildKit cache retention
with a 4-GB target. Its `cleanup-report.json` provides a private receipt.
Service startup repeats cleanup to recover from interrupted jobs. No cleanup
command connects to production Docker or deletes production volumes/backups.

The `Verify Own CI Runner` workflow exercises rootless PostgreSQL, cgroup
limits, slot queueing and cleanup. Its optional `failure` outcome deliberately
fails after creating disposable job resources; confirm the completed-job hook
removes them. Do not describe that deliberate acceptance failure as an
application regression or waive a real failing application test.

Verify a changed workflow with actionlint and current GitHub syntax. Older
actionlint 1.7.12 rejects the now-documented `concurrency.queue` key; preserve
`queue: max` and use only a narrow linter exception for that key, paired with
validation that it is not combined with `cancel-in-progress: true`.
Reference: https://github.blog/changelog/2026-05-07-github-actions-concurrency-groups-now-allow-larger-queues/

Before changing the installed local driver, back up its program, root-only
config and SQLite ledger, wait for no running release, and stop only the
coordinator. Set `compute_lock`, install the reviewed driver, run its Linux
contracts, and restart the coordinator. Recovery removes that config key and
restores the saved program while no job is active; preserve accepted jobs and
application data throughout.
