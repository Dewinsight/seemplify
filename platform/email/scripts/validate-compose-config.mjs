#!/usr/bin/env node
/**
 * Configuration gate for the Dokploy mail stack.
 *
 * Two independent checks live here:
 *
 *   * `validateCompose` reads the production compose file and asserts the
 *     invariants that keep a deploy safe — no published ports, cutover gates
 *     that default closed, state on named volumes, no literal credentials, and
 *     no egress path from MariaDB or the Mail API.
 *   * `validateEnvironment` reads the values an operator put into Dokploy and
 *     asserts they are internally consistent — a tunnel replica with no token,
 *     or two active workers, is caught before anything is deployed.
 *
 * Neither ever prints a configuration value. Findings name the variable and
 * describe the problem; the value stays where it is.
 *
 * Usage:
 *   node validate-compose-config.mjs [--compose <path>] [--env <path>]
 *                                    [--from-environment] [--json]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './lib/mini-yaml.mjs';
import { parseApiKeys } from '../api/src/security.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_COMPOSE = path.join(here, '..', 'compose', 'docker-compose.dokploy.yml');

const PROJECT_NAME = 'seemplify-mail-prod';
const REQUIRED_SERVICES = ['mariadb', 'postal-web', 'postal-worker', 'postal-smtp', 'postfix-relay', 'mail-api', 'cloudflared'];
/** Exactly one of each may run in production; see the compose header. */
const GATED_SERVICES = new Map([
  ['mail-api', 'MAIL_API_REPLICAS'],
  ['postal-worker', 'POSTAL_WORKER_REPLICAS'],
  ['cloudflared', 'MAIL_TUNNEL_REPLICAS'],
]);
const HEALTHCHECKED_SERVICES = ['mariadb', 'postal-web', 'postal-smtp', 'postfix-relay', 'mail-api'];
const STATE_VOLUMES = ['mariadb-data', 'postal-config', 'relay-spool', 'mail-api-data'];
/** Nothing here may reach the internet, whatever else the compose file says. */
const NO_EGRESS_SERVICES = ['mariadb', 'mail-api'];
const INTERNAL_NETWORKS = ['mail-internal', 'relay-internal'];

/** Values that must arrive by interpolation, never as text in the file. */
const SECRET_ENV_KEYS = new Set([
  'MARIADB_PASSWORD', 'MARIADB_ROOT_PASSWORD', 'RELAY_SMTP_PASSWORD', 'MAIL_API_KEYS',
  'MAIL_API_ADDRESS_HASH_SALT', 'MAIL_API_POSTAL_API_KEY', 'MAIL_API_POSTAL_WEBHOOK_TOKEN',
  'MAIL_API_WEBHOOK_HMAC_SECRET', 'TUNNEL_TOKEN', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY',
  'BACKUP_MARIADB_PASSWORD',
]);

/** Interpolations that must use `:?` so a missing value stops the deploy. */
const REQUIRED_INTERPOLATIONS = [
  'MARIADB_DATABASE', 'MARIADB_USER', 'MARIADB_PASSWORD', 'MARIADB_ROOT_PASSWORD',
  'RELAY_SMTP_USERNAME', 'RELAY_SMTP_PASSWORD', 'RELAY_ALLOWED_NETWORKS',
  'MAIL_API_KEYS', 'MAIL_API_ADDRESS_HASH_SALT', 'MAIL_API_POSTAL_API_KEY',
  'MAIL_API_POSTAL_WEBHOOK_TOKEN', 'MAIL_API_WEBHOOK_HMAC_SECRET', 'MAIL_TUNNEL_IMAGE',
];

const REQUIRED_ENV_KEYS = [
  'MARIADB_DATABASE', 'MARIADB_USER', 'MARIADB_PASSWORD', 'MARIADB_ROOT_PASSWORD',
  'RELAY_SMTP_USERNAME', 'RELAY_SMTP_PASSWORD', 'RELAY_ALLOWED_NETWORKS',
  'MAIL_API_KEYS', 'MAIL_API_ADDRESS_HASH_SALT', 'MAIL_API_POSTAL_API_KEY',
  'MAIL_API_POSTAL_WEBHOOK_TOKEN', 'MAIL_API_WEBHOOK_HMAC_SECRET', 'MAIL_TUNNEL_IMAGE',
];

function interpolationOf(value) {
  const match = /^\$\{([A-Z0-9_]+)(:\?|:-|-|\?)?([\s\S]*)\}$/.exec(String(value ?? '').trim());
  if (!match) return null;
  return { name: match[1], operator: match[2] ?? null, argument: match[3] ?? '' };
}

function asList(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Compose accepts networks as a list of names or a map keyed by name. */
function networkNames(service) {
  const networks = service?.networks;
  if (!networks) return [];
  return Array.isArray(networks) ? networks.map(String) : Object.keys(networks);
}

export function validateCompose(document, { source = 'compose' } = {}) {
  const findings = [];
  const fail = (rule, detail) => findings.push({ level: 'error', rule, detail, source });
  const services = document?.services ?? {};
  const volumes = document?.volumes ?? {};
  const networks = document?.networks ?? {};

  if (document?.name !== PROJECT_NAME) {
    fail('project-isolation', `The compose project must be "${PROJECT_NAME}" so its volumes cannot collide with the local "seemplify-mail" stack.`);
  }

  for (const name of REQUIRED_SERVICES) {
    if (!services[name]) fail('required-service', `Service "${name}" is missing.`);
  }

  for (const [name, service] of Object.entries(services)) {
    if (!service || typeof service !== 'object') {
      fail('service-shape', `Service "${name}" is not a mapping.`);
      continue;
    }

    // Fail-closed ingress: the Cloudflare tunnel is the only way in.
    if (service.ports) {
      fail('no-published-ports', `Service "${name}" publishes host ports; production ingress must be the Cloudflare tunnel alone.`);
    }

    const oneShot = Boolean(service.profiles);
    if (!oneShot && service.restart !== 'unless-stopped') {
      fail('restart-policy', `Service "${name}" must set "restart: unless-stopped".`);
    }

    const limits = service.deploy?.resources?.limits;
    if (!limits?.memory) fail('resource-limits', `Service "${name}" has no memory limit.`);
    if (!limits?.cpus) fail('resource-limits', `Service "${name}" has no CPU limit.`);

    for (const [key, value] of Object.entries(service.environment ?? {})) {
      if (!SECRET_ENV_KEYS.has(key)) continue;
      if (!interpolationOf(value)) {
        fail('no-literal-secrets', `Service "${name}" sets ${key} to a literal value; it must interpolate from Dokploy environment configuration.`);
      }
    }
  }

  for (const [name, variable] of GATED_SERVICES) {
    const service = services[name];
    if (!service) continue;
    const replicas = service.deploy?.replicas;
    const interpolation = interpolationOf(replicas);
    if (!interpolation) {
      fail('cutover-gate', `Service "${name}" must gate deploy.replicas on \${${variable}:-0}.`);
      continue;
    }
    if (interpolation.name !== variable) {
      fail('cutover-gate', `Service "${name}" gates on ${interpolation.name}; it must gate on ${variable}.`);
    }
    if (interpolation.operator !== ':-' || interpolation.argument.trim() !== '0') {
      fail('cutover-gate', `Service "${name}" must default ${variable} to 0 so an unfinished migration cannot activate it.`);
    }
  }

  for (const name of HEALTHCHECKED_SERVICES) {
    const test = services[name]?.healthcheck?.test;
    if (!test || asList(test).length === 0) fail('healthcheck', `Service "${name}" has no healthcheck.`);
  }

  const sendEnabled = interpolationOf(services['mail-api']?.environment?.MAIL_API_SEND_ENABLED);
  if (!sendEnabled || sendEnabled.operator !== ':-' || String(sendEnabled.argument).trim() !== 'false') {
    fail('fail-closed-sending', 'mail-api must default MAIL_API_SEND_ENABLED to false.');
  }

  const declaredInterpolations = new Set();
  const collect = (value) => {
    if (Array.isArray(value)) { value.forEach(collect); return; }
    if (value && typeof value === 'object') { Object.values(value).forEach(collect); return; }
    for (const match of String(value ?? '').matchAll(/\$\{([A-Z0-9_]+):\?/g)) declaredInterpolations.add(match[1]);
  };
  collect(services);
  for (const name of REQUIRED_INTERPOLATIONS) {
    if (!declaredInterpolations.has(name)) {
      fail('required-interpolation', `${name} must be interpolated with \${${name}:?...} so a missing value stops the deploy.`);
    }
  }

  for (const name of STATE_VOLUMES) {
    if (!(name in volumes)) fail('state-volume', `Named volume "${name}" is missing; state would not survive a redeploy.`);
  }
  for (const [name, definition] of Object.entries(volumes)) {
    if (definition?.external) {
      fail('named-volume', `Volume "${name}" is external; production volumes must be created and owned by this compose project.`);
    }
  }

  for (const name of INTERNAL_NETWORKS) {
    if (networks[name]?.internal !== true) fail('private-network', `Network "${name}" must set "internal: true".`);
  }
  const egressNetworks = new Set(Object.entries(networks).filter(([, value]) => value?.internal !== true).map(([key]) => key));
  for (const name of NO_EGRESS_SERVICES) {
    const attached = networkNames(services[name]).filter((network) => egressNetworks.has(network));
    if (attached.length) {
      fail('no-egress', `Service "${name}" is attached to ${attached.join(', ')}, which has a route off the host.`);
    }
  }

  if (services['mail-backup'] && !asList(services['mail-backup'].profiles).length) {
    fail('backup-opt-in', 'mail-backup must sit behind a compose profile so deploying never starts billable object storage on its own.');
  }

  return findings;
}

function boolish(value) {
  return ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'].includes(String(value ?? '').trim().toLowerCase());
}

function isTrue(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

export function validateEnvironment(env, { source = 'environment' } = {}) {
  const findings = [];
  const fail = (rule, detail) => findings.push({ level: 'error', rule, detail, source });
  const warn = (rule, detail) => findings.push({ level: 'warning', rule, detail, source });
  const value = (key) => String(env[key] ?? '').trim();

  for (const key of REQUIRED_ENV_KEYS) {
    if (!value(key)) fail('required-value', `${key} is not set.`);
  }

  const gates = {};
  for (const variable of GATED_SERVICES.values()) {
    const raw = value(variable) || '0';
    if (!/^[01]$/.test(raw)) {
      fail('cutover-gate', `${variable} must be exactly 0 or 1; a second active instance would double-send or split ingress.`);
      continue;
    }
    gates[variable] = Number(raw);
  }

  if (gates.MAIL_TUNNEL_REPLICAS === 1 && !value('MAIL_TUNNEL_TOKEN')) {
    fail('tunnel-token', 'MAIL_TUNNEL_REPLICAS is 1 but MAIL_TUNNEL_TOKEN is empty; the connector would restart forever and ingress would stay down.');
  }
  if (gates.MAIL_TUNNEL_REPLICAS === 0 && value('MAIL_TUNNEL_TOKEN')) {
    warn('tunnel-token', 'MAIL_TUNNEL_TOKEN is set while MAIL_TUNNEL_REPLICAS is 0. This is the expected pre-cutover state.');
  }

  const image = value('MAIL_TUNNEL_IMAGE');
  if (image && (/:latest$/.test(image) || !image.includes(':'))) {
    fail('pinned-image', 'MAIL_TUNNEL_IMAGE must name an explicit version or digest, not a floating tag.');
  }

  if (value('MAIL_API_SEND_ENABLED') && !boolish(value('MAIL_API_SEND_ENABLED'))) {
    fail('fail-closed-sending', 'MAIL_API_SEND_ENABLED must be a boolean literal; anything unparsable is treated as false and would silently disable sending.');
  }
  if (isTrue(value('MAIL_API_SEND_ENABLED')) && !value('MAIL_API_POSTAL_API_KEY')) {
    fail('fail-closed-sending', 'MAIL_API_SEND_ENABLED is true but MAIL_API_POSTAL_API_KEY is empty; the API would refuse to start.');
  }

  const keys = value('MAIL_API_KEYS');
  if (keys) {
    try {
      // Same parser the service uses, so a key that passes here starts there.
      const parsed = parseApiKeys(keys);
      if (parsed.size === 0) fail('api-keys', 'MAIL_API_KEYS parsed to zero credentials; every authenticated route would refuse traffic.');
    } catch (error) {
      fail('api-keys', `MAIL_API_KEYS is malformed: ${error.message}`);
    }
  }
  if (gates.MAIL_API_REPLICAS === 1 && !keys) {
    fail('api-keys', 'MAIL_API_REPLICAS is 1 but MAIL_API_KEYS is empty; the API would answer every authenticated route with 503.');
  }

  // Checked by shape only. The value is never echoed, compared or logged.
  const relayPassword = String(env.RELAY_SMTP_PASSWORD ?? '').replace(/\s+/g, '');
  if (relayPassword && !/^[a-z]{16}$/.test(relayPassword)) {
    fail('relay-credential', 'RELAY_SMTP_PASSWORD is not shaped like a Google app password (16 letters once spaces are removed); the relay would refuse to start.');
  }

  const domain = value('MAIL_API_DOMAIN') || 'seemplifyai.com';
  const bounceDomain = value('MAIL_API_BOUNCE_DOMAIN') || 'bounce.seemplifyai.com';
  if (bounceDomain === domain || !bounceDomain.endsWith(`.${domain}`)) {
    fail('bounce-domain', 'MAIL_API_BOUNCE_DOMAIN must be a subdomain of MAIL_API_DOMAIN; sharing the apex collides with Google Workspace inbound mail.');
  }

  const proxyHops = value('MAIL_API_TRUSTED_PROXY_HOPS');
  if (proxyHops && !/^[0-5]$/.test(proxyHops)) {
    fail('proxy-hops', 'MAIL_API_TRUSTED_PROXY_HOPS must be between 0 and 5.');
  }

  return findings;
}

export function parseEnvFile(text) {
  const env = {};
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    let raw = trimmed.slice(separator + 1).trim();
    if (raw.length >= 2 && ((raw[0] === '"' && raw.at(-1) === '"') || (raw[0] === "'" && raw.at(-1) === "'"))) {
      raw = raw.slice(1, -1);
    }
    env[trimmed.slice(0, separator).trim()] = raw;
  }
  return env;
}

function parseArgs(argv) {
  const options = { compose: DEFAULT_COMPOSE, env: null, fromEnvironment: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--compose') options.compose = argv[++index];
    else if (arg === '--env') options.env = argv[++index];
    else if (arg === '--from-environment') options.fromEnvironment = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--no-compose') options.compose = null;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function main(argv) {
  const options = parseArgs(argv);
  const findings = [];

  if (options.compose) {
    const document = parseYaml(readFileSync(options.compose, 'utf8'));
    findings.push(...validateCompose(document, { source: path.basename(options.compose) }));
  }
  if (options.env) {
    findings.push(...validateEnvironment(parseEnvFile(readFileSync(options.env, 'utf8')), { source: path.basename(options.env) }));
  }
  if (options.fromEnvironment) {
    findings.push(...validateEnvironment(process.env, { source: 'process environment' }));
  }

  const errors = findings.filter((finding) => finding.level === 'error');
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ok: errors.length === 0, findings }, null, 2)}\n`);
  } else {
    for (const finding of findings) {
      process.stdout.write(`${finding.level === 'error' ? 'FAIL' : 'warn'}  [${finding.rule}] ${finding.detail}\n`);
    }
    process.stdout.write(errors.length
      ? `\n${errors.length} configuration problem(s) must be fixed before deploying.\n`
      : '\nConfiguration checks passed.\n');
  }
  return errors.length ? 1 : 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`validate-compose-config: ${error.message}\n`);
    process.exitCode = 2;
  }
}

export { DEFAULT_COMPOSE, GATED_SERVICES, REQUIRED_SERVICES, STATE_VOLUMES };
