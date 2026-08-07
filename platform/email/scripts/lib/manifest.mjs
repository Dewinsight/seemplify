#!/usr/bin/env node
/**
 * SHA-256 manifest for a migration snapshot.
 *
 * One implementation, used by every side of the migration:
 *
 *   * the PowerShell phases call this file to write and to verify, so the
 *     digests a snapshot carries were produced by the code the tests exercise;
 *   * the Dokploy host verifies with its own `sha256sum -c` against the
 *     SHA256SUMS this file writes, which is a genuinely independent check
 *     rather than a number the transfer carried along with the data.
 *
 * Verification is deliberately strict in three directions, because each is a
 * different way a snapshot can be wrong:
 *
 *   1. a listed file whose bytes changed          -> checksum mismatch
 *   2. a file present on disk but not in the list -> unexpected file
 *   3. a SHA256SUMS that disagrees with manifest.json -> the two records were
 *      not written together, so neither can be trusted
 *
 * Importing this module has no side effects.
 *
 * Usage:
 *   node manifest.mjs write  --dir <snapshot> --phase <name> [--project <p>]
 *                            [--host <h>] [--extra <json>]
 *   node manifest.mjs verify --dir <snapshot> [--json]
 */
import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST_NAME = 'manifest.json';
export const SUMS_NAME = 'SHA256SUMS';
export const MANIFEST_SCHEMA = 'seemplify-mail-migration/1';

/** Files that describe the snapshot rather than being part of it. */
const RECORD_FILES = new Set([MANIFEST_NAME, SUMS_NAME]);

export async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export function sha256Text(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

/** Payload files in a snapshot directory, sorted so a manifest is reproducible. */
export function snapshotFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !RECORD_FILES.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/**
 * `sha256sum -c` format: digest, two spaces, a binary marker, the name. Written
 * with LF endings and no BOM — GNU coreutils matches neither a CRLF line nor a
 * BOM-prefixed first entry, and a Windows-authored file gets both by default.
 */
export function formatSums(entries) {
  return `${entries.map((entry) => `${entry.sha256} *${entry.name}`).join('\n')}\n`;
}

export function parseSums(text) {
  const entries = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([a-f0-9]{64}) [ *](.+)$/.exec(line);
    if (!match) throw new Error(`Unparsable ${SUMS_NAME} line: ${line}`);
    entries.push({ sha256: match[1], name: match[2] });
  }
  return entries;
}

export async function buildManifest(directory, { phase, project = 'seemplify-mail', host = '', extra = {} } = {}) {
  if (!phase) throw new Error('A manifest needs a phase name.');
  const files = [];
  for (const name of snapshotFiles(directory)) {
    const full = path.join(directory, name);
    files.push({ name, bytes: statSync(full).size, sha256: await sha256File(full) });
  }
  if (files.length === 0) throw new Error(`${directory} holds no payload files; refusing to write a manifest for an empty snapshot.`);
  return {
    schema: MANIFEST_SCHEMA,
    phase,
    createdAt: new Date().toISOString(),
    host,
    project,
    files,
    ...extra,
  };
}

export async function writeManifest(directory, options = {}) {
  const manifest = await buildManifest(directory, options);
  writeFileSync(path.join(directory, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(directory, SUMS_NAME), formatSums(manifest.files), 'utf8');
  return manifest;
}

/**
 * Re-hashes every payload file and cross-checks both records.
 * Returns `{ ok, problems, manifest }` and never throws for a bad snapshot —
 * an unreadable or absent record is itself reported as a problem, so a caller
 * cannot mistake "could not check" for "checked and fine".
 */
export async function verifyManifest(directory) {
  const problems = [];
  let manifest = null;

  try {
    manifest = JSON.parse(readFileSync(path.join(directory, MANIFEST_NAME), 'utf8'));
  } catch (error) {
    return { ok: false, problems: [`${MANIFEST_NAME} is missing or unreadable: ${error.message}`], manifest: null };
  }
  if (manifest?.schema !== MANIFEST_SCHEMA) {
    problems.push(`${MANIFEST_NAME} declares schema "${manifest?.schema}"; expected "${MANIFEST_SCHEMA}".`);
  }
  const listed = Array.isArray(manifest?.files) ? manifest.files : [];
  if (listed.length === 0) problems.push(`${MANIFEST_NAME} lists no files.`);

  for (const entry of listed) {
    const full = path.join(directory, entry.name);
    let size;
    try {
      size = statSync(full).size;
    } catch {
      problems.push(`missing: ${entry.name}`);
      continue;
    }
    if (size !== entry.bytes) {
      problems.push(`size changed: ${entry.name} (${entry.bytes} -> ${size} bytes)`);
      continue;
    }
    if ((await sha256File(full)) !== entry.sha256) problems.push(`checksum mismatch: ${entry.name}`);
  }

  // A file nobody recorded is as much a corruption of the snapshot as a file
  // whose bytes changed: the restore would find material the manifest never
  // vouched for.
  const recorded = new Set(listed.map((entry) => entry.name));
  for (const name of snapshotFiles(directory)) {
    if (!recorded.has(name)) problems.push(`unexpected file: ${name}`);
  }

  // SHA256SUMS is what the far side checks with its own tool. If it has drifted
  // from manifest.json the two were not written together and neither record can
  // be relied on, whatever the individual digests say.
  try {
    const sums = parseSums(readFileSync(path.join(directory, SUMS_NAME), 'utf8'));
    const byName = new Map(sums.map((entry) => [entry.name, entry.sha256]));
    if (sums.length !== listed.length) {
      problems.push(`${SUMS_NAME} lists ${sums.length} file(s); ${MANIFEST_NAME} lists ${listed.length}.`);
    }
    for (const entry of listed) {
      if (!byName.has(entry.name)) problems.push(`${SUMS_NAME} does not list ${entry.name}.`);
      else if (byName.get(entry.name) !== entry.sha256) problems.push(`${SUMS_NAME} disagrees with ${MANIFEST_NAME} for ${entry.name}.`);
    }
  } catch (error) {
    problems.push(`${SUMS_NAME} is missing or unreadable: ${error.message}`);
  }

  return { ok: problems.length === 0, problems, manifest };
}

function parseArgs(argv) {
  const options = { command: argv[0] ?? '', dir: null, phase: null, project: 'seemplify-mail', host: '', extra: {}, json: false };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dir') options.dir = argv[++index];
    else if (arg === '--phase') options.phase = argv[++index];
    else if (arg === '--project') options.project = argv[++index];
    else if (arg === '--host') options.host = argv[++index];
    else if (arg === '--extra') options.extra = JSON.parse(argv[++index]);
    else if (arg === '--json') options.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.dir) throw new Error('Pass --dir <snapshot directory>.');
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.command === 'write') {
    const manifest = await writeManifest(options.dir, options);
    process.stdout.write(`${JSON.stringify({ ok: true, files: manifest.files.length }, null, 2)}\n`);
    return 0;
  }
  if (options.command === 'verify') {
    const result = await verifyManifest(options.dir);
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      for (const problem of result.problems) process.stdout.write(`FAIL  ${problem}\n`);
      process.stdout.write(result.ok ? `${result.manifest.files.length} file(s) match their recorded checksums.\n` : `${result.problems.length} problem(s).\n`);
    }
    return result.ok ? 0 : 1;
  }
  throw new Error('Pass either "write" or "verify" as the first argument.');
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => { process.stderr.write(`manifest: ${error.message}\n`); process.exitCode = 2; },
  );
}
