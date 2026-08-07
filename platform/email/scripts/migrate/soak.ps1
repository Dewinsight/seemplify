#Requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory)][uri]$BaseUrl,[int]$IntervalSeconds=30,[int]$DurationMinutes=30)
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
if($DurationMinutes -ne 30){throw 'The production rollback soak is exactly 30 minutes.'}
Import-Module (Join-Path $PSScriptRoot 'SeemplifyMailMigration.psm1') -Force
$root=Get-MailMigrationRoot; New-Item -ItemType Directory -Force $root|Out-Null
$samples=Join-Path $root 'soak-samples.jsonl'; Remove-Item $samples -Force -ErrorAction SilentlyContinue
$started=(Get-Date).ToUniversalTime(); Save-MailPhaseRecord -Phase soak -Outcome started -Detail @{baseUrl=$BaseUrl.Host}|Out-Null
$deadline=$started.AddMinutes(30)
while((Get-Date).ToUniversalTime() -le $deadline){
  $live=Test-MailApiEndpoint -BaseUrl $BaseUrl.AbsoluteUri -Path '/health/live'
  $ready=Get-MailReadiness -BaseUrl $BaseUrl.AbsoluteUri
  $ok=$live.Ok -and $live.StatusCode -eq 200 -and $ready.Ok -and @($ready.Blocked).Count -eq 0
  @{at=(Get-Date).ToUniversalTime().ToString('o');ok=$ok;detail=if($ok){'live and ready'}else{"live=$($live.StatusCode), ready=$($ready.StatusCode), blocked=$(@($ready.Blocked)-join ',')"}}|ConvertTo-Json -Compress|Add-Content $samples -Encoding utf8
  if(-not $ok){Save-MailPhaseRecord -Phase soak -Outcome failed -Detail @{reason='unhealthy-sample'}|Out-Null;throw 'The 30-minute continuous-health soak failed. Rollback remains available.'}
  Start-Sleep -Seconds $IntervalSeconds
}
$node=Get-Command node -ErrorAction Stop
& $node.Source (Join-Path $PSScriptRoot '..\lib\soak.mjs') --samples $samples --started-at $started.ToString('o') --interval-ms ($IntervalSeconds*1000)
if($LASTEXITCODE -ne 0){Save-MailPhaseRecord -Phase soak -Outcome failed -Detail @{reason='coverage-check'}|Out-Null;throw 'Soak continuity validation failed.'}
Save-MailPhaseRecord -Phase soak -Outcome completed -Detail @{minutes=30;samples=(Get-Content $samples).Count}|Out-Null
Write-MailLog -Level ok -Message 'Thirty continuously healthy minutes completed. Scoped local cleanup is now eligible, but has not run.'
