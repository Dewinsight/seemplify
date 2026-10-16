#!/usr/bin/env bash
set -euo pipefail
umask 077
release_root=${1:?immutable release root required}
layout=/opt/seemplify/build/lms-base-e703fe9
context=/opt/seemplify/build/lms-recovery/frappe_docker
exec 9>/var/lock/seemplify-lms-base.lock
flock -x 9
if [[ ! -f "$layout/index.json" ]]; then
  if [[ ! -d "$context/.git" ]]; then
    install -d -m 700 "$(dirname "$context")"
    git clone --filter=blob:none --no-checkout https://github.com/frappe/frappe_docker.git "$context"
  fi
  git -C "$context" checkout --detach 3d0a0e53d8ab03903f6c3f125976a37d7a0f9875
  python3 "$release_root/deploy/hostinger/prepare-lms-base.py" "$context"
  temporary=$(mktemp -d /opt/seemplify/build/lms-base-e703fe9.tmp.XXXXXXXX)
  cleanup() {
    case "$temporary" in /opt/seemplify/build/lms-base-e703fe9.tmp.*) rm -rf -- "$temporary" ;; esac
  }
  trap cleanup EXIT
  # A containerized builder cannot resolve private images from the host engine.
  # Export the pinned upstream build as an OCI context for the subsequent image.
  docker buildx build --provenance=false \
    --build-arg PYTHON_VERSION=3.14 --build-arg NODE_VERSION=24 \
    --build-arg FRAPPE_PATH=file:///tmp/frappe-source --build-arg FRAPPE_BRANCH=lms-restoration \
    --build-arg INSTALL_CHROMIUM=false \
    --output "type=oci,dest=$temporary,tar=false" \
    -f "$context/Containerfile.lms" "$context"
  test -f "$temporary/index.json"
  test ! -e "$layout"
  mv "$temporary" "$layout"
  trap - EXIT
fi
python3 - "$layout" <<'PY'
from pathlib import Path
import hashlib,json,sys
root=Path(sys.argv[1]);index=json.loads((root/'index.json').read_text())
assert len(index['manifests'])==1
digest=index['manifests'][0]['digest'];assert digest.startswith('sha256:')
blob=root/'blobs/sha256'/digest.split(':',1)[1]
assert hashlib.sha256(blob.read_bytes()).hexdigest()==digest.split(':',1)[1]
print('Pinned LMS OCI base manifest verified: '+digest)
PY
