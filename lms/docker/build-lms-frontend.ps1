# Build LMS frontend inside the running Frappe container.
# Run this if /lms/courses shows "Page not found".
# Requires: docker-frappe-1 (or your frappe container name)

$container = "docker-frappe-1"
Write-Host "Building LMS frontend in $container..."
docker exec $container bash -c "cd /home/frappe/frappe-bench/apps/lms/frontend && yarn install --frozen-lockfile && yarn build"
if ($LASTEXITCODE -eq 0) {
    Write-Host "Done. Restart Frappe: docker restart $container"
} else {
    Write-Host "Build failed. Check container is running: docker ps"
}
