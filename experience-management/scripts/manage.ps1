param(
  [ValidateSet('initialize','start','stop','restart','status','enable-auto-start','disable-auto-start')]
  [string]$Action = 'status',
  [switch]$Json
)
$ErrorActionPreference = 'Stop'
$SourceProjectDir = Split-Path -Parent $PSScriptRoot
$RuntimeCompatibilityScript = Join-Path $PSScriptRoot 'postgres-runtime-compatibility.ps1'
if (-not (Test-Path -LiteralPath $RuntimeCompatibilityScript -PathType Leaf)) { throw 'The PostgreSQL runtime compatibility contract is missing.' }
. $RuntimeCompatibilityScript
$RepositoryDir = Split-Path -Parent $SourceProjectDir
$RuntimeDir = Join-Path $RepositoryDir '.local-runtime\experience-management'
$DeploymentsDir = Join-Path $RuntimeDir 'deployments'
$ActiveProjectFile = Join-Path $RuntimeDir 'active-project-path'
$SqliteDatabasePath = Join-Path $RuntimeDir 'experience.sqlite'
$PostgresPasswordFile = Join-Path $RuntimeDir 'postgres-password'
$PostgresOwnerPasswordFile = Join-Path $RuntimeDir 'postgres-owner-password'
$PostgresContainer = 'xplorer-postgres'
$PostgresDatabase = 'seemplify_experience'
$PostgresRole = 'seemplify_experience_app'
$PostgresOwnerRole = 'seemplify_experience_owner'
$PostgresRuntimeSchemaVersion = 5
$PostgresCutoverMarker = Join-Path $RuntimeDir 'postgres-cutover-v1'
$PostgresCutoverState = Join-Path $RuntimeDir 'postgres-cutover-state-v1'
$PostgresRuntimeUpgradeMarker = Join-Path $RuntimeDir 'postgres-runtime-schema-v5-started'
$PostgresMigrationLog = Join-Path $RuntimeDir 'postgres-migration.log'
$PidFile = Join-Path $RuntimeDir 'server.pid'
$PasswordFile = Join-Path $RuntimeDir 'admin-password'
$SessionSecretFile = Join-Path $RuntimeDir 'session-secret'
$BrevoWebhookSecretFile = Join-Path $RuntimeDir 'brevo-webhook-secret'
$XCredentialEncryptionKeyFile = Join-Path $RuntimeDir 'x-credential-encryption-key'
$NylasCredentialEncryptionKeyFile = Join-Path $RuntimeDir 'nylas-credential-encryption-key'
$EsignEncryptionKeyFile = Join-Path $RuntimeDir 'esign-encryption-key'
$EsignStorageDir = Join-Path $RuntimeDir 'esign'
$KnowledgeStorageDir = 'D:\SeemplifyKnowledge\staging'

function Resolve-KnowledgeRuntimeDir {
  $configured = [string][Environment]::GetEnvironmentVariable('SEEMPLIFY_KNOWLEDGE_RUNTIME_DIR')
  if (-not [string]::IsNullOrWhiteSpace($configured)) { return [IO.Path]::GetFullPath($configured) }
  try {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    $raw = & docker.exe inspect 'seemplify-knowledge-arango' 2>$null
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    if ($exitCode -eq 0 -and $raw) {
      $info = $raw | ConvertFrom-Json | Select-Object -First 1
      $owned = [string]$info.Config.Labels.'ai.seemplify.owner' -eq 'local-knowledge'
      $secretMount = $info.Mounts | Where-Object { [string]$_.Destination -eq '/run/secrets/arango-root' } | Select-Object -First 1
      if ($owned -and $secretMount -and (Test-Path -LiteralPath ([string]$secretMount.Source) -PathType Leaf)) {
        $secretsRoot = Split-Path -Parent ([string]$secretMount.Source)
        $candidate = Split-Path -Parent $secretsRoot
        if ((Split-Path -Leaf $secretsRoot) -eq 'secrets' -and (Split-Path -Leaf $candidate) -eq 'knowledge') {
          return [IO.Path]::GetFullPath($candidate)
        }
      }
    }
  } catch { $ErrorActionPreference = 'Stop' }
  return [IO.Path]::GetFullPath((Join-Path $RepositoryDir '.local-runtime\knowledge'))
}

$KnowledgeRuntimeDir = Resolve-KnowledgeRuntimeDir
$env:SEEMPLIFY_KNOWLEDGE_RUNTIME_DIR = $KnowledgeRuntimeDir
$KnowledgeRuntimeSecretFile = Join-Path $KnowledgeRuntimeDir 'service-secret'
$XConsumerKeyFile = Join-Path $RuntimeDir 'x-consumer-key'
$XConsumerSecretFile = Join-Path $RuntimeDir 'x-consumer-secret'
$XBearerTokenFile = Join-Path $RuntimeDir 'x-bearer-token'
$XAccessTokenFile = Join-Path $RuntimeDir 'x-access-token'
$XAccessTokenSecretFile = Join-Path $RuntimeDir 'x-access-token-secret'
$XClientIdFile = Join-Path $RuntimeDir 'x-client-id'
$XClientSecretFile = Join-Path $RuntimeDir 'x-client-secret'
$CloudflareTunnelTokenFile = Join-Path $RuntimeDir 'cloudflare-tunnel-token'
$ExperienceNylasEnvFile = Join-Path $RuntimeDir 'nylas.env'
$RecruiterNylasEnvFile = Join-Path $RepositoryDir 'recruiter\backend\.env'
$StdoutLog = Join-Path $RuntimeDir 'server.stdout.log'
$StderrLog = Join-Path $RuntimeDir 'server.stderr.log'
$StartupShortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'Seemplify Experience.lnk'
$EmbeddingProfiles = [ordered]@{
  'qwen-tei' = [ordered]@{
    provider='qwen-tei'; model='Qwen/Qwen3-Embedding-4B'; revision='5cf2132abc99cad020ac570b19d031efec650f2b';
    dtype='float16'; dimensions=2560; vectorIndexVersion='qwen-v1'
  }
  'gte-node' = [ordered]@{
    provider='gte-node'; model='Alibaba-NLP/gte-modernbert-base'; revision='e7f32e3c00f91d699e8c43b53106206bcc72bb22';
    dtype='q8'; dimensions=768; vectorIndexVersion='gte-modernbert-v1'
  }
}
New-Item -ItemType Directory -Force $RuntimeDir | Out-Null

function Get-ProjectDir {
  if (-not (Test-Path -LiteralPath $ActiveProjectFile)) { return $SourceProjectDir }
  $candidate = (Get-Content -LiteralPath $ActiveProjectFile -Raw).Trim()
  if (-not $candidate) { return $SourceProjectDir }
  $fullCandidate = [IO.Path]::GetFullPath($candidate)
  $fullDeployments = [IO.Path]::GetFullPath($DeploymentsDir).TrimEnd('\') + '\'
  if (-not $fullCandidate.StartsWith($fullDeployments, [StringComparison]::OrdinalIgnoreCase)) { return $SourceProjectDir }
  if (-not (Test-Path -LiteralPath (Join-Path $fullCandidate 'backend\dist\server.js'))) { return $SourceProjectDir }
  return $fullCandidate
}

function New-RandomSecret([int]$Bytes = 32) { $value = New-Object byte[] $Bytes; $generator = [Security.Cryptography.RandomNumberGenerator]::Create(); try { $generator.GetBytes($value) } finally { $generator.Dispose() }; return [Convert]::ToBase64String($value).TrimEnd('=').Replace('+','-').Replace('/','_') }
function Get-EmbeddingBoolean([string]$Name, [bool]$Default = $false) {
  $raw = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
  switch ($raw.Trim().ToLowerInvariant()) {
    { $_ -in @('1','true','yes','on') } { return $true }
    { $_ -in @('0','false','no','off') } { return $false }
    default { throw "$Name must be true or false." }
  }
}
function Get-EmbeddingInteger([string]$Name, [int]$Default, [int]$Minimum, [int]$Maximum) {
  $raw = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
  $value = 0
  if (-not [int]::TryParse($raw, [ref]$value) -or $value -lt $Minimum -or $value -gt $Maximum) {
    throw "$Name must be an integer between $Minimum and $Maximum."
  }
  return $value
}
function Get-EmbeddingConfiguration {
  $forceQwen = Get-EmbeddingBoolean 'EXPERIENCE_EMBEDDING_FORCE_QWEN' $false
  if ($forceQwen) {
    $provider = 'qwen-tei'
    $dualWrite = $false
    $qwenRollbackRetained = $true
    $rolloutPercent = 0
    $shadowPercent = 0
    $concurrency = 8
    $queueDepth = 256
    $timeoutMs = 120000
  } else {
    $provider = [string][Environment]::GetEnvironmentVariable('EXPERIENCE_EMBEDDING_PROVIDER')
    if ([string]::IsNullOrWhiteSpace($provider)) { $provider = 'qwen-tei' }
    $provider = $provider.Trim().ToLowerInvariant()
    if ($provider -notin @('qwen-tei','gte-node')) { throw 'EXPERIENCE_EMBEDDING_PROVIDER must be qwen-tei or gte-node.' }
    $dualWrite = Get-EmbeddingBoolean 'EXPERIENCE_EMBEDDING_DUAL_WRITE' $false
    $qwenRollbackRetained = Get-EmbeddingBoolean 'EXPERIENCE_QWEN_ROLLBACK_RETAINED' $true
    if (-not $qwenRollbackRetained) {
      throw 'EXPERIENCE_QWEN_ROLLBACK_RETAINED=false is not supported during this gated release.'
    }
    $defaultRolloutPercent = if ($provider -eq 'gte-node') { 100 } else { 0 }
    $rolloutPercent = Get-EmbeddingInteger 'EXPERIENCE_EMBEDDING_ROLLOUT_PERCENT' $defaultRolloutPercent 0 100
    $shadowPercent = Get-EmbeddingInteger 'EXPERIENCE_EMBEDDING_SHADOW_PERCENT' 0 0 100
    $concurrency = Get-EmbeddingInteger 'EXPERIENCE_EMBEDDING_CONCURRENCY' 8 1 8
    $queueDepth = Get-EmbeddingInteger 'EXPERIENCE_EMBEDDING_QUEUE_DEPTH' 256 8 4096
    $timeoutMs = Get-EmbeddingInteger 'EXPERIENCE_EMBEDDING_TIMEOUT_MS' 120000 1000 1800000
  }
  if ($provider -eq 'gte-node' -and $qwenRollbackRetained -and -not $dualWrite) {
    throw 'gte-node requires EXPERIENCE_EMBEDDING_DUAL_WRITE=true while the Qwen rollback index is retained.'
  }
  $profile = $EmbeddingProfiles[$provider]
  $configuredFields = [ordered]@{
    EXPERIENCE_EMBEDDING_MODEL=$profile.model
    EXPERIENCE_EMBEDDING_MODEL_REVISION=$profile.revision
    EXPERIENCE_EMBEDDING_DTYPE=$profile.dtype
    EXPERIENCE_EMBEDDING_DIMENSIONS=[string]$profile.dimensions
    EXPERIENCE_VECTOR_INDEX_VERSION=$profile.vectorIndexVersion
  }
  if (-not $forceQwen) {
    foreach ($entry in $configuredFields.GetEnumerator()) {
      $configured = [string][Environment]::GetEnvironmentVariable($entry.Key)
      if (-not [string]::IsNullOrWhiteSpace($configured) -and $configured.Trim() -cne [string]$entry.Value) {
        throw "$($entry.Key) must match the pinned $provider profile."
      }
    }
  }
  return [ordered]@{
    provider=$provider; model=$profile.model; revision=$profile.revision; dtype=$profile.dtype;
    dimensions=$profile.dimensions; vectorIndexVersion=$profile.vectorIndexVersion;
    concurrency=$concurrency; queueDepth=$queueDepth; timeoutMs=$timeoutMs;
    dualWrite=$dualWrite; qwenRollbackRetained=$qwenRollbackRetained; rolloutPercent=$rolloutPercent; shadowPercent=$shadowPercent;
    gteRequired=($provider -eq 'gte-node' -or $dualWrite -or $rolloutPercent -gt 0 -or $shadowPercent -gt 0);
    forceQwenRollback=$forceQwen
  }
}
function Set-EmbeddingEnvironment([Collections.IDictionary]$Configuration) {
  $env:EXPERIENCE_EMBEDDING_PROVIDER=[string]$Configuration.provider
  $env:EXPERIENCE_EMBEDDING_MODEL=[string]$Configuration.model
  $env:EXPERIENCE_EMBEDDING_MODEL_REVISION=[string]$Configuration.revision
  $env:EXPERIENCE_EMBEDDING_DTYPE=[string]$Configuration.dtype
  $env:EXPERIENCE_EMBEDDING_DIMENSIONS=[string]$Configuration.dimensions
  $env:EXPERIENCE_VECTOR_INDEX_VERSION=[string]$Configuration.vectorIndexVersion
  $env:EXPERIENCE_EMBEDDING_CONCURRENCY=[string]$Configuration.concurrency
  $env:EXPERIENCE_EMBEDDING_QUEUE_DEPTH=[string]$Configuration.queueDepth
  $env:EXPERIENCE_EMBEDDING_TIMEOUT_MS=[string]$Configuration.timeoutMs
  $env:EXPERIENCE_EMBEDDING_DUAL_WRITE=if($Configuration.dualWrite){'true'}else{'false'}
  $env:EXPERIENCE_QWEN_ROLLBACK_RETAINED=if($Configuration.qwenRollbackRetained){'true'}else{'false'}
  $env:EXPERIENCE_EMBEDDING_ROLLOUT_PERCENT=[string]$Configuration.rolloutPercent
  $env:EXPERIENCE_EMBEDDING_SHADOW_PERCENT=[string]$Configuration.shadowPercent
  # Keep the legacy Qwen aliases coherent while older isolated deployments drain.
  $env:KNOWLEDGE_EMBEDDING_MODEL=[string]$Configuration.model
  $env:KNOWLEDGE_EMBEDDING_DIMENSION=[string]$Configuration.dimensions
}
function Protect-RuntimeSecret([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
  $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($identity in @($currentIdentity, 'NT AUTHORITY\SYSTEM')) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'Allow')
    [void]$acl.AddAccessRule($rule)
  }
  [IO.File]::SetAccessControl([IO.Path]::GetFullPath($Path), $acl)
}
function Get-NylasEnvironmentFile {
  $configuredNylasEnvFile = [Environment]::GetEnvironmentVariable('NYLAS_ENV_FILE')
  foreach ($candidate in @($configuredNylasEnvFile, $ExperienceNylasEnvFile, $RecruiterNylasEnvFile)) {
    if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    $content = [IO.File]::ReadAllText($candidate)
    if ($content -match '(?m)^\s*NYLAS_CLIENT_ID\s*=\s*.+$' -and $content -match '(?m)^\s*NYLAS_API_KEY\s*=\s*.+$') { return $candidate }
  }
  return $null
}
function Initialize-Runtime {
  if (-not (Test-Path -LiteralPath $PasswordFile)) { Set-Content -LiteralPath $PasswordFile -Value (New-RandomSecret 24) -Encoding ascii }
  if (-not (Test-Path -LiteralPath $SessionSecretFile)) { Set-Content -LiteralPath $SessionSecretFile -Value (New-RandomSecret 48) -Encoding ascii }
  if (-not (Test-Path -LiteralPath $PostgresPasswordFile)) { Set-Content -LiteralPath $PostgresPasswordFile -Value (New-RandomSecret 48) -Encoding ascii }
  if (-not (Test-Path -LiteralPath $PostgresOwnerPasswordFile)) { Set-Content -LiteralPath $PostgresOwnerPasswordFile -Value (New-RandomSecret 48) -Encoding ascii }
  if (-not (Test-Path -LiteralPath $BrevoWebhookSecretFile)) { Set-Content -LiteralPath $BrevoWebhookSecretFile -Value (New-RandomSecret 48) -Encoding ascii }
  if (-not (Test-Path -LiteralPath $XCredentialEncryptionKeyFile)) { Set-Content -LiteralPath $XCredentialEncryptionKeyFile -Value (New-RandomSecret 32) -Encoding ascii }
  if (-not (Test-Path -LiteralPath $NylasCredentialEncryptionKeyFile)) { Set-Content -LiteralPath $NylasCredentialEncryptionKeyFile -Value (New-RandomSecret 32) -Encoding ascii }
  if (-not (Test-Path -LiteralPath $EsignEncryptionKeyFile)) { Set-Content -LiteralPath $EsignEncryptionKeyFile -Value (New-RandomSecret 32) -Encoding ascii }
  New-Item -ItemType Directory -Force $EsignStorageDir | Out-Null
  New-Item -ItemType Directory -Force $KnowledgeStorageDir | Out-Null
  New-Item -ItemType Directory -Force $KnowledgeRuntimeDir | Out-Null
  foreach ($secretFile in @(
    $PasswordFile, $SessionSecretFile, $PostgresPasswordFile, $PostgresOwnerPasswordFile, $BrevoWebhookSecretFile, $XCredentialEncryptionKeyFile, $NylasCredentialEncryptionKeyFile, $EsignEncryptionKeyFile,
    $XConsumerKeyFile, $XConsumerSecretFile, $XBearerTokenFile, $XAccessTokenFile,
    $XAccessTokenSecretFile, $XClientIdFile, $XClientSecretFile, $CloudflareTunnelTokenFile, $ExperienceNylasEnvFile
  )) { Protect-RuntimeSecret $secretFile }
  $envFile = Join-Path $SourceProjectDir 'backend\.env'
  if (-not (Test-Path -LiteralPath $envFile)) { Copy-Item -LiteralPath (Join-Path $SourceProjectDir 'backend\.env.example') -Destination $envFile }
}
function Get-PostgresContainerIdentity {
  $docker = Get-Command docker.exe -ErrorAction SilentlyContinue
  if (-not $docker) { throw 'Docker Desktop is required for the installed PostgreSQL runtime.' }
  $raw = & $docker.Source inspect $PostgresContainer 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $raw) { throw "The PostgreSQL container '$PostgresContainer' is not installed." }
  $container = @($raw | ConvertFrom-Json)[0]
  $values = @{}
  foreach ($entry in @($container.Config.Env)) {
    $pair = $entry -split '=', 2
    if ($pair.Count -eq 2) { $values[$pair[0]] = $pair[1] }
  }
  if (-not $values.POSTGRES_USER -or -not $values.POSTGRES_DB) { throw 'The PostgreSQL container identity is incomplete.' }
  return [ordered]@{ Docker=$docker.Source; User=$values.POSTGRES_USER; Database=$values.POSTGRES_DB; Running=[bool]$container.State.Running }
}
function Invoke-PostgresAdminSql([System.Collections.IDictionary]$Identity, [string]$Database, [string]$Sql) {
  $Sql | & $Identity.Docker exec -i $PostgresContainer psql -X -v ON_ERROR_STOP=1 -q -U $Identity.User -d $Database
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL administration failed for database '$Database'." }
}
function Initialize-Postgres {
  $identity = Get-PostgresContainerIdentity
  if (-not $identity.Running) {
    & $identity.Docker start $PostgresContainer | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "The PostgreSQL container '$PostgresContainer' could not be started." }
  }
  $deadline = (Get-Date).AddSeconds(30)
  do {
    & $identity.Docker exec $PostgresContainer pg_isready -q -U $identity.User -d $identity.Database 2>$null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL did not become ready within 30 seconds.' }

  # Keep the shared database engine recoverable across Windows/Docker restarts.
  & $identity.Docker update --restart unless-stopped $PostgresContainer | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'The PostgreSQL restart policy could not be configured.' }

  $password = (Get-Content -LiteralPath $PostgresPasswordFile -Raw).Trim()
  $ownerPassword = (Get-Content -LiteralPath $PostgresOwnerPasswordFile -Raw).Trim()
  if (-not $password -or -not $ownerPassword) { throw 'An Experience PostgreSQL password file is empty.' }
  $previousPassword = [Environment]::GetEnvironmentVariable('SEEMPLIFY_EXPERIENCE_DB_PASSWORD', 'Process')
  $previousOwnerPassword = [Environment]::GetEnvironmentVariable('SEEMPLIFY_EXPERIENCE_OWNER_PASSWORD', 'Process')
  [Environment]::SetEnvironmentVariable('SEEMPLIFY_EXPERIENCE_DB_PASSWORD', $password, 'Process')
  [Environment]::SetEnvironmentVariable('SEEMPLIFY_EXPERIENCE_OWNER_PASSWORD', $ownerPassword, 'Process')
  try {
    $roleSql = @'
\getenv app_password SEEMPLIFY_EXPERIENCE_DB_PASSWORD
\getenv owner_password SEEMPLIFY_EXPERIENCE_OWNER_PASSWORD
DO $seemplify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='__OWNER_ROLE__') THEN
    CREATE ROLE __OWNER_ROLE__ NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='__APP_ROLE__') THEN
    CREATE ROLE __APP_ROLE__ LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$seemplify$;
ALTER ROLE __OWNER_ROLE__ NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD :'owner_password';
ALTER ROLE __APP_ROLE__ LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD :'app_password';
ALTER ROLE __APP_ROLE__ SET statement_timeout='60s';
ALTER ROLE __APP_ROLE__ SET lock_timeout='5s';
ALTER ROLE __APP_ROLE__ SET idle_in_transaction_session_timeout='30s';
'@.Replace('__OWNER_ROLE__', $PostgresOwnerRole).Replace('__APP_ROLE__', $PostgresRole)
    $roleSql | & $identity.Docker exec -i -e SEEMPLIFY_EXPERIENCE_DB_PASSWORD -e SEEMPLIFY_EXPERIENCE_OWNER_PASSWORD $PostgresContainer psql -X -v ON_ERROR_STOP=1 -q -U $identity.User -d $identity.Database
    if ($LASTEXITCODE -ne 0) { throw 'The isolated Experience PostgreSQL roles could not be configured.' }
  } finally {
    [Environment]::SetEnvironmentVariable('SEEMPLIFY_EXPERIENCE_DB_PASSWORD', $previousPassword, 'Process')
    [Environment]::SetEnvironmentVariable('SEEMPLIFY_EXPERIENCE_OWNER_PASSWORD', $previousOwnerPassword, 'Process')
  }

  $exists = @(& $identity.Docker exec $PostgresContainer psql -X -Atq -U $identity.User -d $identity.Database -c "SELECT 1 FROM pg_database WHERE datname='$PostgresDatabase'") -join ''
  if ($LASTEXITCODE -ne 0) { throw 'The Experience PostgreSQL database could not be inspected.' }
  if ($exists.Trim() -ne '1') {
    & $identity.Docker exec $PostgresContainer createdb -U $identity.User -O $PostgresOwnerRole $PostgresDatabase
    if ($LASTEXITCODE -ne 0) { throw 'The Experience PostgreSQL database could not be created.' }
  }
  Invoke-PostgresAdminSql $identity $identity.Database "ALTER DATABASE $PostgresDatabase OWNER TO $PostgresOwnerRole; REVOKE CONNECT ON DATABASE $PostgresDatabase FROM PUBLIC; GRANT CONNECT ON DATABASE $PostgresDatabase TO $PostgresOwnerRole,$PostgresRole;"
  Invoke-PostgresAdminSql $identity $PostgresDatabase @"
ALTER SCHEMA public OWNER TO $PostgresOwnerRole;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM $PostgresRole;
GRANT CONNECT ON DATABASE $PostgresDatabase TO $PostgresRole;
GRANT USAGE ON SCHEMA public TO $PostgresRole;
"@
}
function Set-PostgresOwnerLogin([bool]$Enabled) {
  $identity = Get-PostgresContainerIdentity
  if (-not $Enabled) {
    Invoke-PostgresAdminSql $identity $identity.Database "ALTER ROLE $PostgresOwnerRole NOLOGIN;"
    return
  }
  $password = (Get-Content -LiteralPath $PostgresOwnerPasswordFile -Raw).Trim()
  if (-not $password) { throw 'The Experience PostgreSQL migration-owner password file is empty.' }
  $previous = [Environment]::GetEnvironmentVariable('SEEMPLIFY_EXPERIENCE_OWNER_PASSWORD', 'Process')
  [Environment]::SetEnvironmentVariable('SEEMPLIFY_EXPERIENCE_OWNER_PASSWORD', $password, 'Process')
  try {
    @"
\getenv owner_password SEEMPLIFY_EXPERIENCE_OWNER_PASSWORD
ALTER ROLE $PostgresOwnerRole LOGIN PASSWORD :'owner_password';
"@ | & $identity.Docker exec -i -e SEEMPLIFY_EXPERIENCE_OWNER_PASSWORD $PostgresContainer psql -X -v ON_ERROR_STOP=1 -q -U $identity.User -d $identity.Database
    if ($LASTEXITCODE -ne 0) { throw 'The PostgreSQL migration owner could not be enabled.' }
  } finally {
    [Environment]::SetEnvironmentVariable('SEEMPLIFY_EXPERIENCE_OWNER_PASSWORD', $previous, 'Process')
  }
}
function Grant-PostgresRuntimePrivileges([string]$ProjectDir) {
  $identity = Get-PostgresContainerIdentity
  foreach ($identifier in @($PostgresDatabase,$PostgresRole,$PostgresOwnerRole)) {
    if ($identifier -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { throw "Unsafe managed PostgreSQL identifier: $identifier" }
  }
  $privilegeFile = Join-Path $ProjectDir 'backend\migrations\postgres\runtime_privileges.sql'
  if (-not (Test-Path -LiteralPath $privilegeFile -PathType Leaf)) { throw 'The atomic PostgreSQL runtime privilege contract is missing.' }
  $privilegeSql = (Get-Content -LiteralPath $privilegeFile -Raw).
    Replace('__DATABASE__',$PostgresDatabase).
    Replace('__APP_ROLE__',$PostgresRole).
    Replace('__OWNER_ROLE__',$PostgresOwnerRole)
  Invoke-PostgresAdminSql $identity $PostgresDatabase $privilegeSql
}
function Invoke-PostgresRuntimeUpgrade([string]$ProjectDir, [System.Management.Automation.ApplicationInfo]$Node, [string]$SourceSha256) {
  $upgrader = Join-Path $ProjectDir 'scripts\upgrade-postgres-schema.mjs'
  if (-not (Test-Path -LiteralPath $upgrader -PathType Leaf)) { throw 'The PostgreSQL runtime upgrader is missing from this release.' }
  if ($SourceSha256 -notmatch '^[a-f0-9]{64}$') { throw 'The PostgreSQL runtime upgrader requires the committed source digest.' }
  Set-PostgresOwnerLogin $true
  try {
    $upgradeOutput = @(& $Node.Source $upgrader --target-version $PostgresRuntimeSchemaVersion --expected-source-version 1 --expected-source-sha256 $SourceSha256 --pg-host 127.0.0.1 --pg-port 5432 --pg-database $PostgresDatabase --pg-user $PostgresOwnerRole --pg-password-file $PostgresOwnerPasswordFile --json 2>&1)
    $upgradeExitCode = $LASTEXITCODE
  } finally { Set-PostgresOwnerLogin $false }
  foreach ($line in $upgradeOutput) { Add-Content -LiteralPath $PostgresMigrationLog -Value ([string]$line) }
  if ($upgradeExitCode -ne 0) { throw "The PostgreSQL runtime schema upgrade failed. See $PostgresMigrationLog." }
}
function Get-PostgresCutoverMarker {
  if (-not (Test-Path -LiteralPath $PostgresCutoverMarker -PathType Leaf)) { return $null }
  try { $marker = Get-Content -LiteralPath $PostgresCutoverMarker -Raw | ConvertFrom-Json } catch { throw 'The PostgreSQL cutover marker is malformed.' }
  if ([int]$marker.schemaVersion -ne 1 -or [string]$marker.database -ne $PostgresDatabase -or [string]$marker.sourceSha256 -notmatch '^[a-f0-9]{64}$') {
    throw 'The PostgreSQL cutover marker does not match the managed runtime.'
  }
  return $marker
}
function Write-PostgresCutoverDocument([string]$Path, [System.Collections.IDictionary]$Value) {
  $temporaryPath = "$Path.pending-$PID"
  try {
    Set-Content -LiteralPath $temporaryPath -Value ($Value | ConvertTo-Json -Compress) -Encoding ascii
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
  } finally { Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue }
}
function Get-PostgresRuntimeUpgradeMarker {
  if (-not (Test-Path -LiteralPath $PostgresRuntimeUpgradeMarker -PathType Leaf)) { return $null }
  try { $marker = Get-Content -LiteralPath $PostgresRuntimeUpgradeMarker -Raw | ConvertFrom-Json } catch { throw 'The PostgreSQL runtime-upgrade marker is malformed.' }
  if ([int]$marker.runtimeSchemaVersion -ne $PostgresRuntimeSchemaVersion -or [string]$marker.database -ne $PostgresDatabase) {
    throw 'The PostgreSQL runtime-upgrade marker does not match the managed runtime.'
  }
  return $marker
}
function Start-PostgresRuntimeUpgrade {
  $existing = Get-PostgresRuntimeUpgradeMarker
  if ($existing) { return }
  $value = [ordered]@{ runtimeSchemaVersion=$PostgresRuntimeSchemaVersion; database=$PostgresDatabase; startedAt=[DateTime]::UtcNow.ToString('o') }
  Write-PostgresCutoverDocument $PostgresRuntimeUpgradeMarker $value
}
function Get-PostgresCutoverState {
  if (-not (Test-Path -LiteralPath $PostgresCutoverState -PathType Leaf)) { return $null }
  try { $state = Get-Content -LiteralPath $PostgresCutoverState -Raw | ConvertFrom-Json } catch { throw 'The PostgreSQL cutover state is malformed.' }
  if ([int]$state.schemaVersion -ne 1 -or [string]$state.database -ne $PostgresDatabase -or
      [string]$state.phase -notin @('base_copy_started','base_committed') -or
      ($state.phase -eq 'base_committed' -and [string]$state.sourceSha256 -notmatch '^[a-f0-9]{64}$')) {
    throw 'The PostgreSQL cutover state does not match the managed runtime.'
  }
  return $state
}
function Set-PostgresCutoverState([string]$Phase, [string]$SourceSha256 = '') {
  if ($Phase -notin @('base_copy_started','base_committed')) { throw "Unsupported PostgreSQL cutover phase: $Phase" }
  if ($Phase -eq 'base_committed' -and $SourceSha256 -notmatch '^[a-f0-9]{64}$') { throw 'A committed base-copy state requires its source digest.' }
  $existing = Get-PostgresCutoverState
  $startedAt = if ($existing -and $existing.startedAt) { [string]$existing.startedAt } else { [DateTime]::UtcNow.ToString('o') }
  $value = [ordered]@{ schemaVersion=1; database=$PostgresDatabase; phase=$Phase; sourceSha256=$SourceSha256; startedAt=$startedAt; updatedAt=[DateTime]::UtcNow.ToString('o') }
  Write-PostgresCutoverDocument $PostgresCutoverState $value
}
function Complete-PostgresCutover([string]$SourceSha256) {
  if ($SourceSha256 -notmatch '^[a-f0-9]{64}$') { throw 'The committed PostgreSQL cutover requires its source digest.' }
  $markerValue = [ordered]@{ schemaVersion=1; database=$PostgresDatabase; sourceSha256=$SourceSha256; committedAt=[DateTime]::UtcNow.ToString('o') }
  Write-PostgresCutoverDocument $PostgresCutoverMarker $markerValue
  Remove-Item -LiteralPath $PostgresCutoverState -Force -ErrorAction SilentlyContinue
}
function Set-PostgresRuntimeEnvironment([string]$SourceSha256 = '') {
  $env:DATABASE_PROVIDER='postgres'
  $env:POSTGRES_HOST='127.0.0.1'
  $env:POSTGRES_PORT='5432'
  $env:POSTGRES_DATABASE=$PostgresDatabase
  $env:POSTGRES_USER=$PostgresRole
  $env:POSTGRES_PASSWORD_FILE=$PostgresPasswordFile
  $env:POSTGRES_SSL='false'
  $env:POSTGRES_SCHEMA_VERSION='1'
  $env:POSTGRES_RUNTIME_SCHEMA_VERSION=[string]$PostgresRuntimeSchemaVersion
  $env:SUBSCRIPTION_ENFORCEMENT_ENABLED='true'
  if ($SourceSha256) { $env:POSTGRES_SOURCE_SHA256=$SourceSha256 } else { Remove-Item Env:POSTGRES_SOURCE_SHA256 -ErrorAction SilentlyContinue }
  # Retained as the immutable migration/rollback source. PostgreSQL is the
  # only runtime database once the cutover marker has been written.
  $env:DATABASE_PATH=$SqliteDatabasePath
}
function Initialize-PostgresCutover([string]$ProjectDir) {
  $migrator = Join-Path $ProjectDir 'scripts\migrate-sqlite-to-postgres.mjs'
  $adapter = Join-Path $ProjectDir 'backend\dist\databaseAdapter.js'
  $bootstrapper = Join-Path $ProjectDir 'scripts\bootstrap-sqlite-store.mjs'
  $verifier = Join-Path $ProjectDir 'scripts\verify-postgres-runtime.mjs'
  $postgresCapable = (Test-Path -LiteralPath $migrator -PathType Leaf) -and (Test-Path -LiteralPath $adapter -PathType Leaf) -and
    (Test-Path -LiteralPath $bootstrapper -PathType Leaf) -and (Test-Path -LiteralPath $verifier -PathType Leaf)
  $runtimeUpgradeCapable = Test-ProjectSupportsPostgresRuntimeVersion $ProjectDir $PostgresRuntimeSchemaVersion
  if (-not $postgresCapable) {
    if ((Get-PostgresCutoverMarker) -or (Get-PostgresCutoverState) -or (Get-PostgresRuntimeUpgradeMarker)) { throw 'This release predates the started PostgreSQL cutover and cannot be started safely.' }
    # Old isolated releases remain rollback-compatible with the untouched
    # SQLite source only until the PostgreSQL cutover is committed.
    $env:DATABASE_PROVIDER='sqlite'
    $env:DATABASE_PATH=$SqliteDatabasePath
    return
  }

  Initialize-Postgres
  $node = Get-Command node.exe -ErrorAction Stop
  $marker = Get-PostgresCutoverMarker
  if ($marker) {
    $runtimeUpgradeStarted = Get-PostgresRuntimeUpgradeMarker
    if (-not $runtimeUpgradeCapable) {
      if ($runtimeUpgradeStarted) { throw "PostgreSQL runtime schema $PostgresRuntimeSchemaVersion has started; this release only supports the legacy runtime schema and cannot be started." }
      # Runtime schema 2 has not started, so a legacy PostgreSQL-v1 release may
      # continue serving until a runtime-2-capable release begins the upgrade.
      Set-PostgresRuntimeEnvironment ([string]$marker.sourceSha256)
      return
    }
    Start-PostgresRuntimeUpgrade
    Invoke-PostgresRuntimeUpgrade $ProjectDir $node ([string]$marker.sourceSha256)
    Grant-PostgresRuntimePrivileges $ProjectDir
    Set-PostgresRuntimeEnvironment ([string]$marker.sourceSha256)
    $verifyOutput = @(& $node.Source $verifier --json 2>&1)
    foreach ($line in $verifyOutput) { Add-Content -LiteralPath $PostgresMigrationLog -Value ([string]$line) }
    if ($LASTEXITCODE -ne 0) { throw "The committed PostgreSQL runtime failed verification. See $PostgresMigrationLog." }
    Remove-Item -LiteralPath $PostgresCutoverState -Force -ErrorAction SilentlyContinue
    return
  }

  if (-not $runtimeUpgradeCapable) { throw 'The PostgreSQL cutover has started and requires a runtime-migration-capable release to roll forward.' }
  $state = Get-PostgresCutoverState
  $sourceSha256 = if ($state -and $state.phase -eq 'base_committed') { [string]$state.sourceSha256 } else { '' }
  if (-not $sourceSha256) {
    if (-not (Test-Path -LiteralPath $SqliteDatabasePath -PathType Leaf)) {
      $bootstrapOutput = @(& $node.Source $bootstrapper --sqlite $SqliteDatabasePath --json 2>&1)
      foreach ($line in $bootstrapOutput) { Add-Content -LiteralPath $PostgresMigrationLog -Value ([string]$line) }
      if ($LASTEXITCODE -ne 0) { throw "The empty Experience database could not be bootstrapped. See $PostgresMigrationLog." }
    }
    $backupDir = Join-Path $RuntimeDir 'backups'
    New-Item -ItemType Directory -Force $backupDir | Out-Null
    Set-PostgresCutoverState 'base_copy_started'
    Set-PostgresOwnerLogin $true
    try {
      $migrationOutput = @(& $node.Source $migrator --sqlite $SqliteDatabasePath --backup-dir $backupDir --mode migrate --pg-user $PostgresOwnerRole --pg-password-file $PostgresOwnerPasswordFile --json 2>&1)
      $migrationExitCode = $LASTEXITCODE
    } finally { Set-PostgresOwnerLogin $false }
    foreach ($line in $migrationOutput) { Add-Content -LiteralPath $PostgresMigrationLog -Value ([string]$line) }
    if ($migrationExitCode -ne 0) {
      throw "The SQLite to PostgreSQL migration failed. PostgreSQL cutover remains staged for a roll-forward retry. See $PostgresMigrationLog."
    }
    $completion = $null
    foreach ($line in $migrationOutput) {
      try {
        $event = ([string]$line) | ConvertFrom-Json
        if ($event.event -eq 'migration_complete') { $completion = $event }
      } catch { }
    }
    if (-not $completion -or [string]$completion.sourceSha256 -notmatch '^[a-f0-9]{64}$') {
      throw "The PostgreSQL migrator exited without a valid completion manifest. Cutover remains staged for a roll-forward retry. See $PostgresMigrationLog."
    }
    $sourceSha256 = [string]$completion.sourceSha256
    # This durable state is the point of no return: SQLite must never accept
    # runtime writes after the PostgreSQL base copy has committed.
    Set-PostgresCutoverState 'base_committed' $sourceSha256
  }
  Start-PostgresRuntimeUpgrade
  Invoke-PostgresRuntimeUpgrade $ProjectDir $node $sourceSha256
  Grant-PostgresRuntimePrivileges $ProjectDir
  Set-PostgresRuntimeEnvironment $sourceSha256
  $verifyOutput = @(& $node.Source $verifier --json 2>&1)
  foreach ($line in $verifyOutput) { Add-Content -LiteralPath $PostgresMigrationLog -Value ([string]$line) }
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL cutover failed runtime verification and remains staged for a roll-forward retry. See $PostgresMigrationLog." }
  Complete-PostgresCutover $sourceSha256
}
function Get-ServerProcess {
  if (-not (Test-Path -LiteralPath $PidFile)) { return $null }
  $processId = [int](Get-Content -LiteralPath $PidFile -Raw)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
  if (-not $process -or $process.Name -ne 'node.exe' -or $process.CommandLine -notlike '*backend/dist/server.js*') { Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue; return $null }
  return $process
}
function Start-Server {
  Initialize-Runtime
  if (Get-ServerProcess) { return }
  $embeddingConfiguration = Get-EmbeddingConfiguration
  Set-EmbeddingEnvironment $embeddingConfiguration
  $ProjectDir = Get-ProjectDir
  if (-not (Test-Path (Join-Path $ProjectDir 'backend\dist\server.js'))) { & npm.cmd run build --prefix $ProjectDir; if ($LASTEXITCODE -ne 0) { throw 'Experience build failed.' } }
  Initialize-PostgresCutover $ProjectDir
  $env:HOST='127.0.0.1'; $env:PORT='5410'; $env:PUBLIC_URL='https://experience.aiinnigeria.com'
  $env:ADMIN_PASSWORD_FILE=$PasswordFile; $env:SESSION_SECRET_FILE=$SessionSecretFile
  $env:BREVO_WEBHOOK_SECRET_FILE=$BrevoWebhookSecretFile
  $env:X_CREDENTIAL_ENCRYPTION_KEY_FILE=$XCredentialEncryptionKeyFile
  $env:NYLAS_CREDENTIAL_ENCRYPTION_KEY_FILE=$NylasCredentialEncryptionKeyFile
  $env:NYLAS_REDIRECT_URI='https://experience.aiinnigeria.com/api/integrations/nylas/callback'
  $nylasEnvironmentFile = Get-NylasEnvironmentFile
  if ($nylasEnvironmentFile) { $env:NYLAS_ENV_FILE=$nylasEnvironmentFile } else { Remove-Item Env:NYLAS_ENV_FILE -ErrorAction SilentlyContinue }
  $env:ESIGN_ENCRYPTION_KEY_FILE=$EsignEncryptionKeyFile; $env:ESIGN_STORAGE_DIR=$EsignStorageDir
  $env:KNOWLEDGE_STORAGE_DIR=$KnowledgeStorageDir
  $env:KNOWLEDGE_RUNTIME_BASE_URL='http://127.0.0.1:11540'
  $env:KNOWLEDGE_RUNTIME_SHARED_SECRET_FILE=$KnowledgeRuntimeSecretFile
  $env:KNOWLEDGE_WORKER_CONCURRENCY='1'
  $env:X_SEED_CONSUMER_KEY_FILE=$XConsumerKeyFile; $env:X_SEED_CONSUMER_SECRET_FILE=$XConsumerSecretFile
  $env:X_SEED_BEARER_TOKEN_FILE=$XBearerTokenFile; $env:X_SEED_ACCESS_TOKEN_FILE=$XAccessTokenFile; $env:X_SEED_ACCESS_TOKEN_SECRET_FILE=$XAccessTokenSecretFile
  $env:X_SEED_CLIENT_ID_FILE=$XClientIdFile; $env:X_SEED_CLIENT_SECRET_FILE=$XClientSecretFile
  $env:UPLOAD_DIR=(Join-Path $RuntimeDir 'uploads')
  $env:TERRA_GATEWAY_BASE_URL='http://127.0.0.1:11435'; $env:TERRA_GATEWAY_SHARED_SECRET_FILE=(Join-Path $RepositoryDir '.local-runtime\llm\service-secret')
  # The shared CRM file supplies Brevo credentials only. Experience owns its
  # sender identity so an isolated deployment cannot inherit another product's branding.
  $env:BREVO_FROM_NAME='Seemplify Experience'; $env:BREVO_FROM_EMAIL='no-reply@seemplifyai.com'
  $sharedBrevo = Join-Path (Split-Path -Parent $RepositoryDir) 'crm\Xplorer-Full-backend\.env'
  if (Test-Path -LiteralPath $sharedBrevo) { $env:BREVO_ENV_FILE=$sharedBrevo }
  $process = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @('backend/dist/server.js') -WorkingDirectory $ProjectDir -WindowStyle Hidden -RedirectStandardOutput $StdoutLog -RedirectStandardError $StderrLog -PassThru
  Set-Content -LiteralPath $PidFile -Value $process.Id -Encoding ascii
  $deadline = (Get-Date).AddSeconds(20); do { Start-Sleep -Milliseconds 400; try { if ((Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:5410/health' -TimeoutSec 2).StatusCode -eq 200) { return } } catch {} } while ((Get-Date) -lt $deadline)
  throw "Experience server did not become healthy. See $StderrLog."
}
function Stop-Server { $process = Get-ServerProcess; if ($process) { Stop-Process -Id $process.ProcessId -Force; Start-Sleep -Milliseconds 500 }; Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue }
function Set-AutoStart([bool]$Enabled) {
  if (-not $Enabled) { Remove-Item -LiteralPath $StartupShortcut -Force -ErrorAction SilentlyContinue; return }
  $shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut($StartupShortcut); $shortcut.TargetPath = 'powershell.exe'; $shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'autostart.ps1')`""; $shortcut.WorkingDirectory = $ProjectDir; $shortcut.Save()
}
function Get-Status {
  $process = Get-ServerProcess; $healthy = $false; $health = $null; $reportedDatabaseReady = $false
  $embeddingConfiguration = Get-EmbeddingConfiguration
  $knowledgeRuntimeStatus = $null
  $nylasEnvironmentFile = Get-NylasEnvironmentFile
  $nylasProcessConfigured = -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('NYLAS_CLIENT_ID')) -and -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('NYLAS_API_KEY'))
  try {
    $health = Invoke-RestMethod 'http://127.0.0.1:5410/health' -TimeoutSec 3
    $reportedDatabaseReady = if ($health.PSObject.Properties.Name -contains 'databaseReady') { [bool]$health.databaseReady } else { $health.status -eq 'ok' }
    $healthy = $health.status -eq 'ok' -and $reportedDatabaseReady
  } catch {}
  $knowledgeClient = Join-Path $RepositoryDir 'tools\local-knowledge\client.cjs'
  if ((Test-Path -LiteralPath $KnowledgeRuntimeSecretFile -PathType Leaf) -and (Test-Path -LiteralPath $knowledgeClient -PathType Leaf)) {
    try {
      $runtimeOutput = & node.exe $knowledgeClient status 2>$null
      if ($LASTEXITCODE -eq 0 -and $runtimeOutput) { $knowledgeRuntimeStatus = ($runtimeOutput | Select-Object -Last 1) | ConvertFrom-Json }
    } catch {}
  }
  $project = Get-ProjectDir
  return [ordered]@{ installed=$true; running=[bool]$process; pid=if($process){$process.ProcessId}else{$null}; healthy=$healthy; url='http://127.0.0.1:5410'; publicUrl='https://experience.aiinnigeria.com'; projectDir=$project; isolatedDeployment=($project -ne $SourceProjectDir); databaseProvider=if($health){$health.database}else{'unknown'}; databaseReady=if($health){$reportedDatabaseReady}else{$false}; databaseSchemaVersion=if($health){$health.databaseSchemaVersion}else{$null}; databaseRuntimeSchemaVersion=if($health){$health.databaseRuntimeSchemaVersion}else{$null}; postgresDatabase=$PostgresDatabase; postgresRole=$PostgresRole; postgresOwnerRole=$PostgresOwnerRole; postgresCutoverCommitted=(Test-Path $PostgresCutoverMarker); postgresCutoverStaged=(Test-Path $PostgresCutoverState); postgresRuntimeUpgradeStarted=(Test-Path $PostgresRuntimeUpgradeMarker); postgresCredentialConfigured=((Test-Path $PostgresPasswordFile) -and (Test-Path $PostgresOwnerPasswordFile)); sqliteRecoverySource=$SqliteDatabasePath; authConfigured=((Test-Path $PasswordFile) -and (Test-Path $SessionSecretFile)); brevoWebhookSecretConfigured=(Test-Path $BrevoWebhookSecretFile); xCredentialEncryptionConfigured=(Test-Path $XCredentialEncryptionKeyFile); nylasCredentialEncryptionConfigured=(Test-Path $NylasCredentialEncryptionKeyFile); nylasCredentialsConfigured=([bool]$nylasEnvironmentFile -or $nylasProcessConfigured); nylasEnvironmentSource=if($nylasEnvironmentFile){$nylasEnvironmentFile}else{$null}; esignEncryptionConfigured=(Test-Path $EsignEncryptionKeyFile); knowledgeRuntimeConfigured=(Test-Path $KnowledgeRuntimeSecretFile); knowledgeRuntimeUrl='http://127.0.0.1:11540'; knowledgeStorageDir=$KnowledgeStorageDir; embeddingConfiguration=$embeddingConfiguration; knowledgeRuntimeStatus=$knowledgeRuntimeStatus; xSeedCredentialsConfigured=((Test-Path $XConsumerKeyFile) -and (Test-Path $XConsumerSecretFile) -and (Test-Path $XBearerTokenFile)); adminEmail='admin@seemplify.local'; passwordFile=$PasswordFile; autoStart=(Test-Path $StartupShortcut); stdoutLog=$StdoutLog; stderrLog=$StderrLog }
}
switch ($Action) { 'initialize' { Initialize-Runtime; Initialize-Postgres }; 'start' { Start-Server }; 'stop' { Stop-Server }; 'restart' { Stop-Server; Start-Server }; 'enable-auto-start' { Initialize-Runtime; Initialize-Postgres; Set-AutoStart $true }; 'disable-auto-start' { Set-AutoStart $false }; 'status' {} }
$status = Get-Status; if ($Json) { $status | ConvertTo-Json -Depth 16 -Compress } else { [pscustomobject]$status | Format-List }
