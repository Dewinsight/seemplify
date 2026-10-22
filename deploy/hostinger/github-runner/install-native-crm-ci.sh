#!/usr/bin/env bash
# Install isolated native CI alongside the existing production Docker daemon.
# Run as root after reviewing this file; no registration token is accepted here.
set -euo pipefail
[[ $(id -u) == 0 ]]
root=/opt/hostinger-native-ci
tools=/opt/hostinger-native-tools/29.1.3
install -d -m 0755 "$root" "$tools" /var/lib/hostinger-actions
getent group hostinger-compute >/dev/null || groupadd --system hostinger-compute
touch /run/lock/hostinger-ci-compute.lock
chown root:hostinger-compute /run/lock/hostinger-ci-compute.lock
chmod 0660 /run/lock/hostinger-ci-compute.lock
cat >/etc/tmpfiles.d/hostinger-ci-compute.conf <<'EOF'
f /run/lock/hostinger-ci-compute.lock 0660 root hostinger-compute -
EOF
cat >/etc/systemd/system/hostinger-native-ci.slice <<'EOF'
[Unit]
Description=Bounded native CRM CI and isolated rootless Docker engines
[Slice]
CPUQuota=200%
MemoryHigh=6G
MemoryMax=7G
MemorySwapMax=0
TasksMax=4096
EOF

# This matches the installed production Docker client/daemon, without replacing
# them or restarting Docker/Swarm. Verify the downloaded extras archive first.
echo '32dc3dd0d8b512ccf30a7efe84d360b5ade65ac4fec92a2a5ad0fe791da6ab0d  '"$tools/rootless-extras.tgz" | sha256sum -c -
tar xzf "$tools/rootless-extras.tgz" -C "$tools" --strip-components=1 \
  docker-rootless-extras/dockerd-rootless.sh docker-rootless-extras/dockerd-rootless-setuptool.sh
echo 'c019c608ba2bb009dd673f3230e4d743f36a78d36166c6c2444c05d0aa9ff0d9  '"$tools/docker.tgz" | sha256sum -c -
tar xzf "$tools/docker.tgz" -C "$tools" --strip-components=1
# Keep Docker/containerd/runc versions aligned, but use the distribution's
# AppArmor-confined RootlessKit rather than disabling user-namespace policy.
ln -sf /usr/bin/rootlesskit "$tools/rootlesskit"
chmod 0755 "$root/native-ci-hook.py"

for role in backend frontend; do
  account="crm-ci-$role"
  home="/var/lib/hostinger-actions/$role"
  id "$account" >/dev/null 2>&1 || useradd --create-home --home-dir "$home" --shell /usr/sbin/nologin "$account"
  usermod -a -G hostinger-compute "$account"
  [[ $(id -nG "$account") != *docker* ]]
  chmod 0700 "$home"
  uid=$(id -u "$account")
  grep -q "^$account:" /etc/subuid
  grep -q "^$account:" /etc/subgid
  install -d -m 0700 -o "$account" -g "$account" "$home/.config/systemd/user" "$home/.config/docker" "$home/_work" "$home/_work/_tool"
  cat >"$home/.config/docker/daemon.json" <<'EOF'
{"builder":{"gc":{"enabled":true,"defaultKeepStorage":"4GB"}},"log-driver":"local","log-opts":{"max-size":"10m","max-file":"2"},"exec-opts":["native.cgroupdriver=cgroupfs"]}
EOF
  cat >"$home/.config/systemd/user/docker.service" <<EOF
[Unit]
Description=Isolated rootless Docker for CRM $role CI
[Service]
Environment=PATH=$tools:/usr/bin:/usr/sbin:/bin
Environment=XDG_RUNTIME_DIR=/run/user/$uid
Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$uid/bus
Environment=DOCKERD_ROOTLESS_ROOTLESSKIT=/usr/bin/rootlesskit
ExecStart=$tools/dockerd-rootless.sh --host=unix:///run/user/$uid/docker.sock
Restart=on-failure
RestartSec=5
TimeoutStartSec=120
Delegate=yes
KillMode=mixed
MemoryMax=4G
MemorySwapMax=0
TasksMax=3072
[Install]
WantedBy=default.target
EOF
  chown -R "$account:$account" "$home/.config"
  install -d "/etc/systemd/system/user@$uid.service.d"
  cat >"/etc/systemd/system/user@$uid.service.d/hostinger-ci.conf" <<'EOF'
[Service]
Slice=hostinger-native-ci.slice
EOF
  loginctl enable-linger "$account"
  systemctl daemon-reload
  systemctl start "user@$uid.service"
  runuser -u "$account" -- env XDG_RUNTIME_DIR="/run/user/$uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" systemctl --user daemon-reload
  runuser -u "$account" -- env XDG_RUNTIME_DIR="/run/user/$uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" systemctl --user enable --now docker.service
  cat >"/etc/systemd/system/hostinger-crm-ci-$role.service" <<EOF
[Unit]
Description=Native GitHub CRM $role CI runner
After=network-online.target user@$uid.service
Wants=network-online.target user@$uid.service
[Service]
User=$account
Group=$account
SupplementaryGroups=hostinger-compute
WorkingDirectory=$home/runner
Environment=HOME=$home
Environment=PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin
Environment=XDG_RUNTIME_DIR=/run/user/$uid
Environment=DOCKER_HOST=unix:///run/user/$uid/docker.sock
Environment=RUNNER_TOOL_CACHE=$home/_work/_tool
Environment=AGENT_TOOLSDIRECTORY=$home/_work/_tool
Environment=ACTIONS_RUNNER_HOOK_JOB_STARTED=$root/job-started.sh
Environment=ACTIONS_RUNNER_HOOK_JOB_COMPLETED=$root/job-completed.sh
ExecStartPre=/usr/bin/python3 $root/native-ci-hook.py cleanup
ExecStart=$home/runner/run.sh
Restart=on-failure
RestartSec=10
Slice=hostinger-native-ci.slice
MemoryMax=4G
MemorySwapMax=0
CPUQuota=200%
TasksMax=3072
UMask=0077
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=read-only
InaccessiblePaths=/root /home /var/lib/docker /etc/hostinger-ci
ReadWritePaths=$home /run/user/$uid /run/lock/hostinger-ci-compute.lock /tmp /var/tmp
[Install]
WantedBy=multi-user.target
EOF
done
printf '#!/usr/bin/env bash\nset -euo pipefail\nexec /usr/bin/python3 %s/native-ci-hook.py acquire\n' "$root" >"$root/job-started.sh"
printf '#!/usr/bin/env bash\nset -euo pipefail\nexec /usr/bin/python3 %s/native-ci-hook.py cleanup\n' "$root" >"$root/job-completed.sh"
chmod 0755 "$root"/job-*.sh
systemctl daemon-reload
printf 'Native rootless engines provisioned. Register each repository runner before starting its service.\n'
