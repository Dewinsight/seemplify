#Requires -Version 5.1
<#
.SYNOPSIS
Creates a dedicated, temporary SSH key for this migration and prints the exact
line to install on the Dokploy host.

.DESCRIPTION
The migration gets its own key rather than borrowing an existing administrative
one, for three reasons: it can be revoked the moment the soak completes without
disturbing anything else, it can be restricted to the migration's own commands,
and its use is distinguishable in the host's auth log.

This script does not install the key. Installing it requires access to the
Dokploy host, which is an operator action performed deliberately and outside
this repository. The script prints the exact `authorized_keys` line to add.

The private key is written under `.local-runtime`, which the repository
ignores, with an ACL that grants the current user alone. Nothing here prints
the private key.

.EXAMPLE
    .\new-migration-key.ps1 -AllowedFrom 102.89.0.0/16
#>
[CmdletBinding()]
param(
    # Optional source restriction for the authorized_keys line. A residential
    # connection with a changing address may not have a usable value; leaving it
    # empty produces a line without a from= clause and says so.
    [string] $AllowedFrom,
    [string] $KeyPath,
    [switch] $Force
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SeemplifyMailMigration.psm1') -Force

Assert-MailCommand -Name @('ssh-keygen')

if (-not $KeyPath) {
    $KeyPath = Join-Path (Get-MailMigrationRoot) 'keys\migration_ed25519'
}
$keyDirectory = Split-Path -Parent $KeyPath
New-Item -ItemType Directory -Path $keyDirectory -Force | Out-Null

if ((Test-Path $KeyPath) -and -not $Force) {
    Write-MailLog -Level warn -Message "A migration key already exists at $KeyPath. Re-run with -Force to replace it, or keep using this one."
    if (Test-Path "$KeyPath.pub") {
        Write-Host ''
        Write-MailLog -Level info -Message 'Existing public key:'
        Write-Host (Get-Content -Path "$KeyPath.pub" -Raw).Trim()
    }
    exit 0
}

if (Test-Path $KeyPath) {
    Remove-Item -Path $KeyPath -Force
    if (Test-Path "$KeyPath.pub") { Remove-Item -Path "$KeyPath.pub" -Force }
}

$comment = "seemplify-mail-migration-$((Get-Date).ToUniversalTime().ToString('yyyyMMdd'))"
Write-MailLog -Level step -Message "Generating an ed25519 key pair for this migration ($comment)."
# -N '' leaves the key unencrypted because every phase runs unattended over
# BatchMode ssh. That is acceptable only because the key is single-purpose,
# short-lived and removed by cleanup.ps1; it is not a general-access key.
# Windows PowerShell 5 drops a literal empty native argument. The quoted-empty
# token below reaches OpenSSH as an empty passphrase on both Windows PowerShell
# and PowerShell 7.
Invoke-Native -FilePath 'ssh-keygen' -Arguments @('-t', 'ed25519', '-f', $KeyPath, '-N', '""', '-C', $comment, '-q') | Out-Null

if (-not (Test-Path $KeyPath) -or -not (Test-Path "$KeyPath.pub")) {
    throw 'ssh-keygen reported success but the key pair is not on disk.'
}

# OpenSSH on Windows refuses a private key that other principals can read.
Write-MailLog -Level step -Message 'Restricting the private key to the current user.'
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
Invoke-Native -FilePath 'icacls' -Arguments @($KeyPath, '/inheritance:r') | Out-Null
Invoke-Native -FilePath 'icacls' -Arguments @($KeyPath, '/grant:r', "${account}:(R)") | Out-Null

$publicKey = (Get-Content -Path "$KeyPath.pub" -Raw).Trim()

# `restrict` turns off port forwarding, agent forwarding, X11 and pty
# allocation, and then the migration's own needs are added back. scp and the
# non-interactive ssh commands this migration runs need none of what was
# removed.
$options = 'restrict'
if ($AllowedFrom) { $options = "from=""$AllowedFrom"",$options" }
$authorizedLine = "$options $publicKey"

$linePath = Join-Path $keyDirectory 'authorized_keys.line'
[System.IO.File]::WriteAllText($linePath, "$authorizedLine`n", (New-Object System.Text.UTF8Encoding($false)))

Save-MailPhaseRecord -Phase 'migration-key' -Outcome 'completed' -Detail @{
    keyPath     = $KeyPath
    fingerprint = (Invoke-Native -FilePath 'ssh-keygen' -Arguments @('-lf', "$KeyPath.pub")).Output
    restricted  = [bool]$AllowedFrom
} | Out-Null

Write-Host ''
Write-MailLog -Level ok -Message "Private key: $KeyPath (never printed, never committed)"
Write-MailLog -Level ok -Message "Install line written to: $linePath"
if (-not $AllowedFrom) {
    Write-MailLog -Level warn -Message 'No -AllowedFrom was given, so the key is not restricted by source address. Prefer passing one where the outbound address is stable.'
}

Write-Host ''
Write-Host 'Install on the Dokploy host, as the account the migration will use:' -ForegroundColor Cyan
Write-Host ''
Write-Host '  umask 077 && mkdir -p ~/.ssh' -ForegroundColor White
Write-Host "  cat >> ~/.ssh/authorized_keys <<'EOF'" -ForegroundColor White
Write-Host "  $authorizedLine" -ForegroundColor White
Write-Host '  EOF' -ForegroundColor White
Write-Host ''
Write-Host 'Then record the host key on this machine so StrictHostKeyChecking can stay on:' -ForegroundColor Cyan
Write-Host '  ssh-keyscan -H <dokploy-host> >> $env:USERPROFILE\.ssh\known_hosts' -ForegroundColor White
Write-Host ''
Write-Host 'Verify the fingerprint against the host console before trusting it.' -ForegroundColor Yellow
Write-Host 'cleanup.ps1 removes this key pair, and you remove the authorized_keys line, once the soak has passed.' -ForegroundColor Yellow
