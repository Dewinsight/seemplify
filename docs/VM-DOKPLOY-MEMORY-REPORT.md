# VM & Dokploy Memory Usage Report

**Server:** Seemplify Azure VM (4.180.153.209)  
**Report date:** February 3, 2025  
**Uptime:** 2 days, 7+ hours

---

## 1. Executive Summary

| Metric | Value | Assessment |
|--------|--------|------------|
| **Total RAM** | 15.6 GB | Standard_D4s_v3 spec |
| **RAM used** | 5.9 GB | Healthy |
| **RAM available** | 9.3 GB | Good headroom |
| **Swap used** | 1.2 GB / 4 GB | Moderate – worth monitoring |
| **Load average** | 0.90, 1.66, 2.12 | Moderate; 2.12 on 15-min |
| **Disk (root)** | 48 GB / 124 GB (39%) | OK |
| **Running containers** | 42 | High count (Dokploy + LMS + Mailcow + apps) |

**Verdict:** Memory is adequate. Largest consumers are Mailcow (ClamAV ~1 GB), LMS (Frappe + MariaDB), Dokploy, and Outline. Swap use suggests the box is under periodic pressure; no urgent action required, but optimization and monitoring are recommended.

---

## 2. System Memory (Host)

```
               total        used        free      shared  buff/cache   available
Mem:            15Gi       5.9Gi       1.2Gi        23Mi       8.4Gi       9.3Gi
Swap:          4.0Gi       1.2Gi       2.8Gi
```

- **MemTotal:** 16,327,780 kB (~15.6 GB)
- **MemFree:** 1,247,076 kB (~1.2 GB)
- **MemAvailable:** 9,722,056 kB (~9.3 GB) – includes reclaimable cache
- **Buffers + Cached:** ~6.8 GB (file cache, reclaimable under pressure)
- **Swap used:** 1.2 GB – indicates the system has used swap at times
- **Slab (kernel):** ~2.5 GB (SReclaimable ~2 GB, SUnreclaim ~483 MB)

**Takeaway:** “Available” is the right number to watch; 9.3 GB is comfortable. Swap usage is moderate and suggests occasional spikes (e.g. builds, ClamAV scans).

---

## 3. Docker / Dokploy Container Memory

Containers are grouped by role. All limits show 15.57 GiB (no per-container limits).

### 3.1 Platform & infrastructure

| Container | Memory | % of 15.57 GiB | Notes |
|-----------|--------|----------------|-------|
| **dokploy** | 484 MiB | 3.04% | Dokploy control plane |
| **dokploy-postgres** | 72 MiB | 0.45% | Dokploy DB |
| **dokploy-redis** | 7.6 MiB | 0.05% | Dokploy cache |
| **dokploy-traefik** | 61 MiB | 0.38% | Reverse proxy |
| **Subtotal (Dokploy)** | **~624 MiB** | **~4%** | |

### 3.2 Seemplify applications (Dokploy-managed)

| Container | Memory | % | Notes |
|-----------|--------|---|-------|
| recruiter-backend | 136 MiB | 0.85% | |
| recruiter-frontend | 50 MiB | 0.32% | |
| identity-provider | 74 MiB | 0.46% | |
| leave-backend | 62 MiB | 0.39% | |
| leave-frontend | 29 MiB | 0.18% | |
| performance-backend | 54 MiB | 0.34% | |
| performance-frontend | 51 MiB | 0.32% | |
| payroll-backend | 40 MiB | 0.25% | |
| payroll-frontend | 32 MiB | 0.20% | |
| time-attendance-backend | 106 MiB | 0.66% | |
| time-attendance-frontend | 33 MiB | 0.21% | |
| marketing-site | 47 MiB | 0.29% | |
| approver-backend | 51 MiB | 0.32% | |
| approver-frontend | 1.9 MiB | 0.01% | |
| **Subtotal (apps)** | **~806 MiB** | **~5%** | |

### 3.3 LMS (Frappe)

| Container | Memory | % | Notes |
|-----------|--------|---|-------|
| lms_frappe | 672 MiB | 4.22% | Largest app container |
| lms_mariadb | 255 MiB | 1.60% | |
| lms_redis | 12 MiB | 0.08% | |
| **Subtotal (LMS)** | **~940 MiB** | **~6%** | |

### 3.4 Outline

| Container | Memory | % | Notes |
|-----------|--------|---|-------|
| outline | 356 MiB | 2.23% | |
| outline-postgres | 18 MiB | 0.11% | |
| outline-redis | 8 MiB | 0.05% | |
| **Subtotal (Outline)** | **~382 MiB** | **~2.4%** | |

### 3.5 Weaviate

| Container | Memory | % |
|-----------|--------|---|
| weaviate | 62 MiB | 0.39% |

### 3.6 Mailcow (email stack)

| Container | Memory | % | Notes |
|-----------|--------|---|-------|
| **clamd (ClamAV)** | **1,013 MiB** | **6.35%** | Largest single container |
| mysql-mailcow | 181 MiB | 1.14% | |
| ofelia | 236 MiB | 1.48% | |
| rspamd | 128 MiB | 0.80% | |
| sogo | 80 MiB | 0.50% | |
| php-fpm | 70 MiB | 0.44% | |
| dockerapi | 68 MiB | 0.43% | |
| dovecot | 47 MiB | 0.29% | |
| postfix | 31 MiB | 0.19% | |
| Others (nginx, redis, etc.) | ~90 MiB | | |
| **Subtotal (Mailcow)** | **~2,005 MiB** | **~12.6%** | |

### 3.7 Approximate total from containers

| Group | MiB | % of RAM |
|-------|-----|----------|
| Dokploy | 624 | 4.0% |
| Seemplify apps | 806 | 5.2% |
| LMS | 940 | 6.0% |
| Outline | 382 | 2.4% |
| Weaviate | 62 | 0.4% |
| Mailcow | 2,005 | 12.6% |
| **Total (containers)** | **~4,819 MiB** | **~30%** |

Note: This is container RSS as reported by Docker; host “used” (5.9 GB) also includes dockerd, host cache, and non-Docker processes (e.g. clamd on host, node, system services).

---

## 4. Top Host Processes by Memory

| Process | % MEM | Notes |
|---------|--------|-------|
| clamd | 6.2% | ClamAV (Mailcow antivirus) – ~1 GB |
| dockerd | 3.0% | Docker daemon |
| node (Dokploy server) | 2.6% | Dokploy API/server |
| frappe (python) | 2.5% | LMS |
| mariadbd (LMS) | 1.6% | LMS DB |
| ofelia | 1.4% | Mailcow scheduler |
| outline (node) | 1.3% | Outline server |
| mariadbd (other) | 1.1% | |
| rspamd | 0.9% | Mailcow spam filter |
| node (other) | 0.8% | |
| systemd-journald | 0.6% | |

ClamAV (clamd) and Docker/dockerd are the heaviest single processes; Frappe and MariaDB also contribute significantly.

---

## 5. Load and Disk

- **Load average:** 0.90 (1 min), 1.66 (5 min), 2.12 (15 min) on a 4‑vCPU VM – moderate load, some sustained activity.
- **Root filesystem:** 48 GB / 124 GB (39%) used – healthy.
- **Other mounts:** `/data/weaviate` 251 GB volume mostly free; `/mnt` 32 GB mostly free.

---

## 6. Findings and Recommendations

### 6.1 What’s using memory

1. **Mailcow (especially ClamAV):** ~2 GB total; ClamAV alone ~1 GB. This is the single largest consumer.
2. **LMS (Frappe + MariaDB):** ~940 MiB in containers plus host-side processes.
3. **Dokploy + Traefik + Postgres/Redis:** ~624 MiB.
4. **Outline:** ~382 MiB.
5. **Seemplify apps:** ~806 MiB across 14 app containers – reasonable.
6. **Swap:** 1.2 GB used – system has dipped into swap (e.g. during scans or builds).

### 6.2 Recommendations

1. **Monitor swap and “available” memory**
   - If “MemAvailable” stays below ~2 GB or swap use grows toward 2–3 GB, consider:
     - Reducing ClamAV resource use (e.g. scan schedule, limits), or
     - Upgrading to 32 GB RAM (e.g. Standard_D8s_v3) if you keep all services.

2. **Optional: ClamAV (Mailcow)**
   - If mail scanning is not critical, disabling or limiting ClamAV can free ~1 GB.
   - Alternatively, tune ClamAV (e.g. `MaxQueue`, scan concurrency) to lower peaks.

3. **Docker stats as a dashboard**
   - Run `docker stats --no-stream` (or use a cron + log) to track trends.
   - Alert if any container consistently grows (e.g. >1.5 GB) or if total container memory grows significantly.

4. **No urgent need to add RAM**
   - Current usage and 9.3 GB available indicate the VM is sized adequately for current workload.
   - Plan an upgrade if you add more stacks (e.g. more apps, another LMS, or heavier Mailcow usage).

5. **Disk**
   - Root at 39% is fine; keep an eye on log and image growth (e.g. `docker system df`, logrotate).

---

## 7. Quick Reference Commands

```bash
# Memory overview
free -h

# Container memory
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}'

# Top memory processes
ps aux --sort=-%mem | head -20

# Load and uptime
uptime
```

---

**Report generated from live data on 4.180.153.209.**  
For ongoing monitoring, consider exporting `docker stats` and `free -h` to a log or monitoring stack (e.g. Prometheus + Grafana, or your existing Azure monitoring).
