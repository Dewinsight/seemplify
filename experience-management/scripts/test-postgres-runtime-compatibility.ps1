$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'postgres-runtime-compatibility.ps1')

if (-not (Test-ProjectSupportsPostgresRuntimeVersion $ProjectDir 8)) {
  throw 'The current release must advertise and contain PostgreSQL runtime schema 8 support.'
}
if (Test-ProjectSupportsPostgresRuntimeVersion $ProjectDir 7) {
  throw 'The runtime-8 binary must not claim that it can run on the runtime-7 schema.'
}
if (-not (Test-ProjectCanUpgradePostgresRuntimeVersion $ProjectDir 7 8)) {
  throw 'The runtime-8 release must retain an explicit runtime-7 to runtime-8 upgrade path.'
}
$emptyRelease = Join-Path ([IO.Path]::GetTempPath()) "experience-runtime-v1-$PID-$([Guid]::NewGuid().ToString('N'))"
try {
  New-Item -ItemType Directory -Force $emptyRelease | Out-Null
  if (Test-ProjectSupportsPostgresRuntimeVersion $emptyRelease 8) {
    throw 'A release without runtime-8 metadata/artifacts was incorrectly accepted.'
  }
} finally { Remove-Item -LiteralPath $emptyRelease -Recurse -Force -ErrorAction SilentlyContinue }

[pscustomobject]@{ runtimeSchemaVersion=8; currentReleaseCompatible=$true; runtime7Runnable=$false; runtime7UpgradeCompatible=$true; legacyReleaseRejected=$true } | ConvertTo-Json -Compress
