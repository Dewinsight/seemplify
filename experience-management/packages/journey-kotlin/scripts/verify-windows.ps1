[CmdletBinding()]
param(
  [switch]$RunInstrumented
)

$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path -Parent $PSScriptRoot
$wrapper = Join-Path $packageRoot 'gradlew.bat'

if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
  throw 'Java 17 is required and was not found on PATH.'
}
if (-not (Test-Path -LiteralPath $wrapper)) {
  throw "Gradle wrapper not found at $wrapper"
}
$androidRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $env:ANDROID_SDK_ROOT }
if (-not $androidRoot -or -not (Test-Path -LiteralPath $androidRoot)) {
  throw 'ANDROID_HOME or ANDROID_SDK_ROOT must point to an installed Android SDK.'
}

Push-Location $packageRoot
try {
  & $wrapper --no-daemon clean verifyCanonicalFixtures verifyUnreleased testDebugUnitTest lintDebug assembleRelease assembleDebugAndroidTest generatePomFileForReleasePublication generateMetadataFileForReleasePublication
  if ($LASTEXITCODE -ne 0) { throw "Gradle verification failed with exit code $LASTEXITCODE." }

  if ($RunInstrumented) {
    $adb = Join-Path $androidRoot 'platform-tools\adb.exe'
    if (-not (Test-Path -LiteralPath $adb)) { throw 'adb was not found in the Android SDK.' }
    $targets = & $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match "\tdevice$" }
    if (-not $targets) { throw 'Instrumentation was requested, but no authorised emulator/device is attached.' }
    & $wrapper --no-daemon connectedDebugAndroidTest
    if ($LASTEXITCODE -ne 0) { throw "Android instrumentation failed with exit code $LASTEXITCODE." }
  } else {
    Write-Host 'Android instrumentation not run. Pass -RunInstrumented with an attached target to run it.'
  }
} finally {
  Pop-Location
}

