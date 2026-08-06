import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, '..');
const packageDirectory = path.join(workspaceRoot, 'packages', 'journey-react-native');
const entry = path.join(packageDirectory, 'dist', 'index.js');

function fail(message) {
  throw new Error(`[sdk-react-native-compatibility] ${message}`);
}

if (!existsSync(entry)) fail('React Native SDK dist is absent; run its clean build first.');

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'seemplify-react-native-sdk-'));
const bundle = path.join(temporaryRoot, 'journey-react-native-sdk.mjs');
const hostTest = path.join(temporaryRoot, 'restricted-host.mjs');
const assertions = path.join(temporaryRoot, 'assertions.cjs');
const specifier = '@seemplify/journey-react-native';

/**
 * Metro resolves `require` before `import`, so the CommonJS target is the one a
 * real React Native app is most likely to load. Resolving by specifier exercises
 * the export map itself rather than a hard-coded dist path.
 *
 * `resolveDir` is the package's own directory so the specifier resolves through
 * package self-reference, which reads the same `exports` map an external
 * consumer would. Resolving from the workspace root instead would depend on a
 * hoisted `node_modules/@seemplify/*` install link, which silently turns this
 * gate red or green based on install topology rather than on the export map.
 * Real external resolution is proven separately by the tarball consumer gate.
 */
async function bundleFromExportMap({ outfile, format, conditions }) {
  const result = await build({
    stdin: {
      contents: `export * from '${specifier}';`,
      resolveDir: packageDirectory,
      loader: 'js'
    },
    outfile,
    bundle: true,
    format,
    platform: 'neutral',
    conditions,
    target: 'es2022',
    treeShaking: true,
    metafile: true,
    sourcemap: false,
    logLevel: 'silent'
  });
  const inputs = Object.keys(result.metafile.inputs).map((file) => file.replaceAll('\\', '/'));
  const sdkInputs = inputs.filter((file) => file.includes('/journey-react-native/dist/'));
  if (!sdkInputs.length) fail(`Export-map resolution for ${conditions.join('+')} pulled in no React Native dist file.`);
  const commonjs = sdkInputs.filter((file) => file.includes('/dist/cjs/'));
  if (format === 'cjs' && commonjs.length !== sdkInputs.length) {
    fail(`The require condition resolved to the ES module build: ${sdkInputs.join(', ')}`);
  }
  if (format === 'esm' && commonjs.length) {
    fail(`The import condition resolved to the CommonJS build: ${commonjs.join(', ')}`);
  }
  return result;
}

try {
  const result = await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    conditions: ['react-native', 'import', 'default'],
    target: 'es2022',
    treeShaking: true,
    metafile: true,
    sourcemap: false,
    logLevel: 'silent'
  });
  const source = await readFile(bundle, 'utf8');
  const prohibited = [
    { name: 'Node built-in import', pattern: /(?:from\s*|import\s*)["']node:/u },
    { name: 'CommonJS require', pattern: /\brequire\s*\(/u },
    { name: 'Node Buffer', pattern: /\bBuffer\b/u },
    { name: 'Node process', pattern: /\bprocess\.(?:env|versions|platform)\b/u },
    { name: 'DOM window', pattern: /\bwindow\b/u },
    { name: 'DOM document', pattern: /\bdocument\b/u },
    { name: 'browser navigator', pattern: /\bnavigator\b/u },
    { name: 'browser storage', pattern: /\b(?:localStorage|sessionStorage|indexedDB)\b/u },
    { name: 'implicit AsyncStorage', pattern: /\bAsyncStorage\b/u },
    { name: 'eval', pattern: /\beval\s*\(/u },
    { name: 'dynamic Function constructor', pattern: /\bnew\s+Function\b/u }
  ];
  for (const check of prohibited) {
    if (check.pattern.test(source)) fail(`ES2022 React Native bundle contains ${check.name}.`);
  }

  await writeFile(assertions, `
const assert = require('node:assert/strict');

/**
 * Shared by the ESM and CommonJS harnesses so both formats are held to exactly
 * the same host-isolation contract instead of drifting apart.
 */
module.exports = async function assertRestrictedHostIsolation(sdk) {
assert.equal(typeof sdk.createReactNativeJourneySdk, 'function');

const disabled = sdk.createReactNativeJourneySdk({
  writeKey: 'invalid',
  endpoint: 'not-a-url',
  runtime: {
    setTimeout() { throw new Error('timer unavailable'); },
    clearTimeout() {}
  }
});
await disabled.ready;
assert.equal(disabled.enabled, false);
assert.equal((await disabled.track('host_must_survive')).status, 'disabled');
assert.equal((await disabled.flush()).status, 'disabled');
await disabled.destroy();

const storage = {
  security: { encryptedAtRest: true, atomicCommit: true },
  read() { throw new Error('secure store unavailable'); },
  commit() { throw new Error('secure store unavailable'); },
  remove() { throw new Error('secure store unavailable'); }
};
const isolated = sdk.createReactNativeJourneySdk({
  writeKey: 'jpk_dev.mobile_compat.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  endpoint: 'https://ingest.example.test',
  storage,
  consent: {
    analytics: 'granted',
    source: 'local_compatibility',
    updatedAt: '2026-08-04T12:00:00.000Z'
  },
  environment: 'development',
  debug: true,
  callbacks: {
    onOutcome() { throw new Error('host callback failed'); },
    onDiagnostic() { throw new Error('host callback failed'); }
  },
  runtime: {
    fetch: async () => { throw new Error('transport unavailable'); },
    now: () => Date.parse('2026-08-04T12:00:00.000Z'),
    random: () => 0.5,
    setTimeout: () => Object.freeze({}),
    clearTimeout: () => undefined
  }
});
await isolated.ready;
assert.equal(isolated.enabled, false);
assert.equal(isolated.status().persistence, 'unavailable');
assert.equal((await isolated.track('must_not_fallback')).status, 'disabled');
await isolated.destroy();
};
`);

  const restrictedGlobals = `
for (const name of [
  'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'indexedDB',
  'fetch', 'AbortController', 'crypto'
]) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() { throw new Error('restricted host denied ' + name); }
  });
}
`;

  await writeFile(hostTest, `
import { createRequire } from 'node:module';
const assertRestrictedHostIsolation = createRequire(import.meta.url)('./assertions.cjs');
${restrictedGlobals}
const sdk = await import(${JSON.stringify(pathToFileURL(bundle).href)});
await assertRestrictedHostIsolation(sdk);
console.log('restricted React Native host and secure-storage failure isolation passed (ESM)');
`);

  function runHost(file, label) {
    const child = spawnSync(process.execPath, [file], {
      cwd: temporaryRoot,
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (child.error) throw child.error;
    if (child.status !== 0) {
      process.stderr.write(child.stderr || child.stdout || '');
      fail(`${label} restricted-host test exited with ${child.status}`);
    }
    return child.stdout;
  }

  const esmHostOutput = runHost(hostTest, 'ESM');

  const output = Object.values(result.metafile.outputs)[0];
  if (!output || output.bytes <= 0) fail('React Native build produced no output.');
  console.log(`React-Native-resolvable ES2022 ESM bundle passed (${output.bytes} bytes; no public size budget ratified)`);
  process.stdout.write(esmHostOutput);

  const esmByExports = await bundleFromExportMap({
    outfile: path.join(temporaryRoot, 'exports-esm.mjs'),
    format: 'esm',
    conditions: ['react-native', 'import', 'default']
  });
  const esmExportBytes = Object.values(esmByExports.metafile.outputs)[0].bytes;

  const cjsBundle = path.join(temporaryRoot, 'exports-cjs.cjs');
  const cjsByExports = await bundleFromExportMap({
    outfile: cjsBundle,
    format: 'cjs',
    conditions: ['react-native', 'require', 'default']
  });
  const cjsExportBytes = Object.values(cjsByExports.metafile.outputs)[0].bytes;

  // `require(` is legitimate in a CommonJS bundle, so it is scoped out here;
  // every DOM, Node and dynamic-code restriction still applies.
  const cjsSource = await readFile(cjsBundle, 'utf8');
  for (const check of prohibited.filter((entry) => entry.name !== 'CommonJS require')) {
    if (check.pattern.test(cjsSource)) fail(`ES2022 React Native CommonJS bundle contains ${check.name}.`);
  }

  const cjsHostTest = path.join(temporaryRoot, 'restricted-host.cjs');
  await writeFile(cjsHostTest, `
const assertRestrictedHostIsolation = require('./assertions.cjs');
${restrictedGlobals}
const sdk = require(${JSON.stringify(cjsBundle)});
assertRestrictedHostIsolation(sdk)
  .then(() => console.log('restricted React Native host and secure-storage failure isolation passed (CommonJS)'))
  .catch((error) => { console.error(error); process.exit(1); });
`);
  process.stdout.write(runHost(cjsHostTest, 'CommonJS'));
  console.log(`React Native export map resolves both conditions (import ${esmExportBytes} bytes, require ${cjsExportBytes} bytes; no public size budget ratified)`);
} finally {
  const resolved = path.resolve(temporaryRoot);
  const systemTemp = path.resolve(os.tmpdir());
  if (!resolved.startsWith(`${systemTemp}${path.sep}`)
    || !path.basename(resolved).startsWith('seemplify-react-native-sdk-')) {
    fail(`Refusing to remove unexpected temporary path: ${resolved}`);
  }
  await rm(resolved, { recursive: true, force: true });
}
