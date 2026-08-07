#Requires -Version 5.1
[CmdletBinding(SupportsShouldProcess, ConfirmImpact='High')]
param([switch]$Execute)
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'SeemplifyMailMigration.psm1') -Force
if (-not $Execute) { throw 'Dry run only: re-run with -Execute and approve the confirmation to freeze local acceptance and the worker.' }
$api=Get-MailContainer -Service 'mail-api'; $worker=Get-MailContainer -Service 'postal-worker'
$db=Get-MailContainer -Service 'mariadb'; $relay=Get-MailContainer -Service 'postfix-relay'
$postal=Get-PostalQueueReport -MariadbContainer $db; $postfix=Get-PostfixQueueReport -Container $relay
if (-not $postal.Available -or -not $postal.Queued -eq 0 -or -not $postfix.IsEmpty) { throw "Queues must be readable and empty before freeze (Postal=$($postal.Queued), Postfix=$($postfix.Entries))." }
if ($PSCmdlet.ShouldProcess("$api and $worker",'Stop local Mail API acceptance and Postal worker')) {
  Save-MailPhaseRecord -Phase 'freeze' -Outcome 'started' | Out-Null
  Invoke-Native -FilePath docker -Arguments @('stop','--time','30',$api,$worker) | Out-Null
  Save-MailPhaseRecord -Phase 'freeze' -Outcome 'completed' -Detail @{api=$api;worker=$worker} | Out-Null
  Write-MailLog -Level ok -Message 'Local API acceptance and Postal worker are frozen. MariaDB, Postal web/SMTP and relay remain available for rollback.'
}
