#!/usr/bin/env node
/**
 * Turns an observed inventory of the local machine into the exact list of
 * things cleanup is permitted to destroy.
 *
 * The rule is allowlist-only, and it is enforced twice. This module builds a
 * plan in which every action's target was matched against
 * `cleanup-allowlist.json` by exact string equality; `cleanup.ps1` then
 * re-checks each target against the same file immediately before it runs the
 * command. Two independent checks against one data file is what makes a typo,
 * a stale name or a similarly-named container from another project unable to
 * reach a `docker rm`.
 *
 * What this module never does:
 *
 *   * match by prefix, wildcard, regular expression or Docker label filter for
 *     containers and volumes — a name is in the list or it is not a target;
 *   * invent a target the inventory did not report;
 *   * carry anything from the inventory into the plan unexamined. Everything
 *     rejected is returned with a reason, so a surprising exclusion is visible
 *     rather than silent.
 *
 * The tunnel connector is the one operator-named target, because its container
 * or service name is a local decision. It is still constrained: the name must
 * be supplied explicitly and its image or service name must match the
 * cloudflared pattern in the allowlist.
 *
 * Importing this module has no side effects.
 *
 * Usage:
 *   node cleanup-plan.mjs --inventory <file.json> [--categories a,b] [--json]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ALLOWLIST_PATH = path.join(here, 'cleanup-allowlist.json');

export function loadAllowlist(allowlistPath = ALLOWLIST_PATH) {
  const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'));
  if (allowlist.schema !== 'seemplify-mail-cleanup/1') {
    throw new Error(`Unsupported cleanup allowlist schema: ${allowlist.schema}`);
  }
  const volumes = allowlist.categories?.volumes;
  if (!volumes || volumes.names.length !== volumes.exactCount) {
    throw new Error(`The volume allowlist declares exactCount ${volumes?.exactCount} but lists ${volumes?.names.length}.`);
  }
  return allowlist;
}

export const CATEGORIES = ['containers', 'volumes', 'tunnel', 'migration', 'relay-runtime'];

function reject(rejected, kind, target, reason) {
  rejected.push({ kind, target, reason });
}

/**
 * @param inventory {{containers?: Array<{name:string, image?:string, project?:string}>,
 *                    volumes?: string[], images?: string[], migrationPaths?: Array<{path:string, name:string}>,
 *                    repositoryPaths?: Array<{path:string, repositoryRelative:string}>,
 *                    tunnel?: {kind:'container'|'service', name:string, image?:string}}}
 */
export function buildCleanupPlan(inventory = {}, { categories = CATEGORIES, allowlist = loadAllowlist() } = {}) {
  const selected = new Set(categories);
  for (const category of selected) {
    if (!CATEGORIES.includes(category)) throw new Error(`Unknown cleanup category: ${category}`);
  }
  const actions = [];
  const rejected = [];
  const definitions = allowlist.categories;

  if (selected.has('containers')) {
    const allowed = new Set(definitions.containers.names);
    for (const container of inventory.containers ?? []) {
      if (!allowed.has(container.name)) {
        reject(rejected, 'container', container.name, 'not named in the cleanup allowlist');
        continue;
      }
      // Belt and braces: the name is allowlisted *and* Docker must agree the
      // container belongs to the retired Compose project.
      if (definitions.containers.requireComposeProjectLabel && container.project !== allowlist.project) {
        reject(rejected, 'container', container.name, `carries Compose project "${container.project ?? 'none'}", not "${allowlist.project}"`);
        continue;
      }
      actions.push({ kind: 'container', category: 'containers', target: container.name, reversible: true });
    }
  }

  if (selected.has('volumes')) {
    const allowed = new Set(definitions.volumes.names);
    for (const volume of inventory.volumes ?? []) {
      if (!allowed.has(volume)) {
        reject(rejected, 'volume', volume, 'not named in the cleanup allowlist');
        continue;
      }
      actions.push({ kind: 'volume', category: 'volumes', target: volume, reversible: false });
    }
  }

  if (selected.has('tunnel')) {
    const tunnel = inventory.tunnel;
    const definition = definitions.tunnel;
    if (!tunnel?.name) {
      reject(rejected, 'tunnel', tunnel?.name ?? '(none)', 'no connector was named; the tunnel is never guessed at');
    } else if (tunnel.kind === 'container') {
      const pattern = new RegExp(definition.containerImagePattern);
      if (!pattern.test(String(tunnel.image ?? ''))) {
        reject(rejected, 'tunnel', tunnel.name, `image "${tunnel.image ?? 'unknown'}" does not match ${definition.containerImagePattern}`);
      } else {
        actions.push({ kind: 'tunnel-container', category: 'tunnel', target: tunnel.name, reversible: true });
      }
    } else if (tunnel.kind === 'service') {
      if (!new RegExp(definition.serviceNamePattern).test(tunnel.name)) {
        reject(rejected, 'tunnel', tunnel.name, `service name does not match ${definition.serviceNamePattern}`);
      } else {
        actions.push({ kind: 'tunnel-service', category: 'tunnel', target: tunnel.name, reversible: true });
      }
    } else {
      reject(rejected, 'tunnel', tunnel.name, `unknown connector kind "${tunnel.kind}"`);
    }
  }

  if (selected.has('migration')) {
    const allowed = new Set(definitions.migration.relativePaths);
    const keep = new Set(definitions.migration.keepRelativePaths ?? []);
    for (const entry of inventory.migrationPaths ?? []) {
      if (keep.has(entry.name)) {
        reject(rejected, 'path', entry.path, 'the migration journal is kept as the record of what was done');
        continue;
      }
      if (!allowed.has(entry.name)) {
        reject(rejected, 'path', entry.path, 'not one of the migration paths in the allowlist');
        continue;
      }
      actions.push({ kind: 'path', category: 'migration', target: entry.path, reversible: false });
    }
  }

  if (selected.has('relay-runtime')) {
    const allowedImages = new Set(definitions['relay-runtime'].images);
    for (const image of inventory.images ?? []) {
      if (!allowedImages.has(image)) {
        reject(rejected, 'image', image, 'not named in the cleanup allowlist');
        continue;
      }
      actions.push({ kind: 'image', category: 'relay-runtime', target: image, reversible: true });
    }
    const allowedPaths = new Set(definitions['relay-runtime'].repositoryRelativePaths);
    for (const entry of inventory.repositoryPaths ?? []) {
      if (!allowedPaths.has(entry.repositoryRelative)) {
        reject(rejected, 'path', entry.path, 'not named in the cleanup allowlist');
        continue;
      }
      actions.push({ kind: 'path', category: 'relay-runtime', target: entry.path, reversible: false });
    }
  }

  return { schema: allowlist.schema, actions, rejected, categories: [...selected] };
}

/**
 * The second check. Called with a plan that may have travelled through a file
 * or another process, it re-derives every permitted target from the allowlist
 * and throws unless each action still matches one exactly.
 */
export function assertPlanSafe(plan, { allowlist = loadAllowlist(), tunnelName = null, migrationRoot = null, repositoryRoot = null } = {}) {
  const definitions = allowlist.categories;
  const problems = [];
  const normalise = (value) => String(value).replace(/\\/g, '/').replace(/\/+$/, '');

  for (const action of plan?.actions ?? []) {
    switch (action.kind) {
      case 'container':
        if (!definitions.containers.names.includes(action.target)) problems.push(`container ${action.target}`);
        break;
      case 'volume':
        if (!definitions.volumes.names.includes(action.target)) problems.push(`volume ${action.target}`);
        break;
      case 'image':
        if (!definitions['relay-runtime'].images.includes(action.target)) problems.push(`image ${action.target}`);
        break;
      case 'tunnel-container':
      case 'tunnel-service':
        if (!tunnelName || action.target !== tunnelName) problems.push(`tunnel ${action.target} is not the connector the operator named`);
        break;
      case 'path': {
        const target = normalise(action.target);
        const permitted = [];
        if (migrationRoot) {
          for (const name of definitions.migration.relativePaths) permitted.push(normalise(`${migrationRoot}/${name}`));
        }
        if (repositoryRoot) {
          for (const name of definitions['relay-runtime'].repositoryRelativePaths) permitted.push(normalise(`${repositoryRoot}/${name}`));
        }
        if (!permitted.includes(target)) problems.push(`path ${action.target}`);
        break;
      }
      default:
        problems.push(`unknown action kind ${action.kind}`);
    }
  }

  const volumeActions = (plan?.actions ?? []).filter((action) => action.kind === 'volume');
  if (volumeActions.length > definitions.volumes.exactCount) {
    problems.push(`${volumeActions.length} volumes are planned; the allowlist permits at most ${definitions.volumes.exactCount}`);
  }

  if (problems.length) {
    throw new Error(`Refusing to run a cleanup plan with target(s) outside the allowlist: ${problems.join(', ')}`);
  }
  return true;
}

function parseArgs(argv) {
  const options = { inventory: null, categories: CATEGORIES, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--inventory') options.inventory = argv[++index];
    else if (arg === '--categories') options.categories = argv[++index].split(',').map((value) => value.trim()).filter(Boolean);
    else if (arg === '--json') options.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.inventory) throw new Error('Pass --inventory <file.json>.');
  return options;
}

function main(argv) {
  const options = parseArgs(argv);
  const inventory = JSON.parse(readFileSync(options.inventory, 'utf8'));
  const plan = buildCleanupPlan(inventory, { categories: options.categories });
  if (options.json) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  else {
    for (const action of plan.actions) process.stdout.write(`remove  ${action.kind.padEnd(16)} ${action.target}${action.reversible ? '' : '  (irreversible)'}\n`);
    for (const entry of plan.rejected) process.stdout.write(`keep    ${entry.kind.padEnd(16)} ${entry.target}  — ${entry.reason}\n`);
  }
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`cleanup-plan: ${error.message}\n`);
    process.exitCode = 2;
  }
}
