#Requires -Version 5.1
<#
.SYNOPSIS
Read-only readiness check for the local-to-Dokploy mail migration.

.DESCRIPTION
Changes nothing. It reports whether the local stack is in a state that can be
migrated and whether the remote host can be reached, so every blocking problem
is known before any phase that moves data runs.

The queue gates are evaluated here for information. They are enforced again,
immediately before the data is captured, by export-state.ps1 and by cutover.ps1
— a queue that was empty ten minutes ago proves nothing about now.

.EXAMPLE
    .\preflight.ps1
    .\preflight.ps1 -RemoteHost 4.180.153.209 -RemoteUser root -KeyPath ..\..\..\..\.local-runtime\mail-migration\keys\migration_ed25519
#>
[CmdletBinding()]
param(
    [string] $RemoteHost,
    [string] $RemoteUser = 'root',
    [string] $KeyPath,
    [int]    $RemotePort = 22,
    [string] $RemoteProject = 'seemplify-mail-prod',
    [string] $LocalApiBaseUrl = 'http://127.0.0.1:5020',
    [string] $PublicApiBaseUrl = 'https://mail-control.seemplifyai.com'
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'SeemplifyMailMigration.psm1') -Force

$findings = New-Object System.Collections.ArrayList
function Add-Finding {
    param([string] $Check, [ValidateSet('ok', 'warn', 'fail')][string] $Level, [string] $Detail)
    [void]$findings.Add([pscustomobject]@{ Check = $Check; Level = $Level; Detail = $Detail })
    Write-MailLog -Level $Level -Message ("{0}: {1}" -f $Check, $Detail)
}

Write-MailLog -Level step -Message 'Preflight: local stack'

try {
    Assert-MailCommand -Name @('docker')
    Add-Finding -Check 'docker' -Level ok -Detail 'Docker CLI is available.'
} catch {
    Add-Finding -Check 'docker' -Level fail -Detail $_.Exception.Message
}

$services = @('mariadb', 'postal-web', 'postal-worker', 'postal-smtp', 'postfix-relay', 'mail-api')
$containers = @{}
foreach ($service in $services) {
    try {
        $container = Get-MailContainer -Service $service
        $containers[$service] = $container
        $state = Get-MailContainerState -Container $container
        if ($state.Status -ne 'running') {
            Add-Finding -Check "container/$service" -Level fail -Detail "$container is $($state.Status); the migration captures a running stack."
        } elseif ($state.Health -eq 'unhealthy') {
            Add-Finding -Check "container/$service" -Level fail -Detail "$container is running but unhealthy."
        } else {
            Add-Finding -Check "container/$service" -Level ok -Detail "$container is $($state.Status) (health: $($state.Health))."
        }
    } catch {
        Add-Finding -Check "container/$service" -Level fail -Detail $_.Exception.Message
    }
}

Write-MailLog -Level step -Message 'Preflight: state volumes'
foreach ($volume in @('mariadb-data', 'postal-config', 'relay-spool', 'mail-api-data')) {
    $name = "seemplify-mail_$volume"
    $probe = Invoke-Native -FilePath 'docker' -Arguments @('volume', 'inspect', $name, '--format', '{{.Name}}') -AllowFailure
    if ($probe.ExitCode -eq 0) {
        Add-Finding -Check "volume/$volume" -Level ok -Detail "$name exists."
    } else {
        Add-Finding -Check "volume/$volume" -Level fail -Detail "$name is missing; there is nothing to migrate for this component."
    }
}

Write-MailLog -Level step -Message 'Preflight: queue gates'
if ($containers.ContainsKey('postfix-relay')) {
    $postfix = Get-PostfixQueueReport -Container $containers['postfix-relay']
    if ($postfix.IsEmpty) {
        Add-Finding -Check 'queue/postfix' -Level ok -Detail 'The Postfix spool is empty. The spool will not be migrated and cutover is not blocked here.'
    } else {
        Add-Finding -Check 'queue/postfix' -Level warn -Detail "The Postfix spool holds $($postfix.Entries) message(s). Cutover is blocked until it drains; export-state.ps1 will archive the spool while it is non-empty."
    }
}
if ($containers.ContainsKey('mariadb')) {
    $postal = Get-PostalQueueReport -MariadbContainer $containers['mariadb']
    if (-not $postal.Available) {
        Add-Finding -Check 'queue/postal' -Level warn -Detail $postal.Detail
    } elseif ($postal.Queued -eq 0) {
        Add-Finding -Check 'queue/postal' -Level ok -Detail 'Postal has nothing queued.'
    } else {
        Add-Finding -Check 'queue/postal' -Level warn -Detail "Postal still has $($postal.Queued) queued message(s); they must drain before cutover."
    }
}

Write-MailLog -Level step -Message 'Preflight: API surface'
$live = Test-MailApiEndpoint -BaseUrl $LocalApiBaseUrl -Path '/health/live'
if ($live.Ok -and $live.StatusCode -eq 200) {
    Add-Finding -Check 'api/live' -Level ok -Detail "Local Mail API answers 200 at $LocalApiBaseUrl/health/live."
} else {
    Add-Finding -Check 'api/live' -Level fail -Detail "Local Mail API did not answer 200 at $LocalApiBaseUrl/health/live ($($live.StatusCode) $($live.Error))."
}

$readiness = Get-MailReadiness -BaseUrl $LocalApiBaseUrl
if ($readiness.Ok) {
    Add-Finding -Check 'api/ready' -Level ok -Detail 'Local readiness reports no blocked gates.'
} else {
    Add-Finding -Check 'api/ready' -Level warn -Detail "Local readiness is not green (HTTP $($readiness.StatusCode)); blocked gates: $($readiness.Blocked -join ', ')."
}

$publicLive = Test-MailApiEndpoint -BaseUrl $PublicApiBaseUrl -Path '/health/live'
if ($publicLive.Ok -and $publicLive.StatusCode -eq 200) {
    Add-Finding -Check 'api/public' -Level ok -Detail "$PublicApiBaseUrl currently answers 200; this is the surface that must not break."
} else {
    Add-Finding -Check 'api/public' -Level warn -Detail "$PublicApiBaseUrl did not answer 200 ($($publicLive.StatusCode) $($publicLive.Error))."
}

Write-MailLog -Level step -Message 'Preflight: migration workspace'
$root = Get-MailMigrationRoot
try {
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    $drive = Get-PSDrive -Name (Split-Path -Qualifier $root).TrimEnd(':') -ErrorAction SilentlyContinue
    if ($drive -and $drive.Free -lt 5GB) {
        Add-Finding -Check 'workspace' -Level warn -Detail "$root has only $([math]::Round($drive.Free / 1GB, 1)) GB free; a dump plus archives needs headroom."
    } else {
        Add-Finding -Check 'workspace' -Level ok -Detail "$root is writable."
    }
} catch {
    Add-Finding -Check 'workspace' -Level fail -Detail $_.Exception.Message
}

if ($RemoteHost) {
    Write-MailLog -Level step -Message 'Preflight: Dokploy host'
    try {
        Assert-MailCommand -Name @('ssh', 'scp')
        if (-not $KeyPath) { throw 'Pass -KeyPath. Create the key with new-migration-key.ps1 first.' }
        $remote = New-MailRemoteContext -HostName $RemoteHost -UserName $RemoteUser -KeyPath $KeyPath -Port $RemotePort
        $probe = Invoke-MailRemote -Remote $remote -Script 'docker version --format "{{.Server.Version}}" && id -u' -AllowFailure
        if ($probe.ExitCode -eq 0) {
            Add-Finding -Check 'remote/ssh' -Level ok -Detail "Reached $($remote.Target) and Docker responded."
        } else {
            Add-Finding -Check 'remote/ssh' -Level fail -Detail "Could not run Docker on $($remote.Target). $($probe.Output)"
        }

        $conflict = Invoke-MailRemote -Remote $remote -Script "docker volume ls --format '{{.Name}}' | grep -c '^${RemoteProject}_' || true" -AllowFailure
        $existing = 0
        if ($conflict.ExitCode -eq 0) { [int]::TryParse($conflict.Output.Trim(), [ref]$existing) | Out-Null }
        if ($existing -gt 0) {
            Add-Finding -Check 'remote/volumes' -Level warn -Detail "$existing $RemoteProject volume(s) already exist on the host. Restore refuses to overwrite a populated volume without -Force."
        } else {
            Add-Finding -Check 'remote/volumes' -Level ok -Detail 'No production mail volumes exist yet; the restore will create them.'
        }
    } catch {
        Add-Finding -Check 'remote' -Level fail -Detail $_.Exception.Message
    }
} else {
    Add-Finding -Check 'remote' -Level warn -Detail 'No -RemoteHost given, so the Dokploy host was not checked.'
}

$failures = @($findings | Where-Object { $_.Level -eq 'fail' })
$warnings = @($findings | Where-Object { $_.Level -eq 'warn' })

Write-Host ''
Write-MailLog -Level step -Message ("Preflight complete: {0} ok, {1} warning(s), {2} failure(s)." -f
    @($findings | Where-Object { $_.Level -eq 'ok' }).Count, $warnings.Count, $failures.Count)

Save-MailPhaseRecord -Phase 'preflight' -Outcome $(if ($failures.Count) { 'failed' } else { 'completed' }) -Detail @{
    ok       = @($findings | Where-Object { $_.Level -eq 'ok' }).Count
    warnings = $warnings.Count
    failures = @($failures | ForEach-Object { $_.Check })
} | Out-Null

if ($failures.Count) {
    Write-MailLog -Level fail -Message 'Preflight failed. Resolve every failure above before running export-state.ps1.'
    exit 1
}
Write-MailLog -Level ok -Message 'Preflight passed.'
exit 0
