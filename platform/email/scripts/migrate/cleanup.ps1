#Requires -Version 5.1
[CmdletBinding(SupportsShouldProcess,ConfirmImpact='High')]
param([Parameter(Mandatory)][string]$Confirmation,[string]$TunnelContainer,[switch]$Execute)
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'SeemplifyMailMigration.psm1') -Force
$repo=Get-MailRepositoryRoot; $allowPath=Join-Path $PSScriptRoot '..\lib\cleanup-allowlist.json'; $allow=Get-Content $allowPath -Raw|ConvertFrom-Json
if($Confirmation -cne $allow.confirmationPhrase){throw "Confirmation phrase must exactly equal: $($allow.confirmationPhrase)"}
foreach($phase in $allow.requiresCompletedPhases){if(-not @(Get-MailPhaseRecords -Phase $phase|Where-Object outcome -eq completed).Count){throw "Completed phase '$phase' is required."}}
if(-not $Execute){throw 'Safety dry run complete. Re-run with -Execute to perform the allowlisted cleanup.'}
$containers=@($allow.categories.containers.names); $volumes=@($allow.categories.volumes.names)
if($volumes.Count -ne 4){throw 'Cleanup volume allowlist must contain exactly four names.'}
foreach($name in $containers){
  $id=(& docker ps -aq --filter "name=^/$name$").Trim(); if(-not $id){continue}
  $project=(& docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' $name).Trim(); if($project -ne 'seemplify-mail'){throw "$name does not belong to seemplify-mail."}
  if($PSCmdlet.ShouldProcess($name,'Remove retired local mail container')){& docker rm -f $name|Out-Null;if($LASTEXITCODE){throw "docker rm failed for $name"}}
}
foreach($name in $volumes){if((& docker volume ls -q --filter "name=^$name$").Trim() -and $PSCmdlet.ShouldProcess($name,'Remove migrated local mail volume')){& docker volume rm $name|Out-Null;if($LASTEXITCODE){throw "docker volume rm failed for $name"}}}
if($TunnelContainer){
  $image=(& docker inspect -f '{{.Config.Image}}' $TunnelContainer).Trim(); if($image -notmatch '^cloudflare/cloudflared[:@]'){throw 'Named tunnel container is not a cloudflared image.'}
  if($PSCmdlet.ShouldProcess($TunnelContainer,'Remove old local mail tunnel connector')){& docker rm -f $TunnelContainer|Out-Null}
}
$root=Get-MailMigrationRoot
foreach($relative in @('keys','snapshots')){$target=[IO.Path]::GetFullPath((Join-Path $root $relative));if(-not $target.StartsWith([IO.Path]::GetFullPath($root),[StringComparison]::OrdinalIgnoreCase)){throw 'Migration cleanup target escaped its root.'};if(Test-Path $target){Remove-Item -LiteralPath $target -Recurse -Force}}
foreach($image in @($allow.categories.'relay-runtime'.images)){& docker image rm $image 2>$null|Out-Null}
$runtime=Join-Path $repo 'platform\email\.env.runtime'; if(Test-Path $runtime){Remove-Item -LiteralPath $runtime -Force}
Write-MailLog -Level ok -Message 'Only allowlisted local mail resources were removed. Product development bearer files were retained.'
