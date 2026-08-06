import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, '..');
const packageRoot = path.join(root, 'packages', 'journey-swift');
const sourceRoot = path.join(packageRoot, 'Sources', 'SeemplifyJourney');
const testRoot = path.join(packageRoot, 'Tests', 'SeemplifyJourneyTests');
const protocolRoot = path.join(root, 'packages', 'journey-event-protocol');
const workflow = path.resolve(root, '..', '.github', 'workflows', 'journey-swift-ci.yml');

function fail(message) { throw new Error(`[sdk-swift-contract] ${message}`); }
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
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) fail(`Symbolic links are not permitted in the Swift package: ${absolute}`);
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
      : Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]))
    : value;
  return JSON.stringify(stable(JSON.parse(read(left)))) === JSON.stringify(stable(JSON.parse(read(right))));
}
for (const relative of [
  'Package.swift',
  'README.md',
  'CHANGELOG.md',
  'Examples/Basic/main.swift',
  'Sources/SeemplifyJourney/JourneyTypes.swift',
  'Sources/SeemplifyJourney/JourneyProtocol.swift',
  'Sources/SeemplifyJourney/JourneyRuntime.swift',
  'Sources/SeemplifyJourney/JourneyStorage.swift',
  'Sources/SeemplifyJourney/AppleProtectedJourneyStore.swift',
  'Sources/SeemplifyJourney/JourneyConfiguration.swift',
  'Sources/SeemplifyJourney/JourneyClient.swift',
  'Tests/SeemplifyJourneyTests/JourneyClientTests.swift',
  'Tests/SeemplifyJourneyTests/TestDoubles.swift'
]) {
  const absolute = path.join(packageRoot, relative);
  if (!existsSync(absolute) || !lstatSync(absolute).isFile()) fail(`Missing package file: ${relative}`);
}

const manifest = read(path.join(packageRoot, 'Package.swift'));
requireText(manifest, '// swift-tools-version: 5.10', 'pinned Swift tools version');
requireText(manifest, '.iOS(.v15)', 'iOS deployment target');
requireText(manifest, '.macOS(.v12)', 'macOS deployment target');
requireText(manifest, '.library(name: "SeemplifyJourney"', 'library product');
reject(manifest, /\.binaryTarget|url:\s*["']|\.package\s*\(/u, 'remote or binary dependency');

const swiftFiles = filesBelow(sourceRoot).filter((file) => file.endsWith('.swift'));
const sources = swiftFiles.map((file) => read(file)).join('\n');
reject(sources, /\bserverSecret\b|\bjsk_(?:dev|stg|live)\b/iu, 'server credential surface');
reject(sources, /\bUserDefaults\b|NSUbiquitousKeyValueStore|\.write\([^\n]*withoutOverwriting/u, 'unprotected persistence fallback');
reject(sources, /\bprint\s*\(|\bdebugPrint\s*\(|\bNSLog\s*\(|fatalError\s*\(|preconditionFailure\s*\(/u, 'runtime logging or process trap');
reject(sources, /localizedDescription|String\s*\(\s*describing:\s*error/u, 'exception text in diagnostics');

const schema = JSON.parse(read(path.join(protocolRoot, 'schemas', 'v1', 'event-envelope.schema.json')));
const batchSchema = JSON.parse(read(path.join(protocolRoot, 'schemas', 'v1', 'event-batch.schema.json')));
const protocol = read(path.join(sourceRoot, 'JourneyProtocol.swift'));
requireText(protocol, `public static let version = "${schema.properties.protocolVersion.const}"`, 'canonical protocol version');
requireText(protocol, `public static let maximumBatchEvents = ${batchSchema.properties.events.maxItems}`, 'canonical batch count');
requireText(protocol, 'public static let maximumBatchBytes = 512 * 1024', 'canonical batch bytes');
requireText(protocol, 'public static let maximumEnvelopeBytes = 64 * 1024', 'canonical envelope bytes');
for (const call of schema.properties.call.enum) requireText(read(path.join(sourceRoot, 'JourneyTypes.swift')), call, `wire call ${call}`);
for (const key of schema.required) requireText(read(path.join(sourceRoot, 'JourneyTypes.swift')), `public var ${key}:`, `envelope field ${key}`);

const client = read(path.join(sourceRoot, 'JourneyClient.swift'));
for (const method of ['track(', 'metric(', 'identify(', 'alias(', 'group(', 'page(', 'screen(', 'consent(', 'reset()', 'flush()']) {
  requireText(client, method, `public client API ${method}`);
}
for (const behavior of [
  'ANALYTICS_CONSENT_NOT_GRANTED', 'SECURE_STORAGE_FAIL_CLOSED', 'EVENT_ID_CONFLICT',
  'RETRY_SCHEDULED', 'DUPLICATE_ACCEPTED', 'retry-after', 'network_reconnect', 'background'
]) requireText(client, behavior, `runtime behavior ${behavior}`);
requireText(client, 'authorization": "Bearer', 'public write-key request header');
requireText(client, '^jpk_(dev|stg|live)', 'canonical public write-key grammar');
reject(client, /\^sp_|sp_test_|sp_live_/u, 'legacy public write-key grammar');

const store = read(path.join(sourceRoot, 'AppleProtectedJourneyStore.swift'));
for (const primitive of [
  'AES.GCM.seal', 'AES.GCM.open', 'SecItemCopyMatching', 'SecItemAdd',
  'kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly', '.atomic',
  '.completeFileProtectionUntilFirstUserAuthentication'
]) requireText(store, primitive, `Apple secure-store primitive ${primitive}`);

for (const fixture of [
  'track.json', 'identify.json', 'alias.json', 'group.json', 'page.json',
  'screen.json', 'consent.json', 'metric.json', 'batch.json', 'batch-result.json'
]) {
  const copied = path.join(testRoot, 'Fixtures', fixture);
  const canonical = path.join(protocolRoot, 'fixtures', 'v1', 'valid', fixture);
  if (!equivalentJson(copied, canonical)) fail(`Swift fixture drifted from canonical protocol fixture: ${fixture}`);
}

const tests = read(path.join(testRoot, 'JourneyClientTests.swift'));
for (const category of [
  'CanonicalFixtures', 'PublicKeyOnly', 'ConsentGatesPersistence', 'OfflineReconnect',
  'PartialResults', 'RetryAfter', 'CorruptAndUnsupported', 'FailingSecureStore', 'HostLifecycleAndTransportFailures'
]) requireText(tests, `test${category}`, `test category ${category}`);

if (!existsSync(workflow)) fail('Missing pinned, non-publishing macOS Swift workflow');
const workflowSource = read(workflow);
requireText(workflowSource, 'runs-on: macos-14', 'pinned macOS runner');
requireText(workflowSource, '/Applications/Xcode_15.4.app/Contents/Developer', 'pinned Xcode toolchain');
requireText(workflowSource, 'swift test --package-path experience-management/packages/journey-swift', 'Swift package tests');
reject(workflowSource, /\bpublish\b|npm\s+publish|swift\s+package\s+archive-source|create-release|upload-artifact/iu, 'publication or release step');

const digest = createHash('sha256');
for (const file of filesBelow(packageRoot)) {
  digest.update(path.relative(packageRoot, file).replaceAll('\\', '/'));
  digest.update('\0');
  digest.update(readFileSync(file));
  digest.update('\0');
}
console.log(`Swift protocol/static contract passed (${swiftFiles.length} runtime files; package sha256 ${digest.digest('hex')}).`);
console.log('Swift compilation and runtime tests are not claimed by this Windows static check.');
