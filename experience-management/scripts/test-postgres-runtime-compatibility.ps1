$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'postgres-runtime-compatibility.ps1')

if (-not (Test-ProjectSupportsPostgresRuntimeVersion $ProjectDir 2)) {
  throw 'The current release must advertise and contain PostgreSQL runtime schema 2 support.'
}
if (Test-ProjectSupportsPostgresRuntimeVersion $ProjectDir 1) {
  throw 'The runtime-2 release must not claim compatibility below its declared minimum.'
}
$emptyRelease = Join-Path ([IO.Path]::GetTempPath()) "experience-runtime-v1-$PID-$([Guid]::NewGuid().ToString('N'))"
try {
  New-Item -ItemType Directory -Force $emptyRelease | Out-Null
  if (Test-ProjectSupportsPostgresRuntimeVersion $emptyRelease 2) {
    throw 'A release without runtime-2 metadata/artifacts was incorrectly accepted.'
  }
} finally { Remove-Item -LiteralPath $emptyRelease -Recurse -Force -ErrorAction SilentlyContinue }

[pscustomobject]@{ runtimeSchemaVersion=2; currentReleaseCompatible=$true; legacyReleaseRejected=$true } | ConvertTo-Json -Compress
