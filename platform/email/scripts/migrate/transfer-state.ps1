#Requires -Version 5.1
<#
.SYNOPSIS
Transfers a verified snapshot to the Dokploy host and, optionally, restores it
into the production volumes.

.DESCRIPTION
The snapshot is verified here before it leaves, and verified again on the far
side with the host's own `sha256sum -c` against the SHA256SUMS file that
travelled with it. A transfer that corrupts a byte fails at the second check
rather than becoming a silently damaged production database.

The remote working directory is created with mode 0700 under a fixed root, and
the restore script is copied from this repository each time rather than trusted
to already be there, so the code that touches production volumes is always the
reviewed version.

Restoring is opt-in via -Restore. Transferring alone changes nothing.

.EXAMPLE
    .\transfer-state.ps1 -RemoteHost 4.180.153.209 -KeyPath ..\..\..\..\.local-runtime\mail-migration\keys\migration_ed25519
    .\transfer-state.ps1 -RemoteHost 4.180.153.209 -KeyPath <key> -Restore
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $RemoteHost,
    [Parameter(Mandatory)][string] $KeyPath,
    [string] $RemoteUser = 'root',
    [int]    $RemotePort = 22,
    [string] $SnapshotPath,
    [string] $RemoteRoot = '/opt/seemplify-mail-migration',
    # Restore into the production volumes after the remote checksum pass.
    [switch] $Restore,
    # Allow the restore to overwrite volumes that already hold data.
    [switch] $Force
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SeemplifyMailMigration.psm1') -Force
Assert-MailCommand -Name @('ssh', 'scp')

if (-not $SnapshotPath) {
    $latest = Get-LatestMailSnapshot
    if (-not $latest) { throw 'No snapshot found. Run export-state.ps1 first, or pass -SnapshotPath.' }
    $SnapshotPath = $latest.FullName
}
$SnapshotPath = (Resolve-Path $SnapshotPath).Path
$snapshotName = Split-Path -Leaf $SnapshotPath

Write-MailLog -Level step -Message "Verifying $snapshotName before transfer"
$verification = Test-MailManifest -SnapshotPath $SnapshotPath
if (-not $verification.Ok) {
    throw "Refusing to transfer a snapshot that does not match its manifest: $($verification.Problems -join '; ')"
}
Write-MailLog -Level ok -Message "$($verification.Manifest.files.Count) file(s) match their recorded checksums."

$remote = New-MailRemoteContext -HostName $RemoteHost -UserName $RemoteUser -KeyPath $KeyPath -Port $RemotePort -RemoteRoot $RemoteRoot
Save-MailPhaseRecord -Phase 'transfer' -Outcome 'started' -Detail @{ snapshot = $snapshotName; target = $remote.Target } | Out-Null

Write-MailLog -Level step -Message "Preparing $RemoteRoot on $($remote.Target)"
# Idempotent, and 0700 from the moment it exists: the snapshot holds a full
# database dump and Postal's configuration.
$prepare = @"
set -eu
umask 077
mkdir -p '$RemoteRoot/snapshots' '$RemoteRoot/bin'
chmod 700 '$RemoteRoot' '$RemoteRoot/snapshots' '$RemoteRoot/bin'
rm -rf '$RemoteRoot/snapshots/$snapshotName.partial'
mkdir -p '$RemoteRoot/snapshots/$snapshotName.partial'
printf 'ready\n'
"@
Invoke-MailRemote -Remote $remote -Script $prepare | Out-Null

Write-MailLog -Level step -Message 'Copying snapshot files'
foreach ($file in (Get-ChildItem -Path $SnapshotPath -File)) {
    Copy-MailToRemote -Remote $remote -LocalPath $file.FullName -RemotePath "$RemoteRoot/snapshots/$snapshotName.partial/$($file.Name)" | Out-Null
    Write-MailLog -Level info -Message ("sent {0} ({1:N1} MB)" -f $file.Name, ($file.Length / 1MB))
}

Write-MailLog -Level step -Message 'Copying the restore tooling from this repository'
$linuxScripts = Join-Path $PSScriptRoot '..\linux'
foreach ($name in @('restore-into-volumes.sh', 'queue-inspect.sh', 'remote-readiness.sh', 'export-remote-state.sh')) {
    $source = Join-Path $linuxScripts $name
    if (-not (Test-Path $source)) { throw "Missing $name in platform/email/scripts/linux." }
    Copy-MailToRemote -Remote $remote -LocalPath $source -RemotePath "$RemoteRoot/bin/$name" | Out-Null
}
# scp preserves neither the executable bit nor LF endings from a Windows
# checkout, so normalise both on arrival.
Invoke-MailRemote -Remote $remote -Script @"
set -eu
for f in '$RemoteRoot'/bin/*.sh; do
  sed -i 's/\r`$//' "`$f"
  chmod 0700 "`$f"
done
printf 'tooling installed\n'
"@ | Out-Null

Write-MailLog -Level step -Message "Verifying checksums on $($remote.Target)"
# The host recomputes every digest with its own sha256sum. This is the check
# that a transfer error has to survive, and it cannot be satisfied by a value
# this script carried across.
$verify = @"
set -eu
cd '$RemoteRoot/snapshots/$snapshotName.partial'
sha256sum -c SHA256SUMS
"@
$remoteVerify = Invoke-MailRemote -Remote $remote -Script $verify -AllowFailure
if ($remoteVerify.ExitCode -ne 0) {
    Save-MailPhaseRecord -Phase 'transfer' -Outcome 'failed' -Detail @{ reason = 'remote-checksum-mismatch' } | Out-Null
    throw "Remote checksum verification failed. The partial directory was left in place for inspection.`n$($remoteVerify.Output)"
}
Write-MailLog -Level ok -Message 'Every file matches its checksum on the Dokploy host.'

# Only now does the snapshot get its real name. A directory without `.partial`
# is one that arrived complete and verified.
Invoke-MailRemote -Remote $remote -Script @"
set -eu
rm -rf '$RemoteRoot/snapshots/$snapshotName'
mv '$RemoteRoot/snapshots/$snapshotName.partial' '$RemoteRoot/snapshots/$snapshotName'
printf 'committed\n'
"@ | Out-Null

Save-MailPhaseRecord -Phase 'transfer' -Outcome 'completed' -Detail @{
    snapshot   = $snapshotName
    remotePath = "$RemoteRoot/snapshots/$snapshotName"
} | Out-Null
Write-MailLog -Level ok -Message "Snapshot available at $RemoteRoot/snapshots/$snapshotName"

if (-not $Restore) {
    Write-Host ''
    Write-MailLog -Level info -Message 'Transfer only. To restore into the production volumes, re-run with -Restore, or on the host:'
    Write-MailLog -Level info -Message "  $RemoteRoot/bin/restore-into-volumes.sh --snapshot $RemoteRoot/snapshots/$snapshotName"
    exit 0
}

Write-MailLog -Level step -Message 'Restoring into the production volumes'
Save-MailPhaseRecord -Phase 'restore' -Outcome 'started' -Detail @{ snapshot = $snapshotName } | Out-Null
$forceFlag = ''
if ($Force) { $forceFlag = ' --force' }
$restore = Invoke-MailRemote -Remote $remote -Script "'$RemoteRoot/bin/restore-into-volumes.sh' --snapshot '$RemoteRoot/snapshots/$snapshotName'$forceFlag" -AllowFailure
Write-Host $restore.Output
if ($restore.ExitCode -ne 0) {
    Save-MailPhaseRecord -Phase 'restore' -Outcome 'failed' -Detail @{ snapshot = $snapshotName } | Out-Null
    throw "The remote restore failed. Production volumes were left as the script found them unless it says otherwise above."
}

Save-MailPhaseRecord -Phase 'restore' -Outcome 'completed' -Detail @{ snapshot = $snapshotName } | Out-Null
Write-MailLog -Level ok -Message 'Restore complete.'
Write-MailLog -Level info -Message 'Next: start the staging stack and run the acceptance tests before touching the cutover gates.'
