# Shared KVM8 GitHub Actions runners

This stack provides two organization-scoped runners without mounting the host
Docker socket or any Seemplify production directory:

- `dewinsight-kvm8`: the single-concurrency build/deployment worker, capped at
  3 vCPU and 6 GB RAM.
- `dewinsight-kvm8-control`: the low-resource orchestrator used only by the
  `Deploy All Seemplify Apps` workflow. Keeping it separate prevents the
  orchestrator from occupying the sole worker while it waits for deployments.

The limits are ceilings, not reservations. When idle, only the runner listener
processes remain. No CPU or memory reservation is configured.

## Registration

1. Create the organization runner group `kvm8-shared` and grant it access only
   to `Xplorer-crm`, `Xplorer-Full-backend`, `seemplify`, and `experienments2`.
2. Create a short-lived organization registration token.
3. On KVM8, copy this directory to `/opt/github-actions-runner`, create a
   root-readable `.env` containing `RUNNER_TOKEN=...`, and run:

   ```bash
   docker compose --env-file .env -f compose.yml up -d --build
   ```

4. Confirm that both runners are online, then remove `RUNNER_TOKEN` from `.env`.
   The persisted runner volumes allow normal restarts and Compose updates
   without the token. A new token is required only if a runner volume is lost.

The public `seemplify` repository must not send pull-request code to KVM8.
Experience Management therefore keeps pull requests on `ubuntu-latest`; only
trusted `main` pushes use the shared worker. Production workflows are limited
to trusted push or manual-dispatch events.
