# UBA FastLane Dashboard — Docker Guide


## Project Layout

Before building, confirm your project directory looks like this:

```
uba_branch_optimsation/
├── Dockerfile
├── docker_entrypoint.py
├── pyproject.toml
└── fast_lane/
    ├── __init__.py
    ├── main.py
    ├── dash_view.py
    └── queue_math_model.py
```

All four files — `Dockerfile`, `docker_entrypoint.py`, `pyproject.toml`, and
the `fast_lane/` folder — must sit in the same directory before you run any
`docker` command.

---

## Prerequisites

| Requirement | Minimum version | Check |
|---|---|---|
| Docker Desktop (Mac / Windows) | 4.0+ | `docker --version` |
| Docker Engine (Linux) | 20.10+ | `docker --version` |

No Python installation is required on your host machine. Everything runs
inside the container.

---

## Quick Start (three commands)

```bash
# 1. Build the image
docker build -t uba-fastlane .

# 2. Run the container
docker run -d --name uba-dashboard -p 8050:8050 uba-fastlane

# 3. Open the dashboard
open http://localhost:8050      # macOS
xdg-open http://localhost:8050  # Linux
# Windows: paste http://localhost:8050 into your browser
```

The dashboard is ready when `docker ps` shows the container status as
`healthy` (takes ~20 seconds on first start).

---

## Building the Image

```bash
docker build -t uba-fastlane .
```

**What this does:**

1. Pulls `ubuntu:24.04` as the base
2. Installs Python 3.12 and pip via `apt-get`
3. Installs the four runtime dependencies pinned in `pyproject.toml`:
   `dash==2.18.2`, `plotly==6.0.0`, `numpy==2.3.5`, `pandas==2.3.3`
4. Copies the `fast_lane/` package and entrypoint script into `/app`
5. Creates a non-root user (`appuser`) and runs the app under that user

**Tagging a versioned image** (recommended before sharing):

```bash
docker build -t uba-fastlane:1.0.0 .
docker tag uba-fastlane:1.0.0 uba-fastlane:latest
```

---

## Running the Container

### Standard run (background, auto-restarts on reboot)

```bash
docker run -d \
  --name uba-dashboard \
  --restart unless-stopped \
  -p 8050:8050 \
  uba-fastlane
```

| Flag | Purpose |
|---|---|
| `-d` | Run in background (detached) |
| `--name uba-dashboard` | Give the container a memorable name |
| `--restart unless-stopped` | Restart automatically if the host reboots |
| `-p 8050:8050` | Map host port 8050 → container port 8050 |

### Run on a different host port

If port 8050 is already in use on your machine:

```bash
docker run -d --name uba-dashboard -p 9000:8050 uba-fastlane
# Dashboard available at http://localhost:9000
```

### Run with debug mode enabled

Debug mode activates Dash's hot-reload and verbose error pages. Use this
during development only — never in a production or demo environment.

```bash
docker run -d \
  --name uba-dashboard-dev \
  -p 8050:8050 \
  -e DASH_DEBUG=true \
  uba-fastlane
```

---

## Environment Variables

The container reads three environment variables. All have safe defaults.

| Variable | Default | Description |
|---|---|---|
| `DASH_HOST` | `0.0.0.0` | Network interface to bind. **Do not change** — `0.0.0.0` is required for the port mapping to work inside Docker. |
| `DASH_PORT` | `8050` | Port the Dash server listens on inside the container. |
| `DASH_DEBUG` | `false` | Set to `true` to enable Dash hot-reload and error overlays. |

Override any variable with `-e` at runtime:

```bash
docker run -d -p 8050:8050 -e DASH_DEBUG=true uba-fastlane
```

---

## Managing the Container

```bash
# Check the container is running and healthy
docker ps

# Follow live logs (Ctrl+C to stop tailing)
docker logs -f uba-dashboard

# Stop the container
docker stop uba-dashboard

# Start it again
docker start uba-dashboard

# Stop and remove the container (image is kept)
docker stop uba-dashboard && docker rm uba-dashboard

# Remove the image entirely
docker rmi uba-fastlane
```

---

## Checking Health

The container includes an automatic healthcheck. Docker polls
`http://localhost:8050/` every 30 seconds after an initial 20-second
warm-up period. Three consecutive failures mark the container `unhealthy`.

```bash
# See current health status
docker inspect --format='{{.State.Health.Status}}' uba-dashboard

# See the last 5 healthcheck results
docker inspect --format='{{range .State.Health.Log}}{{.Output}}{{end}}' uba-dashboard
```

Expected statuses:

| Status | Meaning |
|---|---|
| `starting` | Container started, warm-up period not yet elapsed |
| `healthy` | Dashboard is responding — safe to open in browser |
| `unhealthy` | Dashboard not responding — check logs |

---

## Troubleshooting

### Port already in use

```
Error: bind: address already in use
```

Either stop whatever is using port 8050, or map to a different host port:

```bash
docker run -d --name uba-dashboard -p 9090:8050 uba-fastlane
```

### Container exits immediately

Check the logs for the error:

```bash
docker logs uba-dashboard
```

Common causes:

- Missing file at build time (check `docker build` output)
- Import error in the Python source — fix the code and rebuild

### Dashboard loads but charts are blank

This is a browser cache issue. Hard-refresh with `Ctrl+Shift+R`
(Windows/Linux) or `Cmd+Shift+R` (macOS).

### `healthy` status never appears

Dash may be slow to start on a low-resource machine. Increase the
`start-period` if needed by editing the `HEALTHCHECK` line in the
Dockerfile and rebuilding:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
    CMD curl -f http://localhost:8050/ || exit 1
```

---

## Rebuilding After Code Changes

The Dockerfile is structured so that **dependency installation is cached**
separately from source code. If you only change Python files in `fast_lane/`,
only the last two layers rebuild — not the pip install step.

```bash
# Stop and remove the old container
docker stop uba-dashboard && docker rm uba-dashboard

# Rebuild (deps layer reused if pyproject.toml unchanged)
docker build -t uba-fastlane .

# Start fresh container
docker run -d --name uba-dashboard -p 8050:8050 uba-fastlane
```

If the  `pyproject.toml` is changed  (e.g. update a dependency version), the full
pip install layer will re-run automatically.

---

## Deploying to a Remote Server

To run the dashboard on a Linux server (e.g. AWS EC2, Azure VM, DigitalOcean):

```bash

# On the remote server — install Docker
curl -fsSL https://get.docker.com | sh

scp -r ./uba_branch_optimsation user@server-ip:~/

# SSH into the server
ssh user@server-ip

# Build and run
cd ~/uba_branch_optimsation
docker build -t uba-fastlane .
docker run -d --name uba-dashboard --restart unless-stopped -p 8050:8050 uba-fastlane
```

Open firewall / security group to allow inbound TCP on port 8050,
then access the dashboard at `http://<server-ip>:8050`.

---

## Security Notes

- The container runs as a **non-root user** (`appuser`, UID 1001). This limits
  the blast radius of any vulnerability in the Dash or Plotly libraries.
- `DASH_DEBUG` is `false` by default. Debug mode exposes an interactive Python
  console in the browser — never enable it on a network-accessible server.
- No data leaves the container. The model is purely computational — no database
  connections, no external API calls, no file I/O.
