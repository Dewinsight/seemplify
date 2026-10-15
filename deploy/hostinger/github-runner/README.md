# Hostinger GitHub Actions runners

## KVM4 production profile

`kvm4.compose.yml` runs the migrated production pool on 4 vCPU and 16 GiB:
one shared Seemplify/Workspace build worker capped at 2 vCPU and 4 GiB, plus
an independent controller capped at 0.5 vCPU and 1 GiB. Their aggregate ceiling
is 2.5 vCPU and 5 GiB; additional builds queue. Host deployment commands also
serialize through `/var/lock/seemplify-production-deploy.lock`.

Run `bash deploy/hostinger/bootstrap-kvm4-builder.sh` as root on the host before
enabling deployments. It provisions `seemplify-production`, a BuildKit worker
with 1.5 CPU, 3 GiB RAM, no swap and one build step at a time. Cache garbage
collection targets 12 GB usage and 25 GB of free host space; active builds can
temporarily exceed those disk targets. The SSH server supplies
`BUILDX_BUILDER` to deployment sessions, so existing `docker build` commands
use this worker and load their images into the host engine. The bootstrap
verifies the worker limits before enabling that environment setting.

These build limits are separate from runner limits. Application containers
keep their existing service limits, and Dokploy-initiated builds need their
own capacity check.

Start this profile with `docker compose --env-file .env -f kvm4.compose.yml up -d`.
Do not start the four-worker `compose.yml` profile on KVM4. Retain the existing
`seemplify-worker-state` and `control-state` volumes and registration identities.
On the existing shared organization worker, add `dewinsight-kvm8-workspace` and
`dewinsight-kvm4-build`; add `dewinsight-kvm4-control` to the controller.
Repository permissions and runner group access remain unchanged. Stop the old
Workspace and second Seemplify worker before validating the reduced pool.

The `kvm8` names remain compatibility aliases for existing workflows; they do
not identify the current physical host. Run `validate-kvm4-runner-pool.yml` to
verify three queued build probes, Workspace routing and concurrent control.
The historical four-worker profile and its validation remain available for
hosts meeting the original KVM8 capacity requirements.

## KVM8 profile

This stack provides four isolated runners without mounting the host
Docker socket or any Seemplify production directory:

- `dewinsight-kvm8` / `dewinsight-kvm8-seemplify`: the dedicated Seemplify
  build/deployment workers (`kvm8-seemplify-worker` and
  `kvm8-seemplify-worker-2`), each capped at 2 vCPU and 4 GB RAM. The original label is
  retained so existing Seemplify workflows remain compatible.
- `dewinsight-kvm8-workspace`: the dedicated Workspace build/deployment worker,
  capped at 2 vCPU and 4 GB RAM. Workspace jobs use only this label.
- `dewinsight-kvm8-control`: the low-resource worker for API-only malware scans
  and the `Deploy All Seemplify Apps` orchestrator. Keeping it separate prevents the
  orchestrator from occupying either build worker while it waits for deployments.

CRM remains isolated on its KVM2 runner pool with the
`dewinsight-kvm2-crm` label. KVM8 has two concurrent Seemplify slots, one isolated Workspace slot, and one
orchestration slot. The aggregate KVM8 ceiling is 6.5 vCPU and 13 GiB RAM.

The limits are ceilings, not reservations. The three build workers can execute at
the same time, but each is independently constrained. When idle, only the runner
listener processes remain. No CPU or memory reservation is configured.

## Registration

1. Create the organization runner group `kvm8-shared` and grant it access only
   to `Xplorer-crm`, `Xplorer-Full-backend`, `seemplify`, and `experienments2`.
2. Create a short-lived organization registration token.
3. On KVM8, copy this directory to `/opt/seemplify/github-actions-runner`, create a
   root-readable `.env` containing `RUNNER_TOKEN=...`, and run:

   ```bash
   docker compose --env-file .env -f compose.yml up -d --build
   ```

4. Confirm that all four KVM8 runners are online, then remove `RUNNER_TOKEN`
   from `.env`.
   The persisted runner volumes allow normal restarts and Compose updates
   without the token. A new token is required only if a runner volume is lost.

The public `seemplify` repository must not send pull-request code to KVM8.
Experience Management therefore keeps pull requests on `ubuntu-latest`; only
trusted `main` pushes use the shared worker. Production workflows are limited
to trusted push or manual-dispatch events.

## Queue and capacity verification

Trusted core QA uses the two Seemplify workers, with each matrix limited to two
concurrent jobs. Deployment concurrency groups use `queue: max` and
`cancel-in-progress: false` to retain up to 100 waiting runs. Host-side deployment
locks continue to serialize production changes across repositories. Runner CPU
and RAM ceilings apply to container jobs; remote Docker builds execute on the
host and remain subject to the deployment lock.

Dispatch `validate-self-hosted-runner-pool.yml` to run three Seemplify probes
against two slots: two should overlap and the third should queue. Dispatch
`validate-runner-queue.yml` three times to verify the workflow concurrency queue.
Both probes are read-only with respect to production services.

The second Seemplify worker can be registered at repository scope by setting
`SEEMPLIFY_RUNNER_URL=https://github.com/Dewinsight/seemplify`,
`SEEMPLIFY_RUNNER_GROUP=` and a short-lived `SEEMPLIFY_RUNNER_TOKEN`. Remove only
the registration token after registration; retain the non-secret URL and group
settings in `.env`. Existing organization workers retain their durable identity.

## Native KVM2 Actions pool

`kvm2.compose.yml` is the persistent stack installed at
`/opt/xplorer/github-runner/compose.yml` (Compose project `github-runner`).
The organization worker `kvm2-crm-worker` remains available to both CRM
repositories; the repository worker `kvm2-crm-frontend-worker` adds a second
frontend slot. Frontend and backend QA can overlap, and two frontend jobs can
run together. Backend jobs have one dedicated organization slot. Each slot
is capped at 1.5 vCPU and 4 GiB, with no swap or host Docker socket.
A one-time repository registration uses `FRONTEND_RUNNER_TOKEN`; remove it
after all registration files are durable and recreate token-free.

While GitHub billing blocks private-repository Actions dispatch, CRM uses the
[independent Hostinger queue](../local-ci/README.md). Its two slots can run
frontend and backend lanes concurrently, including two backend lanes. The
repository variable `HOSTINGER_CI_DRIVER=local` prevents duplicate Actions
deployments after billing recovers. This queue reports commit statuses to GitHub
and retains full logs privately on the host.

Both stacks set `RUNNER_MANUALLY_TRAP_SIG=1`, so the runner wrapper forwards
shutdown signals and closes the GitHub session before container replacement.
Never replace a container with an active `Runner.Worker` process.

For re-registration of the repository-scoped second Seemplify worker, set a
fresh short-lived `SEEMPLIFY_RUNNER_REGISTRATION_TOKEN` secret and choose
`seemplify-worker-2`. The repair workflow keeps `.env` routing and selects the
repository token; organization workers continue to use the organization token.
