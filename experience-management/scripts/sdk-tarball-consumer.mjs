import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, '..');
const packages = [
  'journey-event-protocol',
  'journey-browser-sdk',
  'journey-node',
  'journey-react',
  'journey-react-native'
];

function fail(message) {
  throw new Error(`[sdk-tarball-consumer] ${message}`);
}

/**
 * Collects every file a consumer can reach through the export map plus the
 * legacy root fields, so the tarball assertion covers each conditional target
 * rather than assuming a single ESM entry point.
 */
function entryTargets(manifest) {
  const targets = new Set();
  const walk = (value) => {
    if (typeof value === 'string') targets.add(value.replace(/^\.\//, ''));
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(manifest.exports);
  for (const field of ['main', 'module', 'types']) {
    if (typeof manifest[field] === 'string') targets.add(manifest[field].replace(/^\.\//, ''));
  }
  return [...targets].filter((target) => !target.includes('*'));
}

function run(command, arguments_, { capture = false, cwd }) {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    shell: false,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture) process.stderr.write(result.stderr || result.stdout || '');
    fail(`${path.basename(command)} ${arguments_.join(' ')} exited with ${result.status}`);
  }
  return capture ? result.stdout : '';
}

function npm(arguments_, options) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) return run(process.execPath, [npmExecPath, ...arguments_], options);
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(executable, arguments_, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: process.env,
    shell: process.platform === 'win32',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.capture) process.stderr.write(result.stderr || result.stdout || '');
    fail(`npm ${arguments_.join(' ')} exited with ${result.status}`);
  }
  return options.capture ? result.stdout : '';
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'seemplify-sdk-consumer-'));
const packDirectory = path.join(temporaryRoot, 'packs');
const consumerDirectory = path.join(temporaryRoot, 'consumer');

try {
  await mkdir(packDirectory);
  await mkdir(consumerDirectory);

  const tarballs = [];
  for (const packageDirectory of packages) {
    const stdout = npm([
      'pack',
      '.',
      '--ignore-scripts',
      '--json',
      '--silent',
      '--pack-destination',
      packDirectory
    ], {
      capture: true,
      cwd: path.join(workspaceRoot, 'packages', packageDirectory)
    });
    const result = JSON.parse(stdout);
    if (!Array.isArray(result) || result.length !== 1) fail(`${packageDirectory} produced an invalid npm pack result`);
    const packedFiles = new Set(result[0].files.map((entry) => entry.path.replaceAll('\\', '/')));
    const manifest = JSON.parse(readFileSync(
      path.join(workspaceRoot, 'packages', packageDirectory, 'package.json'),
      'utf8'
    ));
    for (const target of entryTargets(manifest)) {
      if (!packedFiles.has(target)) {
        fail(`${packageDirectory} tarball omitted the reachable export target ${target}`);
      }
    }
    if (!packedFiles.has('dist/cjs/package.json')) {
      fail(`${packageDirectory} tarball dropped the CommonJS scope marker, so require() would read dist/cjs as ESM`);
    }
    tarballs.push(path.join(packDirectory, result[0].filename));
  }

  await writeFile(path.join(consumerDirectory, 'package.json'), JSON.stringify({
    name: 'seemplify-sdk-isolated-consumer',
    version: '0.0.0',
    private: true,
    type: 'module'
  }, null, 2));

  const localDependencyDirectories = [
    path.join(workspaceRoot, 'node_modules', 'react'),
    path.join(workspaceRoot, 'node_modules', '@types', 'react'),
    path.join(workspaceRoot, 'node_modules', '@types', 'node'),
    path.join(workspaceRoot, 'node_modules', 'csstype'),
    path.join(workspaceRoot, 'node_modules', 'undici-types')
  ];
  for (const dependency of localDependencyDirectories) {
    if (!existsSync(dependency)) fail(`Required local consumer dependency is absent: ${dependency}`);
    const stdout = npm([
      'pack',
      dependency,
      '--ignore-scripts',
      '--json',
      '--silent',
      '--pack-destination',
      packDirectory
    ], { capture: true, cwd: workspaceRoot });
    const result = JSON.parse(stdout);
    if (!Array.isArray(result) || result.length !== 1) fail(`${dependency} produced an invalid npm pack result`);
    tarballs.push(path.join(packDirectory, result[0].filename));
  }

  npm([
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--offline',
    ...tarballs
  ], { cwd: consumerDirectory });

  await writeFile(path.join(consumerDirectory, 'runtime-smoke.mjs'), `
const protocol = await import('@seemplify/journey-event-protocol');
const mock = await import('@seemplify/journey-event-protocol/mock');
const browser = await import('@seemplify/journey-browser-sdk');
const node = await import('@seemplify/journey-node');
const react = await import('@seemplify/journey-react');
const reactNative = await import('@seemplify/journey-react-native');

const expected = [
  [protocol, 'validateEventEnvelope'],
  [mock, 'createMockIngestServer'],
  [browser, 'createBrowserJourneySdk'],
  [node, 'createNodeJourneySdk'],
  [node, 'createVerifiedJourneyIdentity'],
  [node, 'createJourneyRequestContextMiddleware'],
  [react, 'JourneyProvider'],
  [reactNative, 'createReactNativeJourneySdk']
];
for (const [module, name] of expected) {
  if (typeof module[name] !== 'function' && typeof module[name] !== 'object') {
    throw new Error('Missing runtime export: ' + name);
  }
}

const nodeClient = node.createNodeJourneySdk({
  serverSecret: 'invalid',
  endpoint: 'not-a-url'
});
for (const name of ['page', 'screen', 'consent', 'metric', 'importBatch']) {
  if (typeof nodeClient[name] !== 'function') throw new Error('Missing Node client method: ' + name);
}
const identity = node.createVerifiedJourneyIdentity('user_1', 'isolated_consumer');
if (!identity) throw new Error('Verified identity helper rejected a valid opaque ID');
const middleware = node.createJourneyRequestContextMiddleware({
  resolve: () => ({ identity, sessionId: 'session_1' })
});
const request = {};
await new Promise((resolve) => middleware(request, {}, resolve));
if (middleware.eventOptions(request)?.userId !== 'user_1') {
  throw new Error('Built request-context middleware lost the verified identity');
}
const mobileClient = reactNative.createReactNativeJourneySdk({
  writeKey: 'invalid',
  endpoint: 'not-a-url',
  runtime: {
    fetch: async () => { throw new Error('disabled client fetched'); },
    setTimeout: () => Object.freeze({}),
    clearTimeout: () => undefined
  }
});
await mobileClient.ready;
if (mobileClient.enabled) throw new Error('Invalid mobile configuration was enabled');
if ((await mobileClient.track('must_not_send')).status !== 'disabled') {
  throw new Error('Disabled mobile client did not fail closed');
}
console.log('isolated ESM runtime imports passed');
`);

  await writeFile(path.join(consumerDirectory, 'types-smoke.mts'), `
import { JOURNEY_EVENT_PROTOCOL_VERSION, type JourneyEventEnvelope } from '@seemplify/journey-event-protocol';
import { createMockIngestServer } from '@seemplify/journey-event-protocol/mock';
import { createBrowserJourneySdk, type BrowserJourneySdkConfig } from '@seemplify/journey-browser-sdk';
import {
  createJourneyRequestContextMiddleware,
  createNodeJourneySdk,
  createVerifiedJourneyIdentity,
  type NodeJourneySdk,
  type NodeJourneySdkConfig
} from '@seemplify/journey-node';
import { JourneyProvider, type JourneyProviderProps } from '@seemplify/journey-react';
import {
  createReactNativeJourneySdk,
  type ReactNativeJourneySdkConfig,
  type SecureJourneyStorage
} from '@seemplify/journey-react-native';

const version: '1.0' = JOURNEY_EVENT_PROTOCOL_VERSION;
const envelope = {} as JourneyEventEnvelope;
const browserConfig = {} as BrowserJourneySdkConfig;
const nodeConfig = {} as NodeJourneySdkConfig;
const nodeClient = {} as NodeJourneySdk;
const verifiedIdentity = createVerifiedJourneyIdentity('user_1', 'consumer_typecheck');
const middleware = createJourneyRequestContextMiddleware<object>({
  resolve: () => verifiedIdentity ? ({ identity: verifiedIdentity }) : undefined
});
const providerProps = {} as JourneyProviderProps;
const mobileConfig = {} as ReactNativeJourneySdkConfig;
const mobileStorage = {} as SecureJourneyStorage;
void nodeClient.page;
void nodeClient.screen;
void nodeClient.consent;
void nodeClient.metric;
void nodeClient.importBatch;
void [version, envelope, browserConfig, nodeConfig, middleware, providerProps, mobileConfig, mobileStorage, createMockIngestServer, createBrowserJourneySdk, createNodeJourneySdk, JourneyProvider, createReactNativeJourneySdk];
`);

  await writeFile(path.join(consumerDirectory, 'runtime-smoke.cjs'), `
const assert = require('node:assert/strict');

console.log('CommonJS consumer executing on Node ' + process.version);

const specifiers = [
  '@seemplify/journey-event-protocol',
  '@seemplify/journey-event-protocol/mock',
  '@seemplify/journey-browser-sdk',
  '@seemplify/journey-node',
  '@seemplify/journey-react',
  '@seemplify/journey-react-native'
];

const loaded = new Map();
for (const name of specifiers) {
  const resolved = require.resolve(name).split('\\\\').join('/');
  // Decisive check. Node >= 20.19 can require() an ES module without throwing,
  // so a callable export proves nothing about which target was actually chosen.
  assert.match(resolved, /\\/dist\\/cjs\\//, name + ' did not resolve to the CommonJS build: ' + resolved);
  const value = require(name);
  // require(esm) returns a module namespace object, which is tagged 'Module'.
  assert.notStrictEqual(value[Symbol.toStringTag], 'Module', name + ' silently resolved to the ES module build');
  loaded.set(name, value);
}

const protocol = loaded.get('@seemplify/journey-event-protocol');
const mock = loaded.get('@seemplify/journey-event-protocol/mock');
const browser = loaded.get('@seemplify/journey-browser-sdk');
const node = loaded.get('@seemplify/journey-node');
const react = loaded.get('@seemplify/journey-react');
const reactNative = loaded.get('@seemplify/journey-react-native');

const expected = [
  [protocol, 'validateEventEnvelope'],
  [protocol, 'JOURNEY_EVENT_PROTOCOL_VERSION'],
  [mock, 'createMockIngestServer'],
  [browser, 'createBrowserJourneySdk'],
  [node, 'createNodeJourneySdk'],
  [node, 'createVerifiedJourneyIdentity'],
  [node, 'createJourneyRequestContextMiddleware'],
  [react, 'JourneyProvider'],
  [reactNative, 'createReactNativeJourneySdk']
];
for (const entry of expected) {
  const type = typeof entry[0][entry[1]];
  if (type !== 'function' && type !== 'object' && type !== 'string') {
    throw new Error('Missing CommonJS runtime export: ' + entry[1]);
  }
}

async function main() {
  // Proves the generated CommonJS interop shim is correct. mockIngestServer.ts
  // default-imports node:http and node:crypto, which emit as <ns>.default.<fn>
  // only when esModuleInterop is on; without the shim createServer and
  // createHash both throw TypeError at call time. The server binds loopback
  // (127.0.0.1, ephemeral port) and is closed immediately.
  const server = mock.createMockIngestServer();
  if (server.isDurable !== false || server.productionSafe !== false) {
    throw new Error('Mock ingest server lost its non-durable safety signals');
  }
  const origin = await server.listen();
  try {
    const response = await fetch(origin + '/not-an-ingest-route', { method: 'POST' });
    assert.equal(response.status, 404);
    const payload = await response.json();
    assert.match(payload.error.requestId, /^mock_[0-9a-f]{20}$/, 'crypto default-import interop is broken in the CommonJS build');
  } finally {
    await server.close();
  }

  const nodeClient = node.createNodeJourneySdk({ serverSecret: 'invalid', endpoint: 'not-a-url' });
  for (const name of ['page', 'screen', 'consent', 'metric', 'importBatch']) {
    if (typeof nodeClient[name] !== 'function') throw new Error('Missing Node client method: ' + name);
  }

  const mobileClient = reactNative.createReactNativeJourneySdk({
    writeKey: 'invalid',
    endpoint: 'not-a-url',
    runtime: {
      fetch: async () => { throw new Error('disabled client fetched'); },
      setTimeout: () => Object.freeze({}),
      clearTimeout: () => undefined
    }
  });
  await mobileClient.ready;
  if (mobileClient.enabled) throw new Error('Invalid mobile configuration was enabled');
  if ((await mobileClient.track('must_not_send')).status !== 'disabled') {
    throw new Error('Disabled mobile client did not fail closed');
  }

  console.log('isolated CommonJS runtime requires passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
`);

  await writeFile(path.join(consumerDirectory, 'mixed-format-smoke.mjs'), `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// A dual package can be loaded in both formats inside one host graph. These are
// genuinely separate module instances, so any module-scoped singleton would be
// duplicated. journey-node's verified-identity set is the sharp case: a split
// set makes the middleware reject a legitimate identity and silently drop
// userId from every event.
const esm = await import('@seemplify/journey-node');
const cjs = require('@seemplify/journey-node');
assert.notStrictEqual(
  esm.createVerifiedJourneyIdentity,
  cjs.createVerifiedJourneyIdentity,
  'ESM and CommonJS resolved to the same module instance, so this test proves nothing'
);

async function resolveUserId(middlewareOwner, identity) {
  const middleware = middlewareOwner.createJourneyRequestContextMiddleware({
    resolve: () => ({ identity })
  });
  const request = {};
  await new Promise((resolve) => middleware(request, {}, resolve));
  return middleware.eventOptions(request)?.userId;
}

const fromCjs = cjs.createVerifiedJourneyIdentity('user_cjs', 'mixed_format_consumer');
assert.equal(await resolveUserId(esm, fromCjs), 'user_cjs', 'ESM middleware rejected a CommonJS-minted verified identity');

const fromEsm = esm.createVerifiedJourneyIdentity('user_esm', 'mixed_format_consumer');
assert.equal(await resolveUserId(cjs, fromEsm), 'user_esm', 'CommonJS middleware rejected an ESM-minted verified identity');

// An unmarked object must still be rejected by both copies; sharing state must
// not weaken the check into "any object with a userId".
assert.equal(await resolveUserId(esm, { userId: 'spoofed', verificationMethod: 'none' }), undefined);
assert.equal(await resolveUserId(cjs, { userId: 'spoofed', verificationMethod: 'none' }), undefined);

// journey-react keeps its client leases in the same versioned global. Its
// registry is internal, so this asserts only that both formats load as distinct
// instances (the precondition for the hazard) alongside the proven journey-node
// mechanism they share.
const reactEsm = await import('@seemplify/journey-react');
const reactCjs = require('@seemplify/journey-react');
assert.notStrictEqual(reactEsm.JourneyProvider, reactCjs.JourneyProvider);

console.log('mixed ESM + CommonJS graph shares verified-identity state');
`);

  await writeFile(path.join(consumerDirectory, 'types-smoke.cts'), `
import { JOURNEY_EVENT_PROTOCOL_VERSION, type JourneyEventEnvelope } from '@seemplify/journey-event-protocol';
import { createMockIngestServer } from '@seemplify/journey-event-protocol/mock';
import { createBrowserJourneySdk, type BrowserJourneySdkConfig } from '@seemplify/journey-browser-sdk';
import {
  createJourneyRequestContextMiddleware,
  createNodeJourneySdk,
  createVerifiedJourneyIdentity,
  type NodeJourneySdk,
  type NodeJourneySdkConfig
} from '@seemplify/journey-node';
import { JourneyProvider, type JourneyProviderProps } from '@seemplify/journey-react';
import {
  createReactNativeJourneySdk,
  type ReactNativeJourneySdkConfig,
  type SecureJourneyStorage
} from '@seemplify/journey-react-native';

const version: '1.0' = JOURNEY_EVENT_PROTOCOL_VERSION;
const envelope = {} as JourneyEventEnvelope;
const browserConfig = {} as BrowserJourneySdkConfig;
const nodeConfig = {} as NodeJourneySdkConfig;
const nodeClient = {} as NodeJourneySdk;
const verifiedIdentity = createVerifiedJourneyIdentity('user_1', 'consumer_typecheck');
const middleware = createJourneyRequestContextMiddleware<object>({
  resolve: () => verifiedIdentity ? ({ identity: verifiedIdentity }) : undefined
});
const providerProps = {} as JourneyProviderProps;
const mobileConfig = {} as ReactNativeJourneySdkConfig;
const mobileStorage = {} as SecureJourneyStorage;
void nodeClient.page;
void nodeClient.importBatch;
void [version, envelope, browserConfig, nodeConfig, middleware, providerProps, mobileConfig, mobileStorage, createMockIngestServer, createBrowserJourneySdk, createNodeJourneySdk, JourneyProvider, createReactNativeJourneySdk];
`);

  run(process.execPath, ['runtime-smoke.mjs'], { cwd: consumerDirectory });
  run(process.execPath, ['runtime-smoke.cjs'], { cwd: consumerDirectory });
  run(process.execPath, ['mixed-format-smoke.mjs'], { cwd: consumerDirectory });
  run(process.execPath, [
    path.join(workspaceRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--noEmit',
    '--strict',
    '--skipLibCheck',
    '--target',
    'ES2022',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    // Compiled together on purpose: NodeNext derives the module format from the
    // extension, so the .mts file exercises the import-condition declarations
    // and the .cts file exercises the require-condition declarations. A single
    // top-level "types" key would hand CommonJS the ESM declarations and fail
    // here rather than shipping the dual-package types hazard.
    'types-smoke.mts',
    'types-smoke.cts'
  ], { cwd: consumerDirectory });
  npm(['ls', '--depth=1'], { cwd: consumerDirectory });

  console.log(`isolated tarball consumer passed for ${packages.length} SDK packages`);
} finally {
  if (process.env.SDK_KEEP_CONSUMER_TEMP === '1') {
    console.log(`retained SDK consumer fixture at ${temporaryRoot}`);
  } else {
    const resolvedTemporaryRoot = path.resolve(temporaryRoot);
    const resolvedSystemTemp = path.resolve(os.tmpdir());
    if (!resolvedTemporaryRoot.startsWith(`${resolvedSystemTemp}${path.sep}`)
      || !path.basename(resolvedTemporaryRoot).startsWith('seemplify-sdk-consumer-')) {
      fail(`Refusing to remove unexpected temporary path: ${resolvedTemporaryRoot}`);
    }
    await rm(resolvedTemporaryRoot, { recursive: true, force: true });
  }
}
