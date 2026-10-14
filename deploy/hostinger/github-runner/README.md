# Dedicated KVM8 GitHub Actions runners

This stack provides four isolated runners without mounting the host
Docker socket or any Seemplify production directory:

- `dewinsight-kvm8` / `dewinsight-kvm8-seemplify`: the dedicated Seemplify
  build/deployment workers (`kvm8-seemplify-worker` and
  `kvm8-seemplify-worker-2`), each capped at 2 vCPU and 4 GB RAM. The original label is
  retained so existing Seemplify workflows remain compatible.
- `dewinsight-kvm8-workspace`: the dedicated Workspace build/deployment worker,
  capped at 2 vCPU and 4 GB RAM. Workspace jobs use only this label.
- `dewinsight-kvm8-control`: the low-resource orchestrator used only by the
  `Deploy All Seemplify Apps` workflow. Keeping it separate prevents the
  orchestrator from occupying either build worker while it waits for deployments.

CRM remains isolated on its existing KVM2 runner with the
`dewinsight-kvm2-crm` label. KVM8 has two concurrent Seemplify slots, one isolated Workspace slot, and one
orchestration slot. The aggregate KVM8 ceiling is 6.5 vCPU and 13 GiB RAM.

The limits are ceilings, not reservations. The three build workers can execute at
the same time, but each is independently constrained. When idle, only the runner
listener processes remain. No CPU or memory reservation is configured.

## Registration

1. Create the organization runner group `kvm8-shared` and grant it access only
   to `Xplorer-crm`, `Xplorer-Full-backend`, `seemplify`, and `experienments2`.
2. Create a short-lived organization registration token.
3. On KVM8, copy this directory to `/opt/github-actions-runner`, create a
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

## KVM2 pool

`kvm2.compose.yml` is the persistent stack installed at
`/opt/xplorer/github-runner/compose.yml` (Compose project `github-runner`).
The organization worker `kvm2-crm-worker` remains available to both CRM
repositories; the repository worker `kvm2-crm-frontend-worker` adds a second
frontend slot. Frontend and backend QA can overlap, and two frontend jobs can
run together. Backend jobs have one dedicated organization slot. Each slot
is capped at 1.5 vCPU and 4 GiB, with no swap or host Docker socket.
A one-time repository registration uses `FRONTEND_RUNNER_TOKEN`; remove it
after all registration files are durable and recreate token-free.

Both stacks set `RUNNER_MANUALLY_TRAP_SIG=1`, so the runner wrapper forwards
shutdown signals and closes the GitHub session before container replacement.
Never replace a container with an active `Runner.Worker` process.

For re-registration of the repository-scoped second Seemplify worker, set a
fresh short-lived `SEEMPLIFY_RUNNER_REGISTRATION_TOKEN` secret and choose
`seemplify-worker-2`. The repair workflow keeps `.env` routing and selects the
repository token; organization workers continue to use the organization token.
