$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'postgres-runtime-compatibility.ps1')

if (-not (Test-ProjectSupportsPostgresRuntimeVersion $ProjectDir 6)) {
  throw 'The current release must advertise and contain PostgreSQL runtime schema 6 support.'
}
if (Test-ProjectSupportsPostgresRuntimeVersion $ProjectDir 5) {
  throw 'The runtime-6 binary must not claim that it can run on the runtime-5 schema.'
}
if (-not (Test-ProjectCanUpgradePostgresRuntimeVersion $ProjectDir 5 6)) {
  throw 'The runtime-6 release must retain an explicit runtime-5 to runtime-6 upgrade path.'
}
$emptyRelease = Join-Path ([IO.Path]::GetTempPath()) "experience-runtime-v1-$PID-$([Guid]::NewGuid().ToString('N'))"
try {
  New-Item -ItemType Directory -Force $emptyRelease | Out-Null
  if (Test-ProjectSupportsPostgresRuntimeVersion $emptyRelease 6) {
    throw 'A release without runtime-6 metadata/artifacts was incorrectly accepted.'
  }
} finally { Remove-Item -LiteralPath $emptyRelease -Recurse -Force -ErrorAction SilentlyContinue }

[pscustomobject]@{ runtimeSchemaVersion=6; currentReleaseCompatible=$true; runtime5Runnable=$false; runtime5UpgradeCompatible=$true; legacyReleaseRejected=$true } | ConvertTo-Json -Compress
