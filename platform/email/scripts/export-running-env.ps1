$ErrorActionPreference = 'Stop'

function Get-ContainerEnvironment([string]$ContainerName) {
    $inspection = docker inspect $ContainerName | ConvertFrom-Json | Select-Object -First 1
    if (-not $inspection) { throw "Container not found: $ContainerName" }

    $values = @{}
    foreach ($entry in $inspection.Config.Env) {
        $parts = $entry -split '=', 2
        $values[$parts[0]] = if ($parts.Count -gt 1) { $parts[1] } else { '' }
    }
    return $values
}

$api = Get-ContainerEnvironment 'seemplify-mail-mail-api-1'
$database = Get-ContainerEnvironment 'seemplify-mail-mariadb-1'
$relay = Get-ContainerEnvironment 'seemplify-mail-postfix-relay-1'

$output = [ordered]@{
    MAIL_API_ADDRESS_HASH_SALT = $api.MAIL_API_ADDRESS_HASH_SALT
    MAIL_API_BOUNCE_DOMAIN = $api.MAIL_API_BOUNCE_DOMAIN
    MAIL_API_DOMAIN = $api.MAIL_API_DOMAIN
    MAIL_API_ALLOWED_DOMAINS = $api.MAIL_API_ALLOWED_DOMAINS
    MAIL_API_KEYS = $api.MAIL_API_KEYS
    MAIL_API_POSTAL_API_KEY = $api.MAIL_API_POSTAL_API_KEY
    MAIL_API_POSTAL_WEBHOOK_TOKEN = $api.MAIL_API_POSTAL_WEBHOOK_TOKEN
    MAIL_API_WEBHOOK_HMAC_SECRET = $api.MAIL_API_WEBHOOK_HMAC_SECRET
    MARIADB_DATABASE = $database.MARIADB_DATABASE
    MARIADB_PASSWORD = $database.MARIADB_PASSWORD
    MARIADB_ROOT_PASSWORD = $database.MARIADB_ROOT_PASSWORD
    MARIADB_USER = $database.MARIADB_USER
    RELAY_UPSTREAM_HOST = 'smtp.gmail.com'
    RELAY_UPSTREAM_PORT = '587'
    RELAY_SMTP_USERNAME = $relay.RELAY_SMTP_USERNAME
    RELAY_PASSWORD_PATH = 'C:/Seemplify/mail/secrets/relay_smtp_password'
    RELAY_ALLOWED_NETWORKS = '172.31.240.0/24'
    RELAY_SENDER_DOMAIN = 'dewinsight.com'
}

$target = Join-Path $PSScriptRoot '..\.env.runtime'
$lines = foreach ($item in $output.GetEnumerator()) {
    if ([string]::IsNullOrWhiteSpace([string]$item.Value)) {
        throw "Refusing to export an empty required setting: $($item.Key)"
    }
    if ([string]$item.Value -match "[`r`n]") {
        throw "Refusing to export a multiline setting: $($item.Key)"
    }
    '{0}={1}' -f $item.Key, $item.Value
}
[System.IO.File]::WriteAllLines($target, $lines, [System.Text.UTF8Encoding]::new($false))
Write-Host "Exported the running mail settings to the ignored file $target. No values were printed."
