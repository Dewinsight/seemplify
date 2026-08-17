#Requires -Version 5.1
[CmdletBinding(DefaultParameterSetName='Inspect')]
param(
  [Parameter(ParameterSetName='Create',Mandatory)][string]$NewApiKey,
  [Parameter(ParameterSetName='Create')][string]$Scopes='send,read',
  [Parameter(ParameterSetName='Create',Mandatory)][string]$BearerOutputFile,
  [Parameter(ParameterSetName='Revoke',Mandatory)][string]$RevokeApiKey,
  [switch]$Json,
  [string]$EnvironmentFile=''
)
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
if(-not $EnvironmentFile){$EnvironmentFile=Join-Path $PSScriptRoot '..\.env.runtime'}

function Read-EnvLines([string]$Path){if(-not(Test-Path -LiteralPath $Path)){throw "Environment file not found: $Path"};return @([IO.File]::ReadAllLines((Resolve-Path $Path)))}
function Get-EnvValue([string[]]$Lines,[string]$Name){$line=@($Lines|Where-Object{$_ -match "^\s*$([regex]::Escape($Name))="}|Select-Object -Last 1);if(-not $line){return ''};return ($line -split '=',2)[1].Trim()}
function Set-EnvValue([string[]]$Lines,[string]$Name,[string]$Value){$found=$false;$out=foreach($line in $Lines){if($line -match "^\s*$([regex]::Escape($Name))="){if(-not $found){"$Name=$Value";$found=$true}}else{$line}};if(-not $found){$out+= "$Name=$Value"};return @($out)}
function Validate-Id([string]$Id){$value=$Id.Trim();if($value -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}$'){throw 'API key ID must be 3-64 letters, numbers, underscores or hyphens.'};return $value}
function Parse-Inventory([string]$Raw){$value=$Raw.Trim();if($value.Length -ge 2 -and (($value[0] -eq '"' -and $value[$value.Length-1] -eq '"') -or ($value[0] -eq "'" -and $value[$value.Length-1] -eq "'"))){$value=$value.Substring(1,$value.Length-2)};$items=@();foreach($entry in @($value -split ','|Where-Object{$_.Trim()})){if($entry.Trim() -notmatch '^([A-Za-z0-9][A-Za-z0-9_-]{2,63}):([a-fA-F0-9]{64}):(send|read|admin)(\|(send|read|admin))*$'){throw 'MAIL_API_KEYS is malformed; refusing to edit it.'};$items+=$entry.Trim()};return $items}
function Write-Atomic([string]$Path,[string[]]$Lines){$full=[IO.Path]::GetFullPath($Path);$temp="$full.$([guid]::NewGuid().ToString('N')).tmp";[IO.File]::WriteAllLines($temp,$Lines,(New-Object Text.UTF8Encoding($false)));Move-Item -LiteralPath $temp -Destination $full -Force}

$lines=Read-EnvLines $EnvironmentFile;$inventory=@(Parse-Inventory (Get-EnvValue $lines 'MAIL_API_KEYS'));$actions=@();$warnings=@()
if($PSCmdlet.ParameterSetName -eq 'Create'){
  $id=Validate-Id $NewApiKey;if($inventory|Where-Object{$_ -like "$id`:*"}){throw "API key '$id' already exists."}
  $scopeList=@($Scopes -split ','|ForEach-Object{$_.Trim().ToLowerInvariant()}|Where-Object{$_});if(-not $scopeList.Count -or @($scopeList|Where-Object{$_ -notin @('send','read','admin')}).Count){throw 'Scopes must contain only send, read or admin.'}
  $bytes=New-Object byte[] 32;[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes);$secret=[Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
  $sha=[Security.Cryptography.SHA256]::Create();try{$hash=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($secret)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
  $inventory+="$id`:$hash`:$((@($scopeList|Select-Object -Unique))-join '|')";$lines=Set-EnvValue $lines 'MAIL_API_KEYS' ($inventory -join ',');Write-Atomic $EnvironmentFile $lines
  $directory=Split-Path -Parent ([IO.Path]::GetFullPath($BearerOutputFile));if($directory){New-Item -ItemType Directory -Path $directory -Force|Out-Null};[IO.File]::WriteAllText([IO.Path]::GetFullPath($BearerOutputFile),"$id.$secret",(New-Object Text.UTF8Encoding($false)));$secret=$null
  $actions+=@{target="api-key:$id";action='created';scopes=$scopeList}
}
elseif($PSCmdlet.ParameterSetName -eq 'Revoke'){
  $id=Validate-Id $RevokeApiKey;$next=@($inventory|Where-Object{$_ -notlike "$id`:*"});if($next.Count -eq $inventory.Count){throw "API key '$id' does not exist."};$lines=Set-EnvValue $lines 'MAIL_API_KEYS' ($next -join ',');Write-Atomic $EnvironmentFile $lines;$inventory=$next;$actions+=@{target="api-key:$id";action='revoked'}
}
$result=@{ok=$true;configuredKeys=$inventory.Count;actions=$actions;warnings=$warnings}
if($Json){$result|ConvertTo-Json -Depth 5 -Compress}else{$result}
