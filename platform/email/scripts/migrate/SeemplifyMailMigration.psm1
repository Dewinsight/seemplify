#Requires -Version 5.1
<#
.SYNOPSIS
Shared helpers for the local-to-Dokploy transactional-mail migration.

.DESCRIPTION
Importing this module has no side effects: it defines functions and nothing
else. Every destructive action lives in a phase script under this directory and
requires explicit parameters, so no state can be changed by loading, dot-sourcing
or tab-completing anything here.

Rules every function in this file follows:

  * Targets are resolved, never assumed. A container is located by its Compose
    project and service labels and the caller fails unless exactly one matches,
    so a stale or similarly-named container is never operated on by accident.
  * Credentials are never passed on a command line and never written to a log.
    Where a password is needed it is read inside the target container from the
    environment Compose already gave it.
  * Everything fails closed. `$ErrorActionPreference` is Stop in each phase
    script and native exit codes are checked explicitly.
#>

Set-StrictMode -Version Latest

$script:LocalProject = 'seemplify-mail'
$script:RemoteProject = 'seemplify-mail-prod'
$script:StateVolumes = @('mariadb-data', 'postal-config', 'relay-spool', 'mail-api-data')

function Get-MailRepositoryRoot {
    <#.SYNOPSIS Repository root, derived from this file's location.#>
    return (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
}

function Get-MailMigrationRoot {
    <#
    .SYNOPSIS Working directory for migration material.
    .DESCRIPTION Defaults under .local-runtime, which the repository ignores, so
    a dump or an archive can never be committed by accident.
    #>
    if ($env:SEEMPLIFY_MAIL_MIGRATION_ROOT) { return $env:SEEMPLIFY_MAIL_MIGRATION_ROOT }
    return (Join-Path (Get-MailRepositoryRoot) '.local-runtime\mail-migration')
}

function Write-MailLog {
    param(
        [Parameter(Mandatory)][string] $Message,
        [ValidateSet('info', 'ok', 'warn', 'fail', 'step')][string] $Level = 'info'
    )
    $colours = @{ info = 'Gray'; ok = 'Green'; warn = 'Yellow'; fail = 'Red'; step = 'Cyan' }
    $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    Write-Host ("[{0}] {1,-4} {2}" -f $stamp, $Level.ToUpper(), $Message) -ForegroundColor $colours[$Level]
}

function Assert-MailCommand {
    <#.SYNOPSIS Fails closed when a required external tool is absent.#>
    param([Parameter(Mandatory)][string[]] $Name)
    $missing = @()
    foreach ($command in $Name) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { $missing += $command }
    }
    if ($missing.Count -gt 0) {
        throw "Required command(s) not available on PATH: $($missing -join ', ')."
    }
}

function Invoke-Native {
    <#
    .SYNOPSIS Runs a native command and throws unless it exits 0.
    .DESCRIPTION Arguments are passed as an array so no value is ever
    re-parsed by a shell. Output is returned, not printed, so a caller decides
    what is safe to show.
    #>
    param(
        [Parameter(Mandatory)][string] $FilePath,
        [Parameter(Mandatory)][AllowEmptyString()][string[]] $Arguments,
        [switch] $AllowFailure
    )
    $output = & $FilePath @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    $text = ($output | Out-String).TrimEnd()
    if ($exitCode -ne 0 -and -not $AllowFailure) {
        throw "$FilePath exited with code ${exitCode}: $text"
    }
    return [pscustomobject]@{ ExitCode = $exitCode; Output = $text }
}

function Get-MailContainer {
    <#
    .SYNOPSIS Resolves the single running container for a Compose service.
    .DESCRIPTION Throws when zero or more than one container matches, so no
    phase can operate on a container it did not mean to.
    #>
    param(
        [Parameter(Mandatory)][string] $Service,
        [string] $Project = $script:LocalProject,
        [switch] $AllowMissing
    )
    $result = Invoke-Native -FilePath 'docker' -Arguments @(
        'ps', '--all',
        '--filter', "label=com.docker.compose.project=$Project",
        '--filter', "label=com.docker.compose.service=$Service",
        '--format', '{{.Names}}'
    )
    $names = @($result.Output -split "`r?`n" | Where-Object { $_.Trim() })
    if ($names.Count -eq 0) {
        if ($AllowMissing) { return $null }
        throw "No container found for Compose service '$Service' in project '$Project'."
    }
    if ($names.Count -gt 1) {
        throw "Expected exactly one container for '$Project/$Service' but found $($names.Count): $($names -join ', '). Refusing to guess."
    }
    return $names[0].Trim()
}

function Get-MailContainerState {
    param([Parameter(Mandatory)][string] $Container)
    $result = Invoke-Native -FilePath 'docker' -Arguments @(
        'inspect', $Container, '--format', '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}'
    )
    $parts = $result.Output.Trim() -split '\|'
    return [pscustomobject]@{ Status = $parts[0]; Health = $parts[1] }
}

function Invoke-MailContainerShell {
    <#
    .SYNOPSIS Runs a shell snippet inside a container.
    .DESCRIPTION The snippet is executed by the container's own shell, which is
    how a password already present in the container environment can be used
    without ever appearing in a command line on this machine.
    #>
    param(
        [Parameter(Mandatory)][string] $Container,
        [Parameter(Mandatory)][string] $Script,
        [switch] $AllowFailure
    )
    # Do not embed the program in a `sh -c` native argument: Windows PowerShell
    # 5 strips nested quotes and can silently turn `SHOW DATABASES` into `SHOW`.
    # Its redirected StandardInput also prepends a BOM. Copy a no-BOM temporary
    # program instead; this preserves every quote and still keeps container-side
    # credential expansion out of the host process command line.
    if ($Container -notmatch '^[A-Za-z0-9_.-]+$') {
        throw "Unsafe container name: $Container"
    }
    $name = 'seemplify-mail-{0}.sh' -f ([guid]::NewGuid().ToString('N'))
    $local = Join-Path ([System.IO.Path]::GetTempPath()) $name
    $remote = "/tmp/$name"
    try {
        [System.IO.File]::WriteAllText($local, ($Script -replace "`r`n", "`n"), (New-Object System.Text.UTF8Encoding($false)))
        Invoke-Native -FilePath 'docker' -Arguments @('cp', $local, "${Container}:$remote") | Out-Null
        $result = Invoke-Native -FilePath 'docker' -Arguments @('exec', $Container, 'sh', $remote) -AllowFailure
        $exitCode = $result.ExitCode
        $text = $result.Output
    } finally {
        Invoke-Native -FilePath 'docker' -Arguments @('exec', $Container, 'rm', '-f', $remote) -AllowFailure | Out-Null
        if (Test-Path -LiteralPath $local) { Remove-Item -LiteralPath $local -Force }
    }
    if ($exitCode -ne 0 -and -not $AllowFailure) {
        throw "docker exec exited with code ${exitCode}: $text"
    }
    return [pscustomobject]@{ ExitCode = $exitCode; Output = $text }
}

function Get-PostfixQueueReport {
    <#
    .SYNOPSIS Reads the Postfix spool and reports whether it holds anything.
    .DESCRIPTION An empty spool is a cutover gate: messages still sitting in
    Postfix have been accepted from Postal but not yet handed to Google, and
    moving the stack under them would strand them.
    #>
    param([Parameter(Mandatory)][string] $Container)
    $result = Invoke-MailContainerShell -Container $Container -Script 'postqueue -p 2>&1 || true'
    $text = $result.Output.Trim()
    $isEmpty = $text -match 'Mail queue is empty' -or $text -eq ''
    # `postqueue -p` prints one summary line per message; count them rather than
    # trusting the absence of the empty-queue banner.
    $entries = @($text -split "`r?`n" | Where-Object { $_ -match '^[0-9A-F]{5,}[\*!]?\s' }).Count
    return [pscustomobject]@{
        IsEmpty = ($isEmpty -and $entries -eq 0)
        Entries = $entries
        Report  = $text
    }
}

function Get-PostalQueueReport {
    <#
    .SYNOPSIS Counts messages Postal still has queued.
    .DESCRIPTION Postal v3 holds its queue in MariaDB, so this is a SQL count
    rather than a broker probe. The password is read from the container's own
    environment and never crosses this machine's command line.
    #>
    param([Parameter(Mandatory)][string] $MariadbContainer)
    $sql = 'SELECT COUNT(*) FROM queued_messages;'
    $script = @"
set -e
databases=`$(mariadb --user=root --password="`$MARIADB_ROOT_PASSWORD" -N -B -e "SHOW DATABASES" | grep -Ev '^(information_schema|performance_schema|mysql|sys)`$')
total=0
for db in `$databases; do
  count=`$(mariadb --user=root --password="`$MARIADB_ROOT_PASSWORD" -N -B -D "`$db" -e "$sql" 2>/dev/null || echo 0)
  total=`$((total + count))
done
printf '%s\n' "`$total"
"@
    $result = Invoke-MailContainerShell -Container $MariadbContainer -Script $script -AllowFailure
    if ($result.ExitCode -ne 0) {
        return [pscustomobject]@{ Available = $false; Queued = $null; Detail = 'Postal queue depth could not be read.' }
    }
    $lines = @($result.Output -split "`r?`n" | Where-Object { $_.Trim() -match '^\d+$' })
    if ($lines.Count -eq 0) {
        return [pscustomobject]@{ Available = $false; Queued = $null; Detail = 'Postal queue depth could not be parsed.' }
    }
    return [pscustomobject]@{ Available = $true; Queued = [int]$lines[-1].Trim(); Detail = 'Counted across every Postal database.' }
}

function Get-MailFileHash {
    param([Parameter(Mandatory)][string] $Path)
    return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function New-MailManifest {
    <#
    .SYNOPSIS Writes manifest.json and SHA256SUMS for a snapshot directory.
    .DESCRIPTION SHA256SUMS is written in the format `sha256sum -c` expects, so
    the Linux side verifies with its own tool rather than trusting a number this
    script transferred alongside the data.
    #>
    param(
        [Parameter(Mandatory)][string] $SnapshotPath,
        [Parameter(Mandatory)][string] $Phase,
        [hashtable] $Extra = @{}
    )
    $files = @(Get-ChildItem -Path $SnapshotPath -File | Where-Object { $_.Name -notin @('manifest.json', 'SHA256SUMS') } | Sort-Object Name)
    $entries = @()
    $sumLines = @()
    foreach ($file in $files) {
        $hash = Get-MailFileHash -Path $file.FullName
        $entries += [pscustomobject]@{ name = $file.Name; bytes = $file.Length; sha256 = $hash }
        # Two spaces and a binary marker: the exact shape sha256sum -c parses.
        $sumLines += "$hash *$($file.Name)"
    }
    $manifest = [ordered]@{
        schema      = 'seemplify-mail-migration/1'
        phase       = $Phase
        createdAt   = (Get-Date).ToUniversalTime().ToString('o')
        host        = $env:COMPUTERNAME
        project     = $script:LocalProject
        files       = $entries
    }
    foreach ($key in $Extra.Keys) { $manifest[$key] = $Extra[$key] }

    $manifestPath = Join-Path $SnapshotPath 'manifest.json'
    $sumsPath = Join-Path $SnapshotPath 'SHA256SUMS'
    ($manifest | ConvertTo-Json -Depth 6) | Set-Content -Path $manifestPath -Encoding utf8
    # LF endings, no BOM: sha256sum will not match a CRLF or BOM-prefixed file.
    [System.IO.File]::WriteAllText($sumsPath, (($sumLines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
    return $manifestPath
}

function Test-MailManifest {
    <#.SYNOPSIS Re-hashes every file in a snapshot and compares to its manifest.#>
    param([Parameter(Mandatory)][string] $SnapshotPath)
    $manifestPath = Join-Path $SnapshotPath 'manifest.json'
    if (-not (Test-Path $manifestPath)) { throw "No manifest.json in $SnapshotPath." }
    $manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
    $problems = @()
    foreach ($entry in $manifest.files) {
        $path = Join-Path $SnapshotPath $entry.name
        if (-not (Test-Path $path)) { $problems += "missing: $($entry.name)"; continue }
        $actualBytes = (Get-Item $path).Length
        if ($actualBytes -ne $entry.bytes) { $problems += "size changed: $($entry.name)"; continue }
        if ((Get-MailFileHash -Path $path) -ne $entry.sha256) { $problems += "checksum mismatch: $($entry.name)" }
    }
    return [pscustomobject]@{ Ok = ($problems.Count -eq 0); Problems = $problems; Manifest = $manifest }
}

function New-MailSnapshotPath {
    param([Parameter(Mandatory)][string] $Phase)
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
    $path = Join-Path (Get-MailMigrationRoot) "snapshots\$Phase-$stamp"
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    return $path
}

function Get-LatestMailSnapshot {
    param([string] $Phase = '*')
    $root = Join-Path (Get-MailMigrationRoot) 'snapshots'
    if (-not (Test-Path $root)) { return $null }
    return Get-ChildItem -Path $root -Directory -Filter "$Phase-*" |
        Sort-Object Name -Descending |
        Select-Object -First 1
}

function New-MailRemoteContext {
    <#
    .SYNOPSIS Describes the Dokploy host and the key used to reach it.
    .DESCRIPTION Host-key checking stays on. A migration that silently accepts a
    new host key is a migration that can be pointed at the wrong machine.
    #>
    param(
        [Parameter(Mandatory)][string] $HostName,
        [Parameter(Mandatory)][string] $UserName,
        [Parameter(Mandatory)][string] $KeyPath,
        [int] $Port = 22,
        [string] $RemoteRoot = '/opt/seemplify-mail-migration'
    )
    if (-not (Test-Path $KeyPath)) { throw "Migration key not found at $KeyPath. Run new-migration-key.ps1 first." }
    return [pscustomobject]@{
        HostName   = $HostName
        UserName   = $UserName
        KeyPath    = (Resolve-Path $KeyPath).Path
        Port       = $Port
        RemoteRoot = $RemoteRoot
        Target     = "$UserName@$HostName"
        SshArgs    = @(
            '-i', (Resolve-Path $KeyPath).Path,
            '-p', "$Port",
            '-o', 'BatchMode=yes',
            '-o', 'StrictHostKeyChecking=yes',
            '-o', 'IdentitiesOnly=yes',
            '-o', 'ConnectTimeout=15'
        )
    }
}

function Invoke-MailRemote {
    <#.SYNOPSIS Runs a command on the Dokploy host over the migration key.#>
    param(
        [Parameter(Mandatory)][pscustomobject] $Remote,
        [Parameter(Mandatory)][string] $Script,
        [switch] $AllowFailure
    )
    $arguments = @($Remote.SshArgs) + @($Remote.Target, $Script)
    return Invoke-Native -FilePath 'ssh' -Arguments $arguments -AllowFailure:$AllowFailure
}

function Copy-MailToRemote {
    param(
        [Parameter(Mandatory)][pscustomobject] $Remote,
        [Parameter(Mandatory)][string] $LocalPath,
        [Parameter(Mandatory)][string] $RemotePath
    )
    # scp takes -P for the port where ssh takes -p.
    $scpArgs = @('-i', $Remote.KeyPath, '-P', "$($Remote.Port)",
        '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'IdentitiesOnly=yes',
        '-r', $LocalPath, "$($Remote.Target):$RemotePath")
    return Invoke-Native -FilePath 'scp' -Arguments $scpArgs
}

function Copy-MailFromRemote {
    param(
        [Parameter(Mandatory)][pscustomobject] $Remote,
        [Parameter(Mandatory)][string] $RemotePath,
        [Parameter(Mandatory)][string] $LocalPath
    )
    $scpArgs = @('-i', $Remote.KeyPath, '-P', "$($Remote.Port)",
        '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'IdentitiesOnly=yes',
        '-r', "$($Remote.Target):$RemotePath", $LocalPath)
    return Invoke-Native -FilePath 'scp' -Arguments $scpArgs
}

function Test-MailApiEndpoint {
    <#
    .SYNOPSIS Probes a Mail API endpoint.
    .DESCRIPTION When a bearer is supplied it is sent as a header on a single
    request and is never written to the console or to a report.
    #>
    param(
        [Parameter(Mandatory)][string] $BaseUrl,
        [string] $Path = '/health/live',
        [string] $Bearer,
        [int] $TimeoutSeconds = 15
    )
    $headers = @{}
    if ($Bearer) { $headers['Authorization'] = "Bearer $Bearer" }
    $uri = "$($BaseUrl.TrimEnd('/'))$Path"
    try {
        $response = Invoke-WebRequest -Uri $uri -Headers $headers -TimeoutSec $TimeoutSeconds -UseBasicParsing -ErrorAction Stop
        return [pscustomobject]@{ Ok = $true; StatusCode = [int]$response.StatusCode; Body = $response.Content; Error = $null }
    } catch {
        $statusCode = 0
        if ($_.Exception.PSObject.Properties.Name -contains 'Response' -and $_.Exception.Response) {
            try { $statusCode = [int]$_.Exception.Response.StatusCode } catch { $statusCode = 0 }
        }
        return [pscustomobject]@{ Ok = $false; StatusCode = $statusCode; Body = $null; Error = $_.Exception.Message }
    }
}

function Get-MailReadiness {
    <#
    .SYNOPSIS Reads /health/ready and reports which gates block readiness.
    #>
    param([Parameter(Mandatory)][string] $BaseUrl, [int] $TimeoutSeconds = 15)
    $probe = Test-MailApiEndpoint -BaseUrl $BaseUrl -Path '/health/ready' -TimeoutSeconds $TimeoutSeconds
    $blocked = @()
    if ($probe.Body) {
        try {
            $parsed = $probe.Body | ConvertFrom-Json
            if ($parsed.PSObject.Properties.Name -contains 'blocked') { $blocked = @($parsed.blocked) }
        } catch { }
    }
    return [pscustomobject]@{
        Ok         = ($probe.Ok -and $probe.StatusCode -eq 200)
        StatusCode = $probe.StatusCode
        Blocked    = $blocked
        Error      = $probe.Error
    }
}

function Save-MailPhaseRecord {
    <#
    .SYNOPSIS Appends a phase outcome to the migration journal.
    .DESCRIPTION The journal is what later phases read to decide whether they
    are allowed to run: cleanup, for instance, refuses until it can see a
    completed soak here.
    #>
    param(
        [Parameter(Mandatory)][string] $Phase,
        [Parameter(Mandatory)][ValidateSet('started', 'completed', 'failed', 'skipped')][string] $Outcome,
        [hashtable] $Detail = @{}
    )
    $root = Get-MailMigrationRoot
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    $record = [ordered]@{
        phase     = $Phase
        outcome   = $Outcome
        at        = (Get-Date).ToUniversalTime().ToString('o')
    }
    foreach ($key in $Detail.Keys) { $record[$key] = $Detail[$key] }
    $line = ($record | ConvertTo-Json -Depth 6 -Compress)
    Add-Content -Path (Join-Path $root 'journal.jsonl') -Value $line -Encoding utf8
    return $record
}

function Get-MailPhaseRecords {
    param([string] $Phase)
    $path = Join-Path (Get-MailMigrationRoot) 'journal.jsonl'
    if (-not (Test-Path $path)) { return @() }
    $records = @()
    foreach ($line in (Get-Content -Path $path)) {
        if (-not $line.Trim()) { continue }
        try { $records += ($line | ConvertFrom-Json) } catch { continue }
    }
    if ($Phase) { $records = @($records | Where-Object { $_.phase -eq $Phase }) }
    return $records
}

Export-ModuleMember -Function @(
    'Get-MailRepositoryRoot', 'Get-MailMigrationRoot', 'Write-MailLog', 'Assert-MailCommand',
    'Invoke-Native', 'Get-MailContainer', 'Get-MailContainerState', 'Invoke-MailContainerShell',
    'Get-PostfixQueueReport', 'Get-PostalQueueReport', 'Get-MailFileHash', 'New-MailManifest',
    'Test-MailManifest', 'New-MailSnapshotPath', 'Get-LatestMailSnapshot', 'New-MailRemoteContext',
    'Invoke-MailRemote', 'Copy-MailToRemote', 'Copy-MailFromRemote', 'Test-MailApiEndpoint',
    'Get-MailReadiness', 'Save-MailPhaseRecord', 'Get-MailPhaseRecords'
) -Variable @()
