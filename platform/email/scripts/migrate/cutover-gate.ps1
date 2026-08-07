#Requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$RemoteHost,
  [Parameter(Mandatory)][string]$RemoteUser,
  [Parameter(Mandatory)][string]$KeyPath,
  [Parameter(Mandatory)][uri]$StagingBaseUrl,
  [string]$RemoteRoot='/opt/seemplify-mail-migration'
)
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'SeemplifyMailMigration.psm1') -Force
$freeze=@(Get-MailPhaseRecords -Phase freeze | Where-Object outcome -eq completed)
if (-not $freeze.Count) { throw 'Local freeze has not completed.' }
foreach($service in @('mail-api','postal-worker')) { $c=Get-MailContainer -Service $service; $s=Get-MailContainerState $c; if($s.Status -eq 'running'){throw "Local $service is still running; parallel processing is forbidden."} }
$remote=New-MailRemoteContext -HostName $RemoteHost -UserName $RemoteUser -KeyPath $KeyPath -RemoteRoot $RemoteRoot
$check=Invoke-MailRemote -Remote $remote -Script "'$RemoteRoot/bin/remote-readiness.sh' --project seemplify-mail-prod --require-active --public-url '$($StagingBaseUrl.AbsoluteUri.TrimEnd('/'))' --json" -AllowFailure
if($check.ExitCode -ne 0){throw "Remote readiness failed: $($check.Output)"}
$queues=Invoke-MailRemote -Remote $remote -Script "'$RemoteRoot/bin/queue-inspect.sh' --project seemplify-mail-prod --require-empty --json" -AllowFailure
if($queues.ExitCode -ne 0){throw "Remote queues are not empty/readable: $($queues.Output)"}
Save-MailPhaseRecord -Phase 'cutover-ready' -Outcome completed -Detail @{staging=$StagingBaseUrl.Host} | Out-Null
Write-MailLog -Level ok -Message 'Cutover readiness passed. DNS has not been changed; switch Cloudflare only after reviewing the acceptance checklist.'
