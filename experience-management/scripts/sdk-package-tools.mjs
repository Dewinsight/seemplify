import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, '..');
const repositoryRoot = path.resolve(workspaceRoot, '..');
const packagesRoot = path.join(workspaceRoot, 'packages');
const policyPath = path.join(packagesRoot, 'SDK-QUALIFICATION.json');

/** The only policy version this tool understands. */
const supportedPolicyVersion = 1;

const sdkPackages = [
  { directory: 'journey-event-protocol', name: '@seemplify/journey-event-protocol' },
  { directory: 'journey-browser-sdk', name: '@seemplify/journey-browser-sdk' },
  { directory: 'journey-node', name: '@seemplify/journey-node' },
  { directory: 'journey-react', name: '@seemplify/journey-react' },
  { directory: 'journey-react-native', name: '@seemplify/journey-react-native' }
];

/**
 * Every package stays `type: module` at its root, so the generated CommonJS tree
 * needs its own scope marker for Node and bundlers to read `dist/cjs/*.js` as
 * CommonJS. `sideEffects` is repeated because webpack resolves that flag from the
 * nearest package.json, and omitting it here would silently disable tree shaking
 * for the CommonJS subtree only.
 */
const cjsDirectoryName = 'cjs';
const cjsDirectoryManifest = `${JSON.stringify({ type: 'commonjs', sideEffects: false }, null, 2)}\n`;

function fail(message) {
  throw new Error(`[sdk-package-tools] ${message}`);
}

/**
 * The single source of truth for every locally enforced qualification number.
 * Loaded fail-closed: an absent, unparseable or unknown-version policy stops the
 * gate rather than silently disabling enforcement, because a budget that quietly
 * stops being checked is worse than no budget at all.
 */
export function loadPolicy() {
  if (!existsSync(policyPath)) {
    fail(`Qualification policy is missing: ${path.relative(workspaceRoot, policyPath)}`);
  }
  let policy;
  try {
    policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  } catch (error) {
    fail(`Qualification policy is not valid JSON: ${error.message}`);
  }
  if (policy.policyVersion !== supportedPolicyVersion) {
    fail(`Qualification policy version ${policy.policyVersion} is not supported (expected ${supportedPolicyVersion})`);
  }
  return policy;
}

/** Deterministic gzip length, using exactly the recipe the policy records. */
export function gzipLength(buffer, policy) {
  const level = policy.measurement?.gzip?.level;
  if (typeof level !== 'number') fail('Qualification policy does not record a gzip level');
  return gzipSync(buffer, { level }).length;
}

function parseSemver(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(String(value ?? ''));
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

/**
 * Evaluates the small `>=x.y.z <a.b.c` range dialect the policy uses. Written out
 * rather than pulled from a dependency because this gate must not add one.
 */
function satisfiesRange(observed, range) {
  const version = parseSemver(observed);
  if (!version) return false;
  for (const clause of String(range).trim().split(/\s+/u)) {
    const match = /^(>=|>|<=|<|=)(.+)$/u.exec(clause);
    if (!match) fail(`Unsupported version range clause: ${clause}`);
    const bound = parseSemver(match[2]);
    if (!bound) fail(`Unsupported version bound: ${match[2]}`);
    const order = compareSemver(version, bound);
    const satisfied = match[1] === '>=' ? order >= 0
      : match[1] === '>' ? order > 0
        : match[1] === '<=' ? order <= 0
          : match[1] === '<' ? order < 0
            : order === 0;
    if (!satisfied) return false;
  }
  return true;
}

function installedVersion(moduleName) {
  const manifestPath = path.join(workspaceRoot, 'node_modules', moduleName, 'package.json');
  if (!existsSync(manifestPath)) return undefined;
  return JSON.parse(readFileSync(manifestPath, 'utf8')).version;
}

/**
 * Fail-closed local support matrix. Every fact here is read from the executing
 * process or from an installed manifest at run time, so the gate turns red when
 * the real toolchain leaves the intended local baseline instead of letting a
 * document silently become false. Nothing about browsers, Metro, physical
 * devices, remote CI or operating-system versions is asserted: none of it is
 * observable from this host.
 */
export function assertLocalMatrix(policy, { quiet = false } = {}) {
  const observed = {
    node: process.version,
    typescript: installedVersion('typescript'),
    esbuild: installedVersion('esbuild'),
    react: installedVersion('react')
  };
  const failures = [];
  for (const [tool, actual] of Object.entries(observed)) {
    const range = policy.toolchain?.[tool]?.range;
    if (!range) fail(`Qualification policy does not record a ${tool} range`);
    if (actual === undefined) {
      failures.push(`${tool} is not installed but the policy requires ${range}`);
      continue;
    }
    if (!satisfiesRange(actual, range)) {
      failures.push(`${tool} ${actual} is outside the qualified local range ${range}`);
    }
  }
  if (!quiet) {
    console.log('local qualification matrix:');
    for (const [tool, actual] of Object.entries(observed)) {
      const range = policy.toolchain?.[tool]?.range;
      console.log(`  ${tool.padEnd(11)} actual ${String(actual ?? '<absent>').padEnd(10)} qualified range ${range}`);
    }
    console.log(`  platform    actual ${process.platform} (recorded only; no operating-system support is claimed)`);
    console.log(`  module combinations: ${(policy.toolchain?.moduleCombinations ?? []).join(', ')}`);
  }
  if (failures.length) {
    fail(`Local qualification matrix is outside policy:\n  - ${failures.join('\n  - ')}`);
  }
  return observed;
}

/**
 * Shared budget comparison. Raw bytes are the hard ceiling because they are
 * deterministic for a pinned esbuild; gzip length is a ceiling only, since zlib
 * output is not guaranteed identical across Node versions. Actual/limit is
 * printed on success as well as failure so a run that is silently approaching a
 * ceiling is visible before it breaks.
 */
export function assertBudget(policy, id, rawBytes, gzipBytes) {
  const budget = policy.bundleBudgets?.artifacts?.find((entry) => entry.id === id);
  if (!budget) fail(`No bundle budget is recorded for artifact "${id}"; record one before enforcing it.`);
  if (typeof budget.rawMax !== 'number' || typeof budget.gzipMax !== 'number') {
    fail(`Bundle budget "${id}" is incomplete; both rawMax and gzipMax are required.`);
  }
  const rawPercent = ((rawBytes / budget.rawMax) * 100).toFixed(1);
  const gzipPercent = ((gzipBytes / budget.gzipMax) * 100).toFixed(1);
  const report = `${id}: raw ${rawBytes}/${budget.rawMax} bytes (${rawPercent}% of limit), gzip ${gzipBytes}/${budget.gzipMax} bytes (${gzipPercent}% of limit)`;
  if (rawBytes > budget.rawMax) {
    fail(`Bundle budget exceeded — ${report}. Raise the limit only through the reviewed process in SDK-SUPPORT.md.`);
  }
  if (gzipBytes > budget.gzipMax) {
    fail(`Gzip budget exceeded — ${report}. Raise the limit only through the reviewed process in SDK-SUPPORT.md.`);
  }
  console.log(`  budget ok ${report}`);
  return { id, rawBytes, gzipBytes, rawMax: budget.rawMax, gzipMax: budget.gzipMax };
}

function packageSpec(directory) {
  const spec = sdkPackages.find((candidate) => candidate.directory === directory);
  if (!spec) fail(`Unknown SDK package directory: ${directory || '<missing>'}`);
  return spec;
}

function packageDirectory(spec) {
  const resolved = path.resolve(packagesRoot, spec.directory);
  const expected = path.join(realpathSync(packagesRoot), spec.directory);
  if (realpathSync(resolved) !== expected) fail(`Package path escaped the SDK package root: ${resolved}`);
  return resolved;
}

function readManifest(spec) {
  const directory = packageDirectory(spec);
  const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
  if (manifest.name !== spec.name) fail(`${spec.directory} has unexpected package name ${manifest.name}`);
  return { directory, manifest };
}

function filesBelow(directory) {
  if (!existsSync(directory)) return [];
  const result = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) result.push(path.relative(directory, absolute).replaceAll('\\', '/'));
    }
  };
  visit(directory);
  return result.sort();
}

function exportTargets(value, result = new Set()) {
  if (typeof value === 'string') result.add(value);
  else if (Array.isArray(value)) value.forEach((entry) => exportTargets(entry, result));
  else if (value && typeof value === 'object') Object.values(value).forEach((entry) => exportTargets(entry, result));
  return result;
}

function verifyTarget(directory, target) {
  if (!target.startsWith('./')) fail(`Export target must remain package-relative: ${target}`);
  const targetWithoutGlob = target.includes('*') ? target.slice(0, target.indexOf('*')) : target;
  const absolute = path.resolve(directory, targetWithoutGlob);
  const relative = path.relative(directory, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) fail(`Export target escapes package: ${target}`);
  if (target.includes('*')) {
    const baseDirectory = targetWithoutGlob.endsWith('/') ? absolute : path.dirname(absolute);
    if (!existsSync(baseDirectory) || !statSync(baseDirectory).isDirectory()) {
      fail(`Wildcard export has no source directory: ${target}`);
    }
    if (!filesBelow(baseDirectory).length) fail(`Wildcard export is empty: ${target}`);
    return;
  }
  if (!existsSync(absolute) || !statSync(absolute).isFile() || statSync(absolute).size === 0) {
    fail(`Release target is missing or empty: ${target}`);
  }
}

function expectedCompilerArtifacts(directory) {
  const sourceDirectory = path.join(directory, 'src');
  const expected = new Set([`${cjsDirectoryName}/package.json`]);
  for (const source of filesBelow(sourceDirectory)) {
    if (!/\.(?:ts|tsx)$/.test(source) || source.endsWith('.d.ts')) continue;
    const stem = source.replace(/\.(?:ts|tsx)$/, '');
    for (const prefix of ['', `${cjsDirectoryName}/`]) {
      expected.add(`${prefix}${stem}.js`);
      expected.add(`${prefix}${stem}.js.map`);
      expected.add(`${prefix}${stem}.d.ts`);
      expected.add(`${prefix}${stem}.d.ts.map`);
    }
  }
  return [...expected].sort();
}

/**
 * Guards the failure the export map cannot describe: a `require` condition that
 * actually resolves to ES module syntax, or an `import` condition that resolves
 * to CommonJS. `exports.__esModule` is deliberately not used as the sole CommonJS
 * signal because TypeScript emits it either way once interop is on.
 */
function verifyModuleFormat(directory, target, format) {
  const relative = target.replace(/^\.\//, '');
  const source = readFileSync(path.resolve(directory, relative), 'utf8');
  const esmSyntax = /^(?:export|import)[\s{*]/mu.test(source);
  const cjsSyntax = /\bmodule\.exports\b|\bexports\.[A-Za-z_$]|Object\.defineProperty\(exports\s*,/u.test(source);
  const requireCall = /\brequire\s*\(/u.test(source);
  if (format === 'esm') {
    if (!esmSyntax) fail(`${relative} is reachable through an import condition but has no ES module syntax`);
    if (requireCall) fail(`${relative} is reachable through an import condition but calls require()`);
    return;
  }
  if (esmSyntax) fail(`${relative} is reachable through a require condition but has top-level ES module syntax`);
  if (!cjsSyntax) fail(`${relative} is reachable through a require condition but never assigns CommonJS exports`);
}

/**
 * Walks the export map keeping track of the enclosing condition so every
 * reachable JavaScript target can be format-checked against the condition that
 * reaches it. Conditions that do not imply a module format inherit their parent.
 */
function formatTaggedTargets(value, format, result = new Map()) {
  if (typeof value === 'string') {
    if (format && /\.js$/u.test(value)) result.set(value, format);
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => formatTaggedTargets(entry, format, result));
    return result;
  }
  if (!value || typeof value !== 'object') return result;
  for (const [condition, entry] of Object.entries(value)) {
    if (condition === 'types') continue;
    const nested = condition === 'require' ? 'cjs' : condition === 'import' ? 'esm' : format;
    formatTaggedTargets(entry, nested, result);
  }
  return result;
}

/**
 * Paths that must never appear in a published artifact. These match the *shape*
 * of a leaked location — a home directory, a workspace root, an environment or
 * credential file name. No real credential file is opened, read or scanned
 * anywhere in this tool; only generated build output is inspected.
 */
const privacyPatterns = [
  { name: 'a Windows user home path', pattern: /(?:^|[\\/"'])[a-zA-Z]:[\\/]+Users[\\/]+/u },
  { name: 'a POSIX user home path', pattern: /(?:^|[\\/"'])(?:\/home\/|\/Users\/|\/root\/)/u },
  { name: 'a file URL', pattern: /\bfile:\/\//u },
  { name: 'an environment file path', pattern: /(?:^|[\\/])\.env(?:\.[A-Za-z0-9_-]+)?(?:$|["'\s])/u },
  { name: 'a credential or secret file path', pattern: /(?:^|[\\/])(?:\.npmrc|\.netrc|id_rsa|id_ed25519|[A-Za-z0-9_-]*(?:secret|credential)s?\.(?:json|ya?ml|txt|pem|key))(?:$|["'\s])/iu },
  { name: 'a private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u }
];

function assertNoPrivacyLeak(label, text) {
  for (const check of privacyPatterns) {
    if (check.pattern.test(text)) fail(`${label} leaks ${check.name}`);
  }
}

/**
 * Matches the canonical credential shape the protocol parser accepts, so a real
 * key pasted into a README or example fails the gate before it can be packed.
 *
 * The documented placeholder is allowlisted explicitly rather than by loosening
 * the pattern: every published example deliberately ships a key whose id is
 * `replace_me` and whose secret is all zeros, and a gate that could not tell
 * that apart from a live key would either be permanently red or worthlessly
 * permissive.
 */
const packedCredentialPattern = /\b(jpk|jsk)_(dev|stg|live)\.([A-Za-z0-9][A-Za-z0-9_:-]{0,127})\.([A-Za-z0-9_-]{32,256})\b/gu;

function assertNoPackedCredential(packageName, file, text) {
  for (const match of text.matchAll(packedCredentialPattern)) {
    const [literal, , , keyId, secret] = match;
    const isDocumentedPlaceholder = keyId === 'replace_me' && /^0+$/u.test(secret);
    if (!isDocumentedPlaceholder) {
      fail(`${packageName} packed file ${file} contains a credential-shaped literal that is not the documented placeholder: ${literal.slice(0, 24)}…`);
    }
  }
}

/**
 * A source map is the easiest place for a workspace path to escape into a
 * published tarball. `sourceRoot` gets its own check because setting it to an
 * absolute path is the standard fix when maps fail to resolve, and it would
 * otherwise sail through a `sources`-only gate. `file://` URLs get their own
 * check because `path.isAbsolute('file:///C:/Users/...')` is false.
 */
function verifySourceMap(directory, relativeFile) {
  const raw = readFileSync(path.join(directory, 'dist', relativeFile), 'utf8');
  const document = JSON.parse(raw);
  if (Object.hasOwn(document, 'sourcesContent')) fail(`${relativeFile} embeds source content`);
  if (!Array.isArray(document.sources) || !document.sources.length) fail(`${relativeFile} has no source reference`);

  if (Object.hasOwn(document, 'sourceRoot') && document.sourceRoot !== '') {
    fail(`${relativeFile} declares a non-empty sourceRoot (${document.sourceRoot}); it would prefix every source path in a published map`);
  }
  if (typeof document.file === 'string' && (path.isAbsolute(document.file) || /^[a-zA-Z]:[\\/]/u.test(document.file))) {
    fail(`${relativeFile} declares an absolute file field`);
  }

  const mapDirectory = path.dirname(path.join(directory, 'dist', relativeFile));
  for (const source of document.sources) {
    if (typeof source !== 'string' || path.isAbsolute(source) || /^[a-zA-Z]:[\\/]/u.test(source)) {
      fail(`${relativeFile} contains an absolute source path`);
    }
    // `../src/x.ts` is correct and expected. Escaping the package root is not:
    // it would publish a map pointing at a path only this machine has.
    const resolved = path.resolve(mapDirectory, source);
    const relativeToPackage = path.relative(directory, resolved);
    if (relativeToPackage.startsWith('..') || path.isAbsolute(relativeToPackage)) {
      fail(`${relativeFile} references a source outside the package: ${source}`);
    }
  }
  assertNoPrivacyLeak(relativeFile, raw);
}

function verifyPackage(spec, { quiet = false } = {}) {
  const { directory, manifest } = readManifest(spec);
  if (manifest.private !== true && manifest.private !== false) fail(`${manifest.name} must declare private explicitly`);
  if (manifest.sideEffects !== false) fail(`${manifest.name} must remain side-effect-free`);
  if (!Array.isArray(manifest.files) || !manifest.files.includes('dist') || !manifest.files.includes('CHANGELOG.md')) {
    fail(`${manifest.name} must include dist and CHANGELOG.md in files`);
  }
  if (!manifest.repository?.url || !manifest.repository?.directory) fail(`${manifest.name} is missing repository metadata`);
  if (!manifest.homepage || !manifest.bugs?.url || !manifest.author?.name) fail(`${manifest.name} is missing support metadata`);
  if (manifest.publishConfig?.access !== 'public' || manifest.publishConfig?.registry !== 'https://registry.npmjs.org/') {
    fail(`${manifest.name} must pin its intended public registry configuration`);
  }
  if (manifest.scripts?.prepack !== 'npm run build') fail(`${manifest.name} prepack must perform a clean verified build`);
  for (const lifecycle of ['preinstall', 'install', 'postinstall', 'prepare']) {
    if (manifest.scripts?.[lifecycle]) fail(`${manifest.name} must not run a ${lifecycle} consumer lifecycle script`);
  }

  const targets = exportTargets(manifest.exports);
  for (const field of ['main', 'module', 'types']) {
    if (typeof manifest[field] === 'string') targets.add(manifest[field]);
  }
  for (const target of targets) verifyTarget(directory, target);

  const actual = filesBelow(path.join(directory, 'dist'));
  const expected = expectedCompilerArtifacts(directory);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const missing = expected.filter((file) => !actual.includes(file));
    const unexpected = actual.filter((file) => !expected.includes(file));
    fail(`${manifest.name} dist differs from a clean TypeScript build; missing=${missing.join(',') || '-'} unexpected=${unexpected.join(',') || '-'}`);
  }
  for (const file of actual.filter((candidate) => candidate.endsWith('.map'))) verifySourceMap(directory, file);

  const markerPath = path.join(directory, 'dist', cjsDirectoryName, 'package.json');
  if (readFileSync(markerPath, 'utf8') !== cjsDirectoryManifest) {
    fail(`${manifest.name} dist/${cjsDirectoryName}/package.json is not the canonical CommonJS scope marker`);
  }

  // ESM is the canonical build, so anything not reached through `require`
  // must be ES module syntax unless a nested condition says otherwise.
  const formats = formatTaggedTargets(manifest.exports, 'esm');
  if (typeof manifest.main === 'string') formats.set(manifest.main, 'cjs');
  if (typeof manifest.module === 'string') formats.set(manifest.module, 'esm');
  let requireTargets = 0;
  for (const [target, format] of formats) {
    verifyModuleFormat(directory, target, format);
    if (format === 'cjs') requireTargets += 1;
  }
  if (!requireTargets) fail(`${manifest.name} exposes no CommonJS-reachable entry point`);

  if (!quiet) {
    console.log(`verified ${manifest.name}@${manifest.version}: ${actual.length} deterministic artifacts, ${formats.size} format-checked entry targets`);
  }
  return { directory, manifest, actual, formats };
}

function emitCjsDirectoryManifest(spec) {
  const directory = packageDirectory(spec);
  const cjsDirectory = path.join(directory, 'dist', cjsDirectoryName);
  if (path.relative(directory, cjsDirectory) !== path.join('dist', cjsDirectoryName)) {
    fail(`Refusing to write outside the CommonJS output directory: ${cjsDirectory}`);
  }
  mkdirSync(cjsDirectory, { recursive: true });
  writeFileSync(path.join(cjsDirectory, 'package.json'), cjsDirectoryManifest, 'utf8');
  console.log(`marked ${spec.name} dist/${cjsDirectoryName} as CommonJS`);
}

function cleanPackage(spec) {
  const directory = packageDirectory(spec);
  const dist = path.join(directory, 'dist');
  const relative = path.relative(directory, dist);
  if (relative !== 'dist') fail(`Refusing to clean unexpected path: ${dist}`);
  rmSync(dist, { recursive: true, force: true });
  console.log(`cleaned ${spec.name} dist`);
}

function runNpm(arguments_, { capture = false, cwd = workspaceRoot } = {}) {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const args = npmExecPath ? [npmExecPath, ...arguments_] : arguments_;
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    shell: !npmExecPath && process.platform === 'win32',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture) process.stderr.write(result.stderr || result.stdout || '');
    fail(`npm ${arguments_.join(' ')} exited with ${result.status}`);
  }
  return capture ? result.stdout : '';
}

function distributionDigest(spec) {
  const directory = packageDirectory(spec);
  const digest = createHash('sha256');
  for (const relativeFile of filesBelow(path.join(directory, 'dist'))) {
    digest.update(relativeFile);
    digest.update('\0');
    digest.update(readFileSync(path.join(directory, 'dist', relativeFile)));
    digest.update('\0');
  }
  return digest.digest('hex');
}

function buildDeterministically() {
  runNpm(['run', 'build:sdk']);
  const first = new Map(sdkPackages.map((spec) => [spec.name, distributionDigest(spec)]));
  runNpm(['run', 'build:sdk']);
  for (const spec of sdkPackages) {
    const second = distributionDigest(spec);
    if (first.get(spec.name) !== second) fail(`${spec.name} build output is not deterministic`);
    verifyPackage(spec, { quiet: true });
    console.log(`deterministic ${spec.name}: ${second}`);
  }
}

function verifyPackedFiles(spec, packResult) {
  const { directory, manifest, actual } = verifyPackage(spec, { quiet: true });
  if (packResult.name !== manifest.name || packResult.version !== manifest.version) {
    fail(`npm pack returned unexpected identity for ${manifest.name}`);
  }
  const packed = new Set(packResult.files.map((entry) => entry.path.replaceAll('\\', '/')));
  for (const file of actual.map((entry) => `dist/${entry}`)) {
    if (!packed.has(file)) fail(`${manifest.name} tarball omitted ${file}`);
  }

  // Every conditional export target must survive packing, otherwise a consumer
  // resolves a condition to a file the tarball never shipped.
  const entryTargets = exportTargets(manifest.exports);
  for (const field of ['main', 'module', 'types']) {
    if (typeof manifest[field] === 'string') entryTargets.add(manifest[field]);
  }
  for (const target of entryTargets) {
    const relative = target.replace(/^\.\//, '');
    // Pairs with the `examples/` exemption below: documentation may ship as
    // TypeScript only while nothing resolves through it, so the exemption can
    // never become a route for publishing uncompiled implementation code.
    if (relative === 'examples' || relative.startsWith('examples/')) {
      fail(`${manifest.name} resolves an export through documentation examples: ${target}`);
    }
    if (relative.includes('*')) {
      const prefix = relative.slice(0, relative.indexOf('*'));
      if (![...packed].some((file) => file.startsWith(prefix))) {
        fail(`${manifest.name} tarball omitted every file behind wildcard export ${target}`);
      }
      continue;
    }
    if (!packed.has(relative)) fail(`${manifest.name} tarball omitted entry target ${relative}`);
  }

  for (const file of packed) {
    if (file.startsWith('src/')) fail(`${manifest.name} tarball leaks TypeScript sources: ${file}`);
    // `examples/` is published documentation that each README deep-links with a
    // relative path, so it ships as TypeScript deliberately. It sits outside
    // every exports and types entry, so no consumer ever resolves into it.
    if (/\.tsx?$/u.test(file) && !file.endsWith('.d.ts') && !file.startsWith('examples/')) {
      fail(`${manifest.name} tarball leaks a TypeScript source: ${file}`);
    }
    if (/^tsconfig.*\.json$/u.test(file)) fail(`${manifest.name} tarball leaks compiler configuration: ${file}`);
    // A packed dotfile is the classic accidental-credential vector. npm already
    // refuses some of these, but relying on that is relying on a tool default
    // rather than on a gate this repository controls.
    if (/(?:^|\/)\.(?:npmrc|netrc|env|git|DS_Store)/u.test(file)) {
      fail(`${manifest.name} tarball leaks a configuration or credential dotfile: ${file}`);
    }
  }
  if (!packed.has('package.json') || !packed.has('README.md') || !packed.has('CHANGELOG.md')) {
    fail(`${manifest.name} tarball lacks package metadata or change history`);
  }

  // An executable entry would be a publication surface nothing in this
  // repository qualifies, so the SDK packages declare none.
  if (manifest.bin !== undefined) {
    fail(`${manifest.name} declares a bin entry; no SDK ships an executable in this foundation`);
  }
  for (const key of ['_auth', '_authToken', 'authToken', 'email', 'username', 'password', 'token']) {
    if (manifest.publishConfig && Object.hasOwn(manifest.publishConfig, key)) {
      fail(`${manifest.name} publishConfig carries the credential-bearing key "${key}"`);
    }
  }

  // Explicit enumeration by design: every packed text file is opened directly
  // rather than searched with a tool that applies ignore or binary heuristics.
  // A recursive matcher can silently skip a file — this repository has one such
  // file today — and silently skipping is the one failure mode a privacy gate
  // must not have.
  const textExtensions = /\.(?:js|cjs|mjs|ts|tsx|cts|mts|json|md|map|ya?ml|txt|html|css)$/u;
  let scanned = 0;
  for (const file of [...packed].sort()) {
    if (!textExtensions.test(file)) continue;
    const absolute = path.join(directory, file);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;
    const text = readFileSync(absolute, 'utf8');
    assertNoPrivacyLeak(`${manifest.name} packed file ${file}`, text);
    assertNoPackedCredential(manifest.name, file, text);
    scanned += 1;
  }
  const packagePath = path.relative(workspaceRoot, directory).replaceAll('\\', '/');
  console.log(`pack-safe ${manifest.name}@${manifest.version}: ${packResult.entryCount} entries, ${packResult.size} bytes, ${scanned} text files privacy-scanned (${packagePath})`);
}

function dryRunPacks() {
  for (const spec of sdkPackages) {
    // `--ignore-scripts` keeps the gate non-destructive: without it npm runs
    // prepack, whose first step deletes dist, so a mid-run failure would leave
    // every later package unverifiable against an empty output tree.
    const stdout = runNpm(['pack', '--dry-run', '--ignore-scripts', '--json', '--silent'], {
      capture: true,
      cwd: packageDirectory(spec)
    });
    let results;
    try {
      const matches = [...stdout.matchAll(/\[\s*\{\s*"id"\s*:/g)];
      const jsonStart = matches.at(-1)?.index;
      if (jsonStart === undefined) throw new Error('missing npm pack JSON');
      results = JSON.parse(stdout.slice(jsonStart));
    } catch {
      fail(`${spec.name} npm pack did not return JSON: ${stdout}`);
    }
    if (!Array.isArray(results) || results.length !== 1) fail(`${spec.name} npm pack returned an unexpected result count`);
    verifyPackedFiles(spec, results[0]);
  }
}

function resolvePolicyPath(relativePath, {
  baseDirectory = workspaceRoot,
  boundaryDirectory = repositoryRoot
} = {}) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    fail('Policy path must be a non-empty string');
  }
  const resolved = path.resolve(baseDirectory, relativePath);
  const relative = path.relative(boundaryDirectory, resolved);
  if (path.isAbsolute(relative) || relative.startsWith('..')) {
    fail(`Policy path escapes the expected repository boundary: ${relativePath}`);
  }
  return resolved;
}

function verifyWorkflowTemplate(policy, { quiet = false } = {}) {
  const relativeTemplatePath = policy.release?.workflowTemplate;
  const workflowTemplate = resolvePolicyPath(relativeTemplatePath, {
    baseDirectory: workspaceRoot,
    boundaryDirectory: repositoryRoot
  });
  if (!existsSync(workflowTemplate) || !statSync(workflowTemplate).isFile()) {
    fail(`Workflow template is missing: ${path.relative(workspaceRoot, workflowTemplate).replaceAll('\\', '/')}`);
  }

  const relativeWorkflowPath = path.relative(workspaceRoot, workflowTemplate).replaceAll('\\', '/');
  const source = readFileSync(workflowTemplate, 'utf8').replaceAll('\r\n', '\n');

  if (policy.release?.workflowMustStayDisabled === true && !relativeWorkflowPath.endsWith('.disabled')) {
    fail(`Workflow template must stay disabled but path does not end with .disabled: ${relativeWorkflowPath}`);
  }

  const requiredWorkflowGates = policy.release?.requiredWorkflowGates;
  if (!Array.isArray(requiredWorkflowGates) || !requiredWorkflowGates.length) {
    fail('Qualification policy does not record required workflow gates');
  }
  for (const gate of requiredWorkflowGates) {
    const expectedLine = gate === 'release-ready'
      ? 'node scripts/sdk-package-tools.mjs release-ready'
      : gate.startsWith('npm ') || gate.startsWith('node ')
        ? gate
        : `npm run ${gate}`;
    if (!source.includes(expectedLine)) {
      fail(`Workflow template does not execute required gate "${gate}"`);
    }
  }

  const environment = policy.release?.environment;
  if (typeof environment !== 'string' || !environment.trim()) {
    fail('Qualification policy does not record a workflow environment');
  }
  if (!source.includes(`environment: ${environment}`)) {
    fail(`Workflow template does not target the recorded environment "${environment}"`);
  }

  const confirmation = policy.release?.confirmation;
  if (typeof confirmation !== 'string' || !confirmation.trim()) {
    fail('Qualification policy does not record an explicit confirmation token');
  }
  if (!source.includes(`inputs.confirmation == '${confirmation}'`)) {
    fail(`Workflow template does not enforce confirmation token "${confirmation}"`);
  }

  const distTag = policy.release?.distTag;
  if (typeof distTag !== 'string' || !distTag.trim()) {
    fail('Qualification policy does not record a publish dist-tag');
  }
  const publishCommands = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- run: npm publish --workspace '));
  const expectedPublishCommands = policy.release.mandatoryPublishOrder.map((packageName) =>
    `- run: npm publish --workspace ${packageName} --access public --tag ${distTag} --provenance`
  );
  if (publishCommands.length !== expectedPublishCommands.length) {
    fail(`Workflow template publishes ${publishCommands.length} package(s), expected ${expectedPublishCommands.length}`);
  }
  for (let index = 0; index < expectedPublishCommands.length; index += 1) {
    if (publishCommands[index] !== expectedPublishCommands[index]) {
      fail(`Workflow publish order diverges at position ${index + 1}: expected "${expectedPublishCommands[index]}"`);
    }
  }

  const forbiddenTags = policy.release?.forbiddenDistTags;
  if (Array.isArray(forbiddenTags)) {
    for (const tag of forbiddenTags) {
      if (source.includes(`--tag ${tag}`)) {
        fail(`Workflow template uses forbidden dist-tag "${tag}"`);
      }
    }
  }

  const publishToolchain = policy.release?.publishToolchain;
  if (publishToolchain && typeof publishToolchain === 'object') {
    const nodeVersion = publishToolchain.nodeVersion;
    const npmVersion = publishToolchain.npmVersion;
    if (typeof nodeVersion !== 'string' || !nodeVersion.trim()) {
      fail('Qualification policy publishToolchain.nodeVersion must be recorded');
    }
    if (typeof npmVersion !== 'string' || !npmVersion.trim()) {
      fail('Qualification policy publishToolchain.npmVersion must be recorded');
    }
    if (!source.includes(`node-version: ${nodeVersion}`)) {
      fail(`Workflow template does not pin the recorded publish Node version "${nodeVersion}"`);
    }
    if (!source.includes(`npm i -g npm@${npmVersion}`)) {
      fail(`Workflow template does not install the recorded publish npm version "${npmVersion}"`);
    }
    const assertionLine = `node -e "const [major, minor] = process.versions.node.split('.').map((value) => Number.parseInt(value, 10)); if (major !== 22 || minor < 14) throw new Error('Node 22.14.0+ required for trusted publishing');"`;
    if (!source.includes(assertionLine)) {
      fail('Workflow template does not assert the trusted-publishing Node floor');
    }
    const npmAssertionLine = `node -e "const [major, minor, patch] = require('node:child_process').execSync('npm --version', { encoding: 'utf8' }).trim().split('.').map((value) => Number.parseInt(value, 10)); if (major < 11 || (major === 11 && minor < 5) || (major === 11 && minor === 5 && patch < 1)) throw new Error('npm 11.5.1+ required for trusted publishing');"`;
    if (!source.includes(npmAssertionLine)) {
      fail('Workflow template does not assert the trusted-publishing npm floor');
    }
  }

  if (!quiet) {
    console.log(`verified workflow template ${relativeWorkflowPath}`);
  }
}

/**
 * Coordinated-version and internal-pin audit. Exact internal dependencies are
 * what make the documented publish order mandatory, so a set whose pins drift
 * from its own versions would publish an unusable package graph — and npm
 * publication is not transactional, so that cannot be rolled back.
 *
 * Returns findings rather than throwing so `qualify` can report and
 * `release-ready` can enforce, without the two drifting apart.
 */
function auditManifestCoordination(policy) {
  const manifests = sdkPackages.map((spec) => readManifest(spec));
  const findings = [];
  const versions = new Set(manifests.map(({ manifest }) => manifest.version));
  if (versions.size !== 1) {
    findings.push(`the five packages do not share one version: ${manifests.map(({ manifest }) => `${manifest.name}@${manifest.version}`).join(', ')}`);
  }
  const coordinated = versions.size === 1 ? [...versions][0] : undefined;

  for (const { manifest } of manifests) {
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [dependency, range] of Object.entries(manifest[field] ?? {})) {
        if (!dependency.startsWith('@seemplify/')) continue;
        if (field !== 'dependencies') {
          findings.push(`${manifest.name} declares internal ${dependency} as a ${field}; internal SDK links must stay exact runtime dependencies`);
          continue;
        }
        if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(range)) {
          findings.push(`${manifest.name} pins ${dependency} to the non-exact range "${range}"`);
          continue;
        }
        if (coordinated && range !== coordinated) {
          findings.push(`${manifest.name} pins ${dependency} to ${range} but the coordinated version is ${coordinated}`);
        }
        if (!sdkPackages.some((spec) => spec.name === dependency)) {
          findings.push(`${manifest.name} depends on unknown internal package ${dependency}`);
        }
      }
    }
    // The publish order exists because of these pins; a package missing from the
    // recorded order could be published at the wrong point in the sequence.
    if (!policy.release.mandatoryPublishOrder.includes(manifest.name)) {
      findings.push(`${manifest.name} is absent from the recorded mandatory publish order`);
    }
  }

  const order = policy.release.mandatoryPublishOrder;
  if (new Set(order).size !== order.length || order.length !== sdkPackages.length) {
    findings.push(`the recorded mandatory publish order must list each of the ${sdkPackages.length} packages exactly once`);
  }
  for (const { manifest } of manifests) {
    const dependents = Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith('@seemplify/'));
    for (const dependency of dependents) {
      if (order.indexOf(dependency) >= order.indexOf(manifest.name)) {
        findings.push(`the publish order places ${manifest.name} before its exact dependency ${dependency}`);
      }
    }
  }
  return { manifests, coordinated, findings };
}

/**
 * Repository-enforced foundation state. This stays local and non-publishing:
 * it checks whether the manifests, package LICENSE files and policy agree with
 * each other, whether the foundation is still locked or already prepared for a
 * later owner-approved release step.
 */
function auditFoundation(policy) {
  const findings = [];
  const approved = policy.release?.approvedLicences ?? [];
  const licenceApproved = Array.isArray(approved) && approved.length > 0;
  const licenceLocked = policy.lockedFoundation.licenceKeyForbidden === true
    || policy.lockedFoundation.licenseFileForbidden === true;

  if (licenceLocked && licenceApproved) {
    findings.push('the policy records an approved licence while lockedFoundation still forbids one; opening the licence locks is the owner action that records it');
  }
  if (!licenceLocked && !licenceApproved) {
    findings.push('the licence locks are open but no approved SPDX identifier is recorded; the open state is only meaningful once an owner records one');
  }

  for (const spec of sdkPackages) {
    const { directory, manifest } = readManifest(spec);
    const hasLicenseFile = existsSync(path.join(directory, 'LICENSE'));
    if (policy.lockedFoundation.allPackagesPrivate === true) {
      if (manifest.private !== true) {
        findings.push(`${manifest.name} is no longer private:true; making a package public is not a qualification change`);
      }
    } else if (manifest.private !== false) {
      findings.push(`${manifest.name} is still private:true while the policy no longer requires it; the five packages must move together`);
    }
    if (policy.lockedFoundation.licenceKeyForbidden === true) {
      if (manifest.license !== undefined) {
        findings.push(`${manifest.name} declares license "${manifest.license}" but no licence has been legally approved`);
      }
    } else if (!approved.includes(manifest.license)) {
      findings.push(`${manifest.name} declares licence ${manifest.license ?? '<none>'}, which is not the approved [${approved.join(', ')}]`);
    }
    if (policy.lockedFoundation.licenseFileForbidden === true) {
      if (hasLicenseFile) {
        findings.push(`${manifest.name} has a LICENSE file but no licence has been legally approved`);
      }
    } else if (!hasLicenseFile) {
      findings.push(`${manifest.name} has no LICENSE file in its own package directory`);
    }
    if (policy.lockedFoundation.coordinatedVersion && manifest.version !== policy.lockedFoundation.coordinatedVersion) {
      findings.push(`${manifest.name} is ${manifest.version} but the recorded foundation version is ${policy.lockedFoundation.coordinatedVersion}`);
    }
  }

  const stage = licenceLocked
    ? 'locked'
    : policy.lockedFoundation.allPackagesPrivate === true
      ? 'licensed, still private'
      : 'prepared for release';
  const summary = licenceLocked
    ? 'all five packages private:true, no licence key, no LICENSE file - consistent with an unapproved licence'
    : `all five packages licensed ${approved.join(', ')} with a LICENSE file in each package directory, private:${policy.lockedFoundation.allPackagesPrivate === true}`;
  return { stage, summary, findings };
}

/**
 * Non-publish qualification. Succeeds when the recorded foundation state is
 * internally consistent, and reports the external blockers without turning
 * red, because none of them is locally actionable. It contains no `npm publish`
 * and contacts no registry under any environment combination.
 */
function qualify() {
  const policy = loadPolicy();
  console.log(`SDK qualification policy v${policy.policyVersion} (repository-enforced local scope only)\n`);
  const observed = assertLocalMatrix(policy);

  console.log('\nmanifest coordination:');
  const { coordinated, findings } = auditManifestCoordination(policy);
  if (findings.length) fail(`Manifest coordination is inconsistent:\n  - ${findings.join('\n  - ')}`);
  console.log(`  five packages coordinated at ${coordinated}, every internal @seemplify dependency pinned exactly to it`);
  console.log(`  mandatory publish order: ${policy.release.mandatoryPublishOrder.join(' -> ')}`);

  console.log('\nfoundation state:');
  const foundation = auditFoundation(policy);
  if (foundation.findings.length) {
    fail(`The recorded foundation state is inconsistent:\n  - ${foundation.findings.join('\n  - ')}`);
  }
  console.log(`  stage: ${foundation.stage}`);
  console.log(`  ${foundation.summary}`);

  console.log('\nworkflow template:');
  verifyWorkflowTemplate(policy, { quiet: true });
  console.log(`  ${String(policy.release?.workflowTemplate)} is present, ${policy.release?.workflowMustStayDisabled ? 'disabled, ' : ''}and aligned with the recorded publish policy`);

  for (const spec of sdkPackages) verifyPackage(spec, { quiet: true });
  console.log(`  all ${sdkPackages.length} packages pass the deterministic artifact gate`);

  console.log('\nknown release blockers (reported, not asserted satisfied):');
  for (const item of policy.externalBlockers.items) console.log(`  - ${item}`);

  console.log(`\nqualified locally on Node ${observed.node} / TypeScript ${observed.typescript} / esbuild ${observed.esbuild} / React ${observed.react}.`);
  console.log('\nThis is repository-enforced local qualification. It is not a public browser, device or operating-system support promise.');
  console.log(`The five packages carry release-shaped metadata (licensed ${policy.release.approvedLicences.join(', ')}, LICENSE per package directory, private:false), but nothing has been published: this command contacts no registry, ${policy.release.workflowTemplate} is still disabled, and publication additionally requires release-ready plus confirmation ${policy.release.confirmation} in the ${policy.release.environment} environment.`);
}

function releaseReady() {
  const policy = loadPolicy();
  const version = process.env.SDK_RELEASE_VERSION;
  if (process.env.SDK_PUBLISH_CONFIRM !== policy.release?.confirmation) {
    fail(`SDK_PUBLISH_CONFIRM must equal ${policy.release?.confirmation}`);
  }
  // Previously optional, which meant the everyday invocation performed no
  // version check at all. Exact internal pins make the coordinated version the
  // whole point of the gate, so it is now mandatory.
  if (!version) {
    fail('SDK_RELEASE_VERSION must name the exact approved coordinated version');
  }
  const approved = policy.release.approvedLicences;
  if (!Array.isArray(approved) || !approved.length) {
    fail('No approved SPDX licence is recorded in the qualification policy; the licence decision is an owner action and this gate must stay closed until it is made');
  }
  for (const spec of sdkPackages) {
    const { directory, manifest } = verifyPackage(spec, { quiet: true });
    if (manifest.private === true) fail(`${manifest.name} is still private`);
    // An arbitrary non-empty string used to pass here, including "UNLICENSED".
    if (!approved.includes(manifest.license)) {
      fail(`${manifest.name} declares licence ${manifest.license ?? '<none>'}, which is not in the approved list [${approved.join(', ')}]`);
    }
    // npm only packs a LICENSE from the package directory, so a workspace-root
    // fallback would ship five tarballs with no licence text in them.
    if (!existsSync(path.join(directory, 'LICENSE'))) {
      fail(`${manifest.name} has no LICENSE file in its own package directory`);
    }
    if (manifest.version !== version) fail(`${manifest.name} version ${manifest.version} does not match ${version}`);
  }
  const { findings } = auditManifestCoordination(policy);
  if (findings.length) fail(`Manifest coordination is inconsistent:\n  - ${findings.join('\n  - ')}`);
  assertLocalMatrix(policy, { quiet: true });
  verifyWorkflowTemplate(policy, { quiet: true });
  dryRunPacks();
  console.log('SDK manifests and artifacts passed the explicit publication gate.');
}

export function runCli(action, argument) {
  switch (action) {
    case 'clean':
      cleanPackage(packageSpec(argument));
      break;
    case 'clean-all':
      sdkPackages.forEach(cleanPackage);
      break;
    case 'mark-cjs':
      emitCjsDirectoryManifest(packageSpec(argument));
      break;
    case 'verify':
      verifyPackage(packageSpec(argument));
      break;
    case 'verify-all':
      sdkPackages.forEach((spec) => verifyPackage(spec));
      break;
    case 'deterministic':
      buildDeterministically();
      break;
    case 'pack-dry-run':
      dryRunPacks();
      break;
    case 'qualify':
      qualify();
      break;
    case 'release-ready':
      releaseReady();
      break;
    default:
      fail(`Unknown action: ${action || '<missing>'}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [action, argument] = process.argv.slice(2);
  runCli(action, argument);
}
