[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('MIT', 'Apache-2.0')]
  [string]$LicenseId,

  [Parameter()]
  [string]$CopyrightHolder = 'Seemplify',

  [Parameter()]
  [int]$Year = [DateTime]::UtcNow.Year,

  [Parameter()]
  [switch]$MakePublic
)

$ErrorActionPreference = 'Stop'

function Write-Utf8NoBomFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Content
  )

  $encoding = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function ConvertTo-OrderedHashtable {
  param($InputObject)

  if ($null -eq $InputObject) {
    return $null
  }
  if ($InputObject -is [System.Collections.IDictionary]) {
    $table = [ordered]@{}
    foreach ($key in $InputObject.Keys) {
      $table[$key] = ConvertTo-OrderedHashtable -InputObject $InputObject[$key]
    }
    return $table
  }
  if ($InputObject -is [System.Collections.IEnumerable] -and -not ($InputObject -is [string])) {
    $items = New-Object System.Collections.ArrayList
    foreach ($entry in $InputObject) {
      [void]$items.Add((ConvertTo-OrderedHashtable -InputObject $entry))
    }
    return ,$items.ToArray()
  }
  if ($InputObject -is [pscustomobject]) {
    $table = [ordered]@{}
    foreach ($property in $InputObject.PSObject.Properties) {
      $table[$property.Name] = ConvertTo-OrderedHashtable -InputObject $property.Value
    }
    return $table
  }
  return $InputObject
}

function New-LicenseText {
  param(
    [Parameter(Mandatory = $true)]
    [string]$TemplateId,
    [Parameter(Mandatory = $true)]
    [string]$Owner,
    [Parameter(Mandatory = $true)]
    [int]$CopyrightYear
  )

  $ghCommand = Get-Command gh -ErrorAction SilentlyContinue
  if ($null -eq $ghCommand) {
    throw 'GitHub CLI (gh) is required to generate SDK license text.'
  }

  $temporaryRoot = Join-Path $env:TEMP ('sdk_license_' + [guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Path $temporaryRoot -Force -WhatIf:$false | Out-Null

  try {
    Push-Location $temporaryRoot
    $commandArguments = @('license', 'create', $TemplateId, '--author', $Owner, '--year', [string]$CopyrightYear)
    & $ghCommand.Source @commandArguments | Out-Null
    $licenseText = Get-Content -Path (Join-Path $temporaryRoot 'LICENSE') -Raw
    if ($TemplateId -eq 'Apache-2.0') {
      $pattern = 'Copyright\s+\d{4}\s+\[name of copyright owner\]'
      $replacement = "Copyright $CopyrightYear $Owner"
      $licenseText = [regex]::Replace($licenseText, $pattern, $replacement, 1)
    }
    return $licenseText.TrimEnd("`r", "`n") + "`n"
  }
  finally {
    Pop-Location
    if (Test-Path -LiteralPath $temporaryRoot) {
      Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -WhatIf:$false
    }
  }
}

$scriptRoot = Split-Path -Parent $PSCommandPath
$workspaceRoot = Split-Path -Parent $scriptRoot
$policyPath = Join-Path $workspaceRoot 'packages\SDK-QUALIFICATION.json'
$sdkPackageDirectories = @(
  'journey-event-protocol',
  'journey-browser-sdk',
  'journey-node',
  'journey-react',
  'journey-react-native'
) | ForEach-Object { Join-Path $workspaceRoot "packages\$_" }

$licenseText = New-LicenseText -TemplateId $LicenseId -Owner $CopyrightHolder -CopyrightYear $Year

foreach ($packageDirectory in $sdkPackageDirectories) {
  $manifestPath = Join-Path $packageDirectory 'package.json'
  $licensePath = Join-Path $packageDirectory 'LICENSE'

  $manifestObject = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
  $manifest = ConvertTo-OrderedHashtable -InputObject $manifestObject

  $manifest['license'] = $LicenseId
  if ($MakePublic) {
    $manifest['private'] = $false
  }
  if ($manifest.Contains('files')) {
    $files = @($manifest['files'])
    if ($files -notcontains 'LICENSE') {
      $manifest['files'] = @($files + 'LICENSE')
    }
  }

  $manifestJson = ($manifest | ConvertTo-Json -Depth 32) + "`n"

  if ($PSCmdlet.ShouldProcess($manifestPath, "apply $LicenseId SDK license metadata")) {
    Write-Utf8NoBomFile -Path $manifestPath -Content $manifestJson
  }
  if ($PSCmdlet.ShouldProcess($licensePath, "write $LicenseId license text")) {
    Write-Utf8NoBomFile -Path $licensePath -Content $licenseText
  }
}

$policyObject = Get-Content -Path $policyPath -Raw | ConvertFrom-Json
$policy = ConvertTo-OrderedHashtable -InputObject $policyObject

$policy['release']['approvedLicences'] = @($LicenseId)
$policy['lockedFoundation']['licenceKeyForbidden'] = $false
$policy['lockedFoundation']['licenseFileForbidden'] = $false
if ($MakePublic) {
  $policy['lockedFoundation']['allPackagesPrivate'] = $false
}

$externalBlockers = @($policy['externalBlockers']['items'])
$filteredBlockers = $externalBlockers | Where-Object {
  $_ -ne 'No legal SPDX licence has been selected and no LICENSE file exists.' -and
  ($MakePublic -or $_ -ne 'All five packages remain private:true and must not be made public by a qualification change.')
}
$policy['externalBlockers']['items'] = @($filteredBlockers)

$policyJson = ($policy | ConvertTo-Json -Depth 32) + "`n"
if ($PSCmdlet.ShouldProcess($policyPath, "record $LicenseId in SDK qualification policy")) {
  Write-Utf8NoBomFile -Path $policyPath -Content $policyJson
}

Write-Host "Prepared SDK license state for $LicenseId."
if ($MakePublic) {
  Write-Host 'Packages were also marked non-private for release readiness.'
}
