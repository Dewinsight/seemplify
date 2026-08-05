import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, '..');
const packageDirectory = path.join(workspaceRoot, 'packages', 'journey-browser-sdk');
const entry = path.join(packageDirectory, 'dist', 'index.js');

function fail(message) {
  throw new Error(`[sdk-browser-compatibility] ${message}`);
}

if (!existsSync(entry)) fail('Browser SDK dist is absent; run its clean build first.');

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'seemplify-browser-sdk-'));
const bundle = path.join(temporaryRoot, 'journey-browser-sdk.mjs');
const hostTest = path.join(temporaryRoot, 'restricted-host.mjs');
const assertions = path.join(temporaryRoot, 'assertions.cjs');
const specifier = '@seemplify/journey-browser-sdk';

/**
 * The absolute-path bundle above proves the emitted ESM is browser-safe but
 * never consults the export map. These passes resolve the package by specifier
 * so each conditional target is exercised the way a bundler would select it,
 * and the metafile is checked to confirm which tree was actually pulled in.
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
    platform: 'browser',
    conditions,
    target: 'es2022',
    treeShaking: true,
    metafile: true,
    sourcemap: false,
    logLevel: 'silent'
  });
  const inputs = Object.keys(result.metafile.inputs).map((file) => file.replaceAll('\\', '/'));
  const sdkInputs = inputs.filter((file) => file.includes('/journey-browser-sdk/dist/'));
  if (!sdkInputs.length) fail(`Export-map resolution for ${conditions.join('+')} pulled in no browser SDK dist file.`);
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
    platform: 'browser',
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
    { name: 'eval', pattern: /\beval\s*\(/u },
    { name: 'dynamic Function constructor', pattern: /\bnew\s+Function\b/u }
  ];
  for (const check of prohibited) {
    if (check.pattern.test(source)) fail(`ES2022 browser bundle contains ${check.name}.`);
  }

  await writeFile(assertions, `
const assert = require('node:assert/strict');

/**
 * Shared by the ESM and CommonJS harnesses so both formats are held to exactly
 * the same host-isolation contract instead of drifting apart.
 */
module.exports = async function assertRestrictedHostIsolation(sdk) {
assert.equal(typeof sdk.createBrowserJourneySdk, 'function');

const disabled = sdk.createBrowserJourneySdk({
  writeKey: 'invalid',
  endpoint: 'not-a-url',
  runtime: {
    setTimeout() { throw new Error('timer unavailable'); },
    clearTimeout() {}
  }
});
await disabled.ready;
assert.equal(disabled.enabled, false);
assert.equal((await disabled.track('host_must_survive', {}, { userId: 'user_1' })).status, 'disabled');
assert.equal((await disabled.flush()).status, 'disabled');
await disabled.destroy();

const hostileStorage = {
  getItem() { throw new Error('storage unavailable'); },
  setItem() { throw new Error('storage unavailable'); },
  removeItem() { throw new Error('storage unavailable'); }
};
const isolated = sdk.createBrowserJourneySdk({
  writeKey: 'jpk_dev.browser_compat.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  endpoint: 'https://ingest.example.test',
  environment: 'development',
  consent: {
    analytics: 'granted',
    source: 'local_compatibility',
    updatedAt: '2026-08-04T12:00:00.000Z'
  },
  storage: hostileStorage,
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
assert.equal((await isolated.track('restricted_host_event', {}, {
  userId: 'user_1',
  eventId: '00000000-0000-4000-8000-000000000001'
})).status, 'queued');
assert.equal((await isolated.flush()).status, 'retry_scheduled');
await isolated.reset();
await isolated.destroy();
};
`);

  const restrictedGlobals = `
for (const name of ['window', 'document', 'navigator', 'location', 'fetch', 'crypto']) {
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
console.log('restricted browser host isolation passed (ESM)');
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
  if (!output || output.bytes <= 0) fail('Browser build produced no output.');
  console.log(`browser-resolvable ES2022 ESM bundle passed (${output.bytes} bytes; no public size budget ratified)`);
  process.stdout.write(esmHostOutput);

  // Export-map resolution: the same package, selected the way a bundler selects it.
  const esmByExports = await bundleFromExportMap({
    outfile: path.join(temporaryRoot, 'exports-esm.mjs'),
    format: 'esm',
    conditions: ['browser', 'import', 'default']
  });
  const esmExportBytes = Object.values(esmByExports.metafile.outputs)[0].bytes;

  const cjsBundle = path.join(temporaryRoot, 'exports-cjs.cjs');
  const cjsByExports = await bundleFromExportMap({
    outfile: cjsBundle,
    format: 'cjs',
    conditions: ['browser', 'require', 'default']
  });
  const cjsExportBytes = Object.values(cjsByExports.metafile.outputs)[0].bytes;

  // `require(` and `module.exports` are legitimate in a CommonJS bundle, so the
  // prohibited list is scoped per format; everything host-hostile still applies.
  const cjsSource = await readFile(cjsBundle, 'utf8');
  for (const check of prohibited.filter((entry) => entry.name !== 'CommonJS require')) {
    if (check.pattern.test(cjsSource)) fail(`ES2022 browser CommonJS bundle contains ${check.name}.`);
  }

  const cjsHostTest = path.join(temporaryRoot, 'restricted-host.cjs');
  await writeFile(cjsHostTest, `
const assertRestrictedHostIsolation = require('./assertions.cjs');
${restrictedGlobals}
const sdk = require(${JSON.stringify(cjsBundle)});
assertRestrictedHostIsolation(sdk)
  .then(() => console.log('restricted browser host isolation passed (CommonJS)'))
  .catch((error) => { console.error(error); process.exit(1); });
`);
  process.stdout.write(runHost(cjsHostTest, 'CommonJS'));
  console.log(`browser export map resolves both conditions (import ${esmExportBytes} bytes, require ${cjsExportBytes} bytes; no public size budget ratified)`);
} finally {
  const resolved = path.resolve(temporaryRoot);
  const systemTemp = path.resolve(os.tmpdir());
  if (!resolved.startsWith(`${systemTemp}${path.sep}`)
    || !path.basename(resolved).startsWith('seemplify-browser-sdk-')) {
    fail(`Refusing to remove unexpected temporary path: ${resolved}`);
  }
  await rm(resolved, { recursive: true, force: true });
}
