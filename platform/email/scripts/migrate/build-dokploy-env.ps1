#Requires -Version 5.1
<#
.SYNOPSIS
Builds an ignored, fail-closed Dokploy environment file from the live local mail configuration.

.DESCRIPTION
The script never prints secret values. It copies the existing database and Mail
API identities verbatim, reads the Google app password from its restricted local
file, and forces every production cutover gate off. The resulting file lives
under .local-runtime (ignored by Git) and is intended only for one-time import
into Dokploy's protected environment editor.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $SourceEnv,

    [string] $OutputPath,

    [string] $RelayAllowedNetworks = '127.0.0.1/32'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
if (-not $OutputPath) {
    $OutputPath = Join-Path $repositoryRoot '.local-runtime\dokploy-mail.env'
}

$sourcePath = (Resolve-Path -LiteralPath $SourceEnv).Path
$values = @{}
foreach ($line in [System.IO.File]::ReadAllLines($sourcePath)) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#') -or -not $trimmed.Contains('=')) { continue }
    $parts = $trimmed.Split('=', 2)
    $key = $parts[0].Trim()
    $value = $parts[1].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$key] = $value
}

$required = @(
    'MARIADB_DATABASE', 'MARIADB_USER', 'MARIADB_PASSWORD', 'MARIADB_ROOT_PASSWORD',
    'MAIL_API_DOMAIN', 'MAIL_API_BOUNCE_DOMAIN', 'MAIL_API_KEYS',
    'MAIL_API_ADDRESS_HASH_SALT', 'MAIL_API_POSTAL_API_KEY',
    'MAIL_API_POSTAL_WEBHOOK_TOKEN', 'MAIL_API_WEBHOOK_HMAC_SECRET',
    'RELAY_UPSTREAM_HOST', 'RELAY_UPSTREAM_PORT', 'RELAY_SMTP_USERNAME',
    'RELAY_SENDER_DOMAIN', 'RELAY_PASSWORD_PATH'
)
foreach ($key in $required) {
    if (-not $values.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($values[$key])) {
        throw "Source environment is missing required setting: $key"
    }
}

$relayPasswordPath = $values['RELAY_PASSWORD_PATH']
if (-not [System.IO.Path]::IsPathRooted($relayPasswordPath)) {
    $relayPasswordPath = Join-Path (Split-Path -Parent $sourcePath) $relayPasswordPath
}
$relayPasswordPath = (Resolve-Path -LiteralPath $relayPasswordPath).Path
$relayPassword = ([System.IO.File]::ReadAllText($relayPasswordPath) -replace '\s+', '')
if ($relayPassword -notmatch '^[A-Za-z]{16}$') {
    throw 'The restricted relay credential is not shaped like a 16-letter Google app password.'
}

$ordered = [ordered]@{
    MAIL_API_REPLICAS              = '0'
    POSTAL_WORKER_REPLICAS         = '0'
    MAIL_TUNNEL_REPLICAS           = '0'
    MARIADB_DATABASE               = $values['MARIADB_DATABASE']
    MARIADB_USER                   = $values['MARIADB_USER']
    MARIADB_PASSWORD               = $values['MARIADB_PASSWORD']
    MARIADB_ROOT_PASSWORD          = $values['MARIADB_ROOT_PASSWORD']
    MAIL_API_RELEASE               = 'dokploy-staging'
    MAIL_API_DOMAIN                = $values['MAIL_API_DOMAIN']
    MAIL_API_BOUNCE_DOMAIN         = $values['MAIL_API_BOUNCE_DOMAIN']
    MAIL_API_SEND_ENABLED          = 'false'
    MAIL_API_KEYS                  = $values['MAIL_API_KEYS']
    MAIL_API_ADDRESS_HASH_SALT     = $values['MAIL_API_ADDRESS_HASH_SALT']
    MAIL_API_POSTAL_API_KEY        = $values['MAIL_API_POSTAL_API_KEY']
    MAIL_API_POSTAL_WEBHOOK_TOKEN  = $values['MAIL_API_POSTAL_WEBHOOK_TOKEN']
    MAIL_API_WEBHOOK_HMAC_SECRET   = $values['MAIL_API_WEBHOOK_HMAC_SECRET']
    MAIL_API_TRUSTED_PROXY_HOPS    = '1'
    RELAY_UPSTREAM_HOST            = $values['RELAY_UPSTREAM_HOST']
    RELAY_UPSTREAM_PORT            = $values['RELAY_UPSTREAM_PORT']
    RELAY_SMTP_USERNAME            = $values['RELAY_SMTP_USERNAME']
    RELAY_SENDER_DOMAIN            = $values['RELAY_SENDER_DOMAIN']
    RELAY_ALLOWED_NETWORKS         = $RelayAllowedNetworks
    RELAY_SMTP_PASSWORD            = $relayPassword
    MAIL_TUNNEL_IMAGE              = 'cloudflare/cloudflared:2026.7.2'
    MAIL_TUNNEL_TOKEN              = ''
    MAIL_TUNNEL_TRANSPORT          = 'auto'
    BACKUP_AGE_RECIPIENT           = ''
    BACKUP_R2_BUCKET               = ''
    BACKUP_R2_ENDPOINT             = ''
    BACKUP_R2_PREFIX               = 'seemplify-mail'
    BACKUP_RETENTION_DAYS          = '14'
    BACKUP_R2_ACCESS_KEY_ID        = ''
    BACKUP_R2_SECRET_ACCESS_KEY    = ''
}

$outputDirectory = Split-Path -Parent $OutputPath
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
$lines = foreach ($entry in $ordered.GetEnumerator()) { '{0}={1}' -f $entry.Key, $entry.Value }
[System.IO.File]::WriteAllLines($OutputPath, $lines, [System.Text.UTF8Encoding]::new($false))

# Restrict inheritance and grant access only to the current user. icacls output
# is suppressed because paths and account names are operational metadata.
if ($env:OS -eq 'Windows_NT') {
    & icacls.exe $OutputPath '/inheritance:r' '/grant:r' "${env:USERNAME}:(R,W)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not restrict the generated environment file ACL.' }
}

Write-Host "Dokploy environment prepared at an ignored local-runtime path; no values were printed."
