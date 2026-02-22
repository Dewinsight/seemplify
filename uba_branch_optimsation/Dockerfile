
FROM ubuntu:24.04

# ── Metadata ──────────────────────────────────────────────────────────────────
LABEL maintainer="UBA Branch Intelligence"
LABEL description="FastLane queueing theory dashboard"
LABEL version="0.0.0"

# ── Prevent interactive prompts during apt installs ───────────────────────────
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.12 \
        python3.12-venv \
        python3-pip \
        ca-certificates \
        curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ── Create a non-root user ────────────────────────────────────────────────────
RUN groupadd --gid 1001 appgroup \
 && useradd  --uid 1001 --gid appgroup --shell /bin/bash --create-home appuser

WORKDIR /app

COPY pyproject.toml .

# Skip pip upgrade - Ubuntu 24.04 system pip cannot be uninstalled (RECORD file not found)
RUN python3.12 -m pip install --no-cache-dir --break-system-packages \
        dash==2.18.2 \
        plotly==6.0.0 \
        numpy==2.3.5 \
        pandas==2.3.3

COPY fast_lane/           ./fast_lane/
COPY docker_entrypoint.py .


RUN python3.12 -m pip install --no-cache-dir --break-system-packages --no-deps -e .

# ── Hand ownership to non-root user ──────────────────────────────────────────
RUN chown -R appuser:appgroup /app
USER appuser

ENV DASH_HOST=0.0.0.0
ENV DASH_PORT=8050
ENV DASH_DEBUG=false
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# ── Expose dashboard port ─────────────────────────────────────────────────────
EXPOSE 8050

# ── Healthcheck ───────────────────────────────────────────────────────────────
# Shell form (plain string after CMD) so ${DASH_PORT} is expanded by /bin/sh at
# runtime from the container ENV — the check still works if the port is overridden
# with -e DASH_PORT=xxxx at docker run. EXPOSE below is documentation only.
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -fsS "http://localhost:${DASH_PORT}/" >/dev/null || exit 1

# ── Entrypoint ────────────────────────────────────────────────────────────────
ENTRYPOINT ["python3.12", "docker_entrypoint.py"]
