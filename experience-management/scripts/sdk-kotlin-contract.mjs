import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, '..');
const packageRoot = path.join(root, 'packages', 'journey-kotlin');
const canonicalRoot = path.join(root, 'packages', 'journey-event-protocol', 'fixtures', 'v1', 'valid');

function fail(message) { throw new Error(`[sdk-kotlin-contract] ${message}`); }
function read(file) { return readFileSync(file, 'utf8').replaceAll('\r\n', '\n'); }
function requireText(source, value, description = value) {
  if (!source.includes(value)) fail(`Missing ${description}`);
}
function reject(source, pattern, description) {
  if (pattern.test(source)) fail(`Prohibited ${description}`);
}
function filesBelow(directory) {
  const result = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'build' || entry.name === '.gradle') continue;
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) fail(`Symbolic links are not permitted in the Kotlin package: ${absolute}`);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) result.push(absolute);
    }
  };
  visit(directory);
  return result.sort();
}
function equivalentJson(left, right) {
  const stable = (value) => value && typeof value === 'object'
    ? Array.isArray(value)
      ? value.map(stable)
      : Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]))
    : value;
  return JSON.stringify(stable(JSON.parse(read(left)))) === JSON.stringify(stable(JSON.parse(read(right))));
}

for (const relative of [
  'settings.gradle.kts',
  'build.gradle.kts',
  'gradlew',
  'gradlew.bat',
  'gradle/wrapper/gradle-wrapper.jar',
  'gradle/wrapper/gradle-wrapper.properties',
  'README.md',
  'SUPPORT.md',
  'RELEASE.md',
  'CHANGELOG.md',
  'scripts/verify-windows.ps1',
  'ci/github-actions.yml.disabled',
  'examples/android/JourneyApplication.kt',
  'src/main/kotlin/com/seemplify/journey/Protocol.kt',
  'src/main/kotlin/com/seemplify/journey/Runtime.kt',
  'src/main/kotlin/com/seemplify/journey/JourneyClient.kt',
  'src/main/kotlin/com/seemplify/journey/Privacy.kt',
  'src/main/kotlin/com/seemplify/journey/http/UrlConnectionJourneyHttpClient.kt',
  'src/main/kotlin/com/seemplify/journey/android/AndroidJourneyHooks.kt',
  'src/main/kotlin/com/seemplify/journey/android/AndroidKeystoreQueueStore.kt',
  'src/test/kotlin/com/seemplify/journey/JourneyClientTest.kt',
  'src/test/kotlin/com/seemplify/journey/ProtocolFixtureTest.kt',
  'src/androidTest/kotlin/com/seemplify/journey/android/AndroidKeystoreQueueStoreInstrumentedTest.kt',
]) {
  const absolute = path.join(packageRoot, relative);
  if (!existsSync(absolute) || !lstatSync(absolute).isFile()) fail(`Missing package file: ${relative}`);
}

const build = read(path.join(packageRoot, 'build.gradle.kts'));
for (const pin of [
  'id("com.android.library") version "8.7.3"',
  'id("org.jetbrains.kotlin.android") version "2.0.21"',
  'compileSdk = 35',
  'minSdk = 23',
  'version = "0.1.0-foundation"',
  'tasks.withType<AbstractPublishToMaven>().configureEach',
  'enabled = false',
  'verifyCanonicalFixtures',
  'verifyUnreleased',
]) requireText(build, pin, `Gradle contract ${pin}`);
reject(build, /maven\s*\{\s*(?:name|url)|signing\s*\{/u, 'configured remote publication or signing');

const wrapperProperties = read(path.join(packageRoot, 'gradle', 'wrapper', 'gradle-wrapper.properties'));
requireText(wrapperProperties, 'gradle-8.10.2-bin.zip', 'pinned Gradle distribution');
requireText(wrapperProperties, 'distributionSha256Sum=31c55713e40233a8303827ceb42ca48a47267a0ad4bab9177123121e71524c26', 'Gradle distribution checksum');
const wrapperDigest = createHash('sha256')
  .update(readFileSync(path.join(packageRoot, 'gradle', 'wrapper', 'gradle-wrapper.jar')))
  .digest('hex');
if (wrapperDigest !== '2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046') {
  fail(`Unexpected Gradle wrapper JAR sha256: ${wrapperDigest}`);
}

const protocol = read(path.join(packageRoot, 'src', 'main', 'kotlin', 'com', 'seemplify', 'journey', 'Protocol.kt'));
requireText(protocol, 'JOURNEY_PROTOCOL_VERSION: String = "1.0"', 'canonical protocol version');
for (const call of ['track', 'identify', 'alias', 'group', 'page', 'screen', 'consent', 'metric']) {
  requireText(protocol, `"${call}"`, `canonical call ${call}`);
}

const client = read(path.join(packageRoot, 'src', 'main', 'kotlin', 'com', 'seemplify', 'journey', 'JourneyClient.kt'));
for (const api of ['track(', 'identify(', 'alias(', 'group(', 'page(', 'screen(', 'consent(', 'metric(', 'reset()', 'flush()', 'status()']) {
  requireText(client, api, `client API ${api}`);
}
for (const behavior of [
  'ANALYTICS_CONSENT_NOT_GRANTED', 'SECURE_STORAGE_COMMIT_FAILED', 'EVENT_ID_CONFLICT',
  'PRECONSENT_BUFFER_FULL', 'RETRY_EXHAUSTED', 'retry-after', 'SIZING_BATCH_ID',
]) requireText(client, behavior, `runtime behavior ${behavior}`);
requireText(client, '"authorization" to "Bearer', 'public write-key authorization');
requireText(client, '^jpk_(dev|stg|live)', 'canonical public write-key grammar');
reject(client, /\^sp_|sp_test_|sp_live_/u, 'legacy public write-key grammar');
reject(client, /println\s*\(|printStackTrace\s*\(|\.message\b|toString\s*\(\s*failure/u, 'runtime logging or exception text');

const runtime = read(path.join(packageRoot, 'src', 'main', 'kotlin', 'com', 'seemplify', 'journey', 'Runtime.kt'));
for (const injection of ['JourneyHttpClient', 'JourneyClock', 'JourneyIdGenerator', 'JourneyRandom', 'JourneyDelay']) {
  requireText(runtime, injection, `injectable ${injection}`);
}

const secureStore = read(path.join(packageRoot, 'src', 'main', 'kotlin', 'com', 'seemplify', 'journey', 'android', 'AndroidKeystoreQueueStore.kt'));
for (const primitive of ['AndroidKeyStore', 'AES/GCM/NoPadding', 'AtomicFile', 'noBackupFilesDir', 'stream.fd.sync()', 'failWrite']) {
  requireText(secureStore, primitive, `secure-store primitive ${primitive}`);
}
reject(secureStore, /SharedPreferences|SQLite|MODE_WORLD|Cipher\.getInstance\("AES"\)/u, 'plaintext or weak storage fallback');

for (const fixture of [
  'track.json', 'identify.json', 'alias.json', 'group.json', 'page.json',
  'screen.json', 'consent.json', 'metric.json', 'batch.json', 'batch-result.json',
]) {
  const local = path.join(packageRoot, 'src', 'test', 'resources', 'protocol', 'v1', 'valid', fixture);
  const canonical = path.join(canonicalRoot, fixture);
  if (!equivalentJson(local, canonical)) fail(`Kotlin fixture drifted from canonical protocol fixture: ${fixture}`);
}

const tests = read(path.join(packageRoot, 'src', 'test', 'kotlin', 'com', 'seemplify', 'journey', 'JourneyClientTest.kt'));
for (const category of [
  'buffers before consent', 'invalid consent cannot mutate', 'preserves IDs through partial receipts',
  'batch sizing does not consume real IDs', 'bounds duplicate queue', 'hydrates secure state',
  'contains transport adapter lifecycle network and diagnostic host failures',
]) requireText(tests, category, `test category ${category}`);

const ci = read(path.join(packageRoot, 'ci', 'github-actions.yml.disabled'));
requireText(ci, 'permissions:\n  contents: read', 'read-only CI permissions');
requireText(ci, 'verifyUnreleased', 'CI unreleased guard');
for (const line of ci.split('\n').filter((value) => value.trim().startsWith('- uses:'))) {
  if (!/@[0-9a-f]{40}(?:\s|$)/u.test(line)) fail(`CI action is not pinned to a commit: ${line.trim()}`);
}
reject(ci, /\bpublish\b|mavenCentral|plugins\.gradle\.org|ossrh|signing|secrets\./iu, 'CI publication, signing, or secret use');

const digest = createHash('sha256');
for (const file of filesBelow(packageRoot)) {
  digest.update(path.relative(packageRoot, file).replaceAll('\\', '/'));
  digest.update('\0');
  digest.update(readFileSync(file));
  digest.update('\0');
}
console.log(`Kotlin protocol/static contract passed (package sha256 ${digest.digest('hex')}).`);
console.log('Gradle compilation, JVM tests, lint, artifacts, and Android instrumentation are separate gates.');
