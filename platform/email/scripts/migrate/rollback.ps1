#Requires -Version 5.1
[CmdletBinding(SupportsShouldProcess,ConfirmImpact='High')]
param(
 [Parameter(Mandatory)][string]$RemoteHost,[Parameter(Mandatory)][string]$RemoteUser,
 [Parameter(Mandatory)][string]$KeyPath,[Parameter(Mandatory)][string]$RemoteComposeDirectory,
 [Parameter(Mandatory)][string]$Confirmation,[string]$RemoteProject='seemplify-mail-prod',[switch]$Execute
)
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'SeemplifyMailMigration.psm1') -Force
if($Confirmation -cne 'ROLL BACK SEEMPLIFY MAIL'){throw 'Confirmation must exactly equal ROLL BACK SEEMPLIFY MAIL'}
if(@(Get-MailPhaseRecords -Phase soak|Where-Object outcome -eq completed).Count){throw 'The 30-minute soak is complete; automatic rollback is closed. Use the incident runbook.'}
if(-not $Execute){throw 'Dry run only. Re-run with -Execute after confirming the old Cloudflare tunnel can be restored.'}
$remote=New-MailRemoteContext -HostName $RemoteHost -UserName $RemoteUser -KeyPath $KeyPath
$script="set -eu; cd '$RemoteComposeDirectory'; docker compose stop cloudflared mail-api postal-worker; /opt/seemplify-mail-migration/bin/queue-inspect.sh --project '$RemoteProject' --require-empty"
$result=Invoke-MailRemote -Remote $remote -Script $script -AllowFailure
if($result.ExitCode -ne 0){throw "Remote ingress/workers could not be safely stopped and drained: $($result.Output)"}
Save-MailPhaseRecord -Phase rollback -Outcome started|Out-Null
foreach($service in @('mariadb','postal-web','postal-smtp','postfix-relay','postal-worker','mail-api')){$c=Get-MailContainer -Service $service -AllowMissing;if($c){Invoke-Native docker @('start',$c)|Out-Null}}
$ready=Get-MailReadiness -BaseUrl 'http://127.0.0.1:5020';if(-not $ready.Ok){Save-MailPhaseRecord -Phase rollback -Outcome failed -Detail @{reason='local-not-ready'}|Out-Null;throw 'Local Mail API did not become ready. Do not restore DNS yet.'}
Save-MailPhaseRecord -Phase rollback -Outcome completed -Detail @{dnsAction='restore old Cloudflare tunnel hostname after operator verification'}|Out-Null
Write-MailLog -Level warn -Message 'Local service is ready. Restore the old Cloudflare CNAME/tunnel now, verify public health, and keep Dokploy stopped.'
