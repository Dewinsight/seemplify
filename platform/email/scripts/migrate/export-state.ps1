#Requires -Version 5.1
<#
.SYNOPSIS
Captures a verifiable snapshot of the local mail stack.

.DESCRIPTION
Produces, into a timestamped snapshot directory:

  * mariadb.sql.gz      every non-system database, dumped in one transaction
  * postal-config.tar.gz  the contents of the postal-config volume
  * mail-api-state.tar.gz the contents of the mail-api-data volume
  * relay-spool.tar.gz    only when the Postfix spool is NOT empty
  * queue-report.json     what the queues held at capture time
  * SHA256SUMS, manifest.json

Nothing is streamed through PowerShell. Each artefact is written inside a
container and pulled out with `docker cp`, so no text encoding or line-ending
conversion can touch a byte of it.

The Postfix spool is deliberately conditional. An empty spool is the normal,
wanted state and is a cutover gate; there is nothing to carry across and
copying an empty spool over a freshly initialised one risks importing stale
Postfix metadata. A non-empty spool is captured because it holds real messages,
and it blocks cutover until it drains.

Run twice: once for the bulk copy, and again after freeze-local.ps1 for the
final sync. Each run writes a new snapshot; nothing is overwritten.

.EXAMPLE
    .\export-state.ps1
    .\export-state.ps1 -Phase final
#>
[CmdletBinding()]
param(
    [ValidateSet('bulk', 'final')][string] $Phase = 'bulk',
    # Refuses to capture while Postal still has queued messages. The final sync
    # must not leave work behind on a stack that is about to be retired.
    [switch] $RequireEmptyPostalQueue
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SeemplifyMailMigration.psm1') -Force
Assert-MailCommand -Name @('docker')

if ($Phase -eq 'final') { $RequireEmptyPostalQueue = $true }

$snapshot = New-MailSnapshotPath -Phase $Phase
Write-MailLog -Level step -Message "Capturing the $Phase snapshot into $snapshot"
Save-MailPhaseRecord -Phase "export-$Phase" -Outcome 'started' -Detail @{ snapshot = $snapshot } | Out-Null

function Export-VolumeArchive {
    <#
    .SYNOPSIS Archives a named volume through a throwaway container.
    .DESCRIPTION No host bind mount is involved, so this behaves identically
    whatever Docker Desktop's file sharing is configured to allow.
    #>
    param(
        [Parameter(Mandatory)][string] $Volume,
        [Parameter(Mandatory)][string] $Destination
    )
    $helper = "seemplify-mail-export-$([guid]::NewGuid().ToString('N').Substring(0, 12))"
    try {
        Invoke-Native -FilePath 'docker' -Arguments @(
            'run', '--name', $helper,
            '--network', 'none',
            '-v', "${Volume}:/src:ro",
            'alpine:3.20',
            'sh', '-c', 'set -e; tar -czf /archive.tar.gz -C /src .'
        ) | Out-Null
        Invoke-Native -FilePath 'docker' -Arguments @('cp', "${helper}:/archive.tar.gz", $Destination) | Out-Null
    } finally {
        Invoke-Native -FilePath 'docker' -Arguments @('rm', '-f', $helper) -AllowFailure | Out-Null
    }
    if (-not (Test-Path $Destination)) { throw "Archive for volume $Volume was not produced." }
    Write-MailLog -Level ok -Message ("{0} -> {1} ({2:N1} MB)" -f $Volume, (Split-Path -Leaf $Destination), ((Get-Item $Destination).Length / 1MB))
}

# ------------------------------------------------------------------ containers
$mariadb = Get-MailContainer -Service 'mariadb'
$relay = Get-MailContainer -Service 'postfix-relay'
Write-MailLog -Level info -Message "MariaDB container: $mariadb"
Write-MailLog -Level info -Message "Relay container:   $relay"

# ----------------------------------------------------------------- queue gates
Write-MailLog -Level step -Message 'Inspecting queues'
$postfix = Get-PostfixQueueReport -Container $relay
$postal = Get-PostalQueueReport -MariadbContainer $mariadb

if ($postfix.IsEmpty) {
    Write-MailLog -Level ok -Message 'Postfix spool is empty. It will not be migrated; this is the wanted state and a cutover gate.'
} else {
    Write-MailLog -Level warn -Message "Postfix spool holds $($postfix.Entries) message(s). The spool WILL be captured, and cutover stays blocked until it drains."
}

if (-not $postal.Available) {
    Write-MailLog -Level warn -Message $postal.Detail
} elseif ($postal.Queued -gt 0) {
    $message = "Postal still has $($postal.Queued) queued message(s)."
    if ($RequireEmptyPostalQueue) {
        Save-MailPhaseRecord -Phase "export-$Phase" -Outcome 'failed' -Detail @{ reason = 'postal-queue-not-empty'; queued = $postal.Queued } | Out-Null
        throw "$message A $Phase capture requires an empty Postal queue: let the worker drain, then re-run."
    }
    Write-MailLog -Level warn -Message $message
} else {
    Write-MailLog -Level ok -Message 'Postal has nothing queued.'
}

$queueReport = [ordered]@{
    capturedAt = (Get-Date).ToUniversalTime().ToString('o')
    postfix    = [ordered]@{ empty = $postfix.IsEmpty; entries = $postfix.Entries; migrated = (-not $postfix.IsEmpty) }
    postal     = [ordered]@{ available = $postal.Available; queued = $postal.Queued; detail = $postal.Detail }
}
($queueReport | ConvertTo-Json -Depth 5) | Set-Content -Path (Join-Path $snapshot 'queue-report.json') -Encoding utf8

# -------------------------------------------------------------------- database
Write-MailLog -Level step -Message 'Dumping MariaDB'
# One connection, one transaction: every Postal database is consistent with
# every other in the resulting file. The password is read from the container's
# own environment, so it never reaches this machine's command line or logs.
$dumpScript = @'
set -eu
databases=$(mariadb --user=root --password="$MARIADB_ROOT_PASSWORD" -N -B \
  -e "SHOW DATABASES" | grep -Ev '^(information_schema|performance_schema|mysql|sys)$')
if [ -z "$databases" ]; then echo "No application databases found." >&2; exit 1; fi
printf 'databases: %s\n' "$(echo $databases | tr '\n' ' ')" >&2
# shellcheck disable=SC2086
mariadb-dump --user=root --password="$MARIADB_ROOT_PASSWORD" \
  --single-transaction --quick --routines --triggers --events --hex-blob \
  --default-character-set=utf8mb4 --databases $databases | gzip -9 > /tmp/mariadb.sql.gz
'@
$dump = Invoke-MailContainerShell -Container $mariadb -Script $dumpScript
Write-MailLog -Level info -Message ($dump.Output.Trim())
Invoke-Native -FilePath 'docker' -Arguments @('cp', "${mariadb}:/tmp/mariadb.sql.gz", (Join-Path $snapshot 'mariadb.sql.gz')) | Out-Null
Invoke-MailContainerShell -Container $mariadb -Script 'rm -f /tmp/mariadb.sql.gz' -AllowFailure | Out-Null

$dumpPath = Join-Path $snapshot 'mariadb.sql.gz'
if (-not (Test-Path $dumpPath) -or (Get-Item $dumpPath).Length -lt 1024) {
    throw 'The MariaDB dump is missing or implausibly small. Refusing to continue with an unusable snapshot.'
}
Write-MailLog -Level ok -Message ("mariadb.sql.gz ({0:N1} MB)" -f ((Get-Item $dumpPath).Length / 1MB))

# -------------------------------------------------------------------- archives
Write-MailLog -Level step -Message 'Archiving Postal configuration and Mail API state'
Export-VolumeArchive -Volume 'seemplify-mail_postal-config' -Destination (Join-Path $snapshot 'postal-config.tar.gz')
Export-VolumeArchive -Volume 'seemplify-mail_mail-api-data' -Destination (Join-Path $snapshot 'mail-api-state.tar.gz')

if (-not $postfix.IsEmpty) {
    Write-MailLog -Level step -Message 'Archiving the non-empty Postfix spool'
    Export-VolumeArchive -Volume 'seemplify-mail_relay-spool' -Destination (Join-Path $snapshot 'relay-spool.tar.gz')
} else {
    Write-MailLog -Level info -Message 'Skipping the Postfix spool: it is empty, so there is nothing to carry across.'
}

# -------------------------------------------------------------------- manifest
Write-MailLog -Level step -Message 'Writing SHA-256 manifest'
New-MailManifest -SnapshotPath $snapshot -Phase $Phase -Extra @{
    postfixSpoolMigrated = (-not $postfix.IsEmpty)
    postalQueued         = $postal.Queued
    sourceContainers     = @{ mariadb = $mariadb; relay = $relay }
} | Out-Null

$verification = Test-MailManifest -SnapshotPath $snapshot
if (-not $verification.Ok) {
    Save-MailPhaseRecord -Phase "export-$Phase" -Outcome 'failed' -Detail @{ problems = $verification.Problems } | Out-Null
    throw "The snapshot failed its own checksum verification: $($verification.Problems -join '; ')"
}

Save-MailPhaseRecord -Phase "export-$Phase" -Outcome 'completed' -Detail @{
    snapshot             = $snapshot
    files                = @($verification.Manifest.files | ForEach-Object { $_.name })
    postfixSpoolMigrated = (-not $postfix.IsEmpty)
    postalQueued         = $postal.Queued
} | Out-Null

Write-Host ''
Write-MailLog -Level ok -Message "Snapshot complete and self-verified: $snapshot"
Write-MailLog -Level info -Message 'Next: transfer-state.ps1 -SnapshotPath "<path>" -RemoteHost <host> -KeyPath <key>'
