#!/bin/bash
# Post-deploy sync for Dokploy/GitHub Actions deployments.
# Usage: docker exec <frappe_container> bash /workspace/post-deploy-sync.sh [site_name] [app_source_path]
#
# Why this exists:
# - bench init copies the app source into bench/apps once.
# - In Dokploy, code is typically updated on the host and bind-mounted into the container.
# - Without syncing, the running bench copy can become stale (e.g. /lms 404 when lms.html isn't generated).

set -euo pipefail

SITE_NAME_VALUE="${1:-${LMS_SITE_NAME:-${LMS_HOSTNAME:-lms.seemplifyai.com}}}"
APP_SOURCE_PATH="${2:-${LMS_APP_SOURCE_PATH:-/lms-app}}"
BENCH_DIR="/home/frappe/frappe-bench"
APP_DEST="${BENCH_DIR}/apps/lms"
STATE_DIR="${BENCH_DIR}/sites/${SITE_NAME_VALUE}/.deploy-state"
STATE_FILE="${STATE_DIR}/lms_app_source.sig"
LMS_HTML_PATH="${APP_DEST}/lms/www/lms.html"

export PATH="/home/frappe/.pyenv/shims:/home/frappe/.pyenv/bin:/home/frappe/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

select_node() {
  for node_dir in \
    /home/frappe/.nvm/versions/node/v24*/bin \
    /home/frappe/.nvm/versions/node/*/bin \
    /home/frappe/.nvm/versions/node/v24.12.0/bin \
    /home/frappe/.nvm/versions/node/v22.17.0/bin \
    /home/frappe/.nvm/versions/node/v20.19.0/bin \
    /home/frappe/.nvm/versions/node/v18.20.2/bin \
    /home/frappe/.nvm/versions/node/v16.20.2/bin; do
    if [ -x "${node_dir}/node" ]; then
      export PATH="${node_dir}:${PATH}"
      return 0
    fi
  done
  return 1
}

calc_source_signature() {
  # Fast-ish signature based on file paths, sizes, and mtimes (not file contents).
  # Excludes large/cache directories like node_modules/dist/.git.
  APP_SOURCE_PATH="${APP_SOURCE_PATH}" python3 - <<'PY'
import hashlib
import os
import pathlib

root = pathlib.Path(os.environ["APP_SOURCE_PATH"]).resolve()
include_roots = ["lms", "www", "docker", "scripts", "frontend"]
include_files = {
    "README.md", "MANIFEST.in", "license.txt", "setup.py", "pyproject.toml",
    "package.json", "yarn.lock",
}
include_ext = {
    ".py", ".html", ".js", ".ts", ".vue", ".json", ".yml", ".yaml", ".toml",
    ".css", ".scss", ".md", ".txt", ".sh", ".ps1", ".sql",
}
exclude_dirs = {
    "node_modules", ".git", "__pycache__", "dist", ".vite", ".cache", ".venv", ".yarn",
}

h = hashlib.sha256()

def add(line: str) -> None:
    h.update(line.encode("utf-8", errors="ignore"))
    h.update(b"\n")

for name in sorted(include_files):
    p = root / name
    if p.is_file():
        st = p.stat()
        add(f"{p.relative_to(root)}|{st.st_size}|{int(st.st_mtime)}")

for base in include_roots:
    base_path = root / base
    if not base_path.exists():
        continue
    for dirpath, dirnames, filenames in os.walk(base_path):
        dirnames[:] = [d for d in dirnames if d not in exclude_dirs]
        for fn in filenames:
            p = pathlib.Path(dirpath) / fn
            if p.name in include_files or p.suffix.lower() in include_ext:
                try:
                    st = p.stat()
                except OSError:
                    continue
                add(f"{p.relative_to(root)}|{st.st_size}|{int(st.st_mtime)}")

print(h.hexdigest())
PY
}

echo "Post-deploy sync starting..."
echo "Site: ${SITE_NAME_VALUE}"
echo "Source: ${APP_SOURCE_PATH}"

if [ ! -d "${APP_SOURCE_PATH}" ]; then
  echo "App source path not found: ${APP_SOURCE_PATH}"
  exit 1
fi

select_node || true

if [ -f "${BENCH_DIR}/sites/apps.txt" ]; then
  sed -i '/^frappelms$/d' "${BENCH_DIR}/sites/apps.txt"
  if ! grep -qxF "lms" "${BENCH_DIR}/sites/apps.txt"; then
    echo "lms" >> "${BENCH_DIR}/sites/apps.txt"
  fi
fi

mkdir -p "${APP_DEST}"

current_sig="$(calc_source_signature || true)"
previous_sig="$(cat "${STATE_FILE}" 2>/dev/null || true)"

code_changed=1
if [ -n "${current_sig}" ] && [ "${current_sig}" = "${previous_sig}" ]; then
  code_changed=0
fi

need_build=0
if [ ! -f "${LMS_HTML_PATH}" ]; then
  need_build=1
fi

if [ "${code_changed}" -eq 0 ] && [ "${need_build}" -eq 0 ]; then
  echo "No LMS code changes detected and lms.html is present; skipping sync/migrate/build."
else
  cd "${BENCH_DIR}"

  if [ "${code_changed}" -eq 1 ]; then
    echo "Syncing LMS code into bench apps..."
    for part in lms www docker scripts frontend; do
      if [ -d "${APP_SOURCE_PATH}/${part}" ]; then
        rm -rf "${APP_DEST:?}/${part}"
        cp -a "${APP_SOURCE_PATH}/${part}" "${APP_DEST}/"
      fi
    done

    for file in README.md MANIFEST.in license.txt setup.py pyproject.toml package.json yarn.lock; do
      if [ -f "${APP_SOURCE_PATH}/${file}" ]; then
        cp -f "${APP_SOURCE_PATH}/${file}" "${APP_DEST}/"
      fi
    done

    # Keep DB schema aligned with currently running Frappe/LMS code.
    bench --site "${SITE_NAME_VALUE}" migrate
  fi

  # Build website assets and regenerate apps/lms/lms/www/lms.html required for /lms route.
  if command -v node >/dev/null 2>&1 && command -v yarn >/dev/null 2>&1; then
    if [ -f "${APP_DEST}/frontend/package.json" ]; then
      (cd "${APP_DEST}/frontend" && yarn install --frozen-lockfile)
    fi
    bench build --app lms
  else
    echo "Skipping bench build: node/yarn not available in PATH"
  fi

  if [ -n "${current_sig}" ]; then
    mkdir -p "${STATE_DIR}" 2>/dev/null || true
    echo "${current_sig}" > "${STATE_FILE}" 2>/dev/null || true
  fi
fi

# Configure SMTP/email account if env vars are set.
if [ -f "${APP_DEST}/docker/setup-brevo-email.sh" ]; then
  bash "${APP_DEST}/docker/setup-brevo-email.sh" /workspace-idp-env "${SITE_NAME_VALUE}" || true
fi

cd "${BENCH_DIR}"
bench --site "${SITE_NAME_VALUE}" clear-cache
bench --site "${SITE_NAME_VALUE}" clear-website-cache

echo "Post-deploy sync complete for ${SITE_NAME_VALUE}"
