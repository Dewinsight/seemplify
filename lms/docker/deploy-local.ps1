# Deploy local LMS code to running Docker
# Run from repo root or lms/docker
# Requires: docker-frappe-1 container running

$ErrorActionPreference = "Stop"
# Run from lms/docker: .. is lms. Run from repo root: lms is lms.
$lms = if (Test-Path "lms/frontend") { "lms" } elseif (Test-Path "../frontend") { ".." } else { throw "Run from lms/docker or repo root" }
$container = "docker-frappe-1"

Write-Host "Deploying LMS to local Docker ($container)..." -ForegroundColor Cyan

# Copy changed files (faster than full sync)
docker cp "$lms/frontend/src/stores/session.js" "${container}:/home/frappe/frappe-bench/apps/lms/frontend/src/stores/session.js"
docker cp "$lms/frontend/src/index.css" "${container}:/home/frappe/frappe-bench/apps/lms/frontend/src/index.css"
docker cp "$lms/frontend/src/styles/ui-v2-vars.css" "${container}:/home/frappe/frappe-bench/apps/lms/frontend/src/styles/ui-v2-vars.css"
docker cp "$lms/frontend/src/styles/ui-v2-layout.css" "${container}:/home/frappe/frappe-bench/apps/lms/frontend/src/styles/ui-v2-layout.css"
docker cp "$lms/www/lms-login.html" "${container}:/home/frappe/frappe-bench/apps/lms/www/lms-login.html"
docker cp "$lms/www/lms_login.py" "${container}:/home/frappe/frappe-bench/apps/lms/www/lms_login.py"
docker cp "$lms/lms/www/lms-login.html" "${container}:/home/frappe/frappe-bench/apps/lms/lms/www/lms-login.html"
docker cp "$lms/lms/www/lms_login.py" "${container}:/home/frappe/frappe-bench/apps/lms/lms/www/lms_login.py"
docker cp "$lms/lms/website.py" "${container}:/home/frappe/frappe-bench/apps/lms/lms/website.py"
docker cp "$lms/lms/hooks.py" "${container}:/home/frappe/frappe-bench/apps/lms/lms/hooks.py"
docker cp "$lms/lms/lms/user.py" "${container}:/home/frappe/frappe-bench/apps/lms/lms/lms/user.py"
docker cp "$lms/docker/setup-brevo-email.sh" "${container}:/home/frappe/frappe-bench/apps/lms/docker/setup-brevo-email.sh"
docker exec $container mkdir -p /home/frappe/frappe-bench/apps/lms/lms/docker
docker cp "$lms/lms/docker/__init__.py" "${container}:/home/frappe/frappe-bench/apps/lms/lms/docker/__init__.py"
docker cp "$lms/lms/docker/setup_email_account.py" "${container}:/home/frappe/frappe-bench/apps/lms/lms/docker/setup_email_account.py"

# Rebuild frontend and clear cache
docker exec $container bash -c "cd /home/frappe/frappe-bench && bench build --app lms && bench --site localhost clear-cache"

# Pass optional Brevo env vars from current shell into container.
$emailEnvKeys = @(
    "BREVO_SMTP_KEY",
    "BREVO_SMTP_LOGIN",
    "BREVO_API_KEY",
    "BREVO_FROM_EMAIL",
    "SENDER_EMAIL",
    "SENDER_NAME",
    "SMTP_LOGIN",
    "SMTP_PASS",
    "FROM_EMAIL"
)
$dockerEnvArgs = @()
$setEmailKeys = @()
foreach ($key in $emailEnvKeys) {
    $value = [Environment]::GetEnvironmentVariable($key)
    if (-not [string]::IsNullOrWhiteSpace($value)) {
        $dockerEnvArgs += "-e"
        $dockerEnvArgs += "$key=$value"
        $setEmailKeys += $key
    }
}
if ($setEmailKeys.Count -gt 0) {
    Write-Host "Passing email env vars to Docker: $($setEmailKeys -join ', ')" -ForegroundColor DarkCyan
}

# Ensure outgoing email is configured for signup, reset password, and email login link.
& docker exec @dockerEnvArgs $container bash -c "chmod +x /home/frappe/frappe-bench/apps/lms/docker/setup-brevo-email.sh || true; if [ -f /home/frappe/frappe-bench/apps/lms/docker/setup-brevo-email.sh ]; then bash /home/frappe/frappe-bench/apps/lms/docker/setup-brevo-email.sh /workspace-idp-env localhost || true; fi"

if ($LASTEXITCODE -eq 0) {
    Write-Host "Deploy complete. Refresh http://localhost:8000 (Ctrl+Shift+R for hard refresh)" -ForegroundColor Green
} else {
    Write-Host "Deploy failed." -ForegroundColor Red
    exit 1
}
