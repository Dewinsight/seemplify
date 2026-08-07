#!/usr/bin/env node
/**
 * The queue gates that decide whether the migration may proceed.
 *
 * A message sitting in Postal or in the Postfix spool has been accepted from a
 * product but has not yet been handed to Google. Moving the stack out from
 * under it, or retiring the machine that holds it, strands it silently — the
 * product got its 202 and nothing ever bounces. So both queues must be empty
 * before the local stack is frozen and before anything is cleaned up.
 *
 * The single rule that shapes everything here: a queue that could not be read
 * is not an empty queue. Every parser below reports `readable: false` rather
 * than 0, and every gate treats that as closed.
 *
 * The spool itself is never migrated when it is empty. An empty spool is the
 * wanted state; copying it over a freshly initialised one only risks importing
 * stale Postfix metadata, and there is nothing in it to carry.
 *
 * Importing this module has no side effects.
 *
 * Usage:
 *   node queue-gates.mjs --postfix <file> --postal <count|file> [--json]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A queued message's summary line starts with its queue id: hex, at least five
 * characters, optionally suffixed with `*` (in progress) or `!` (on hold), then
 * whitespace before the size. Counting these is more reliable than looking for
 * the "Mail queue is empty" banner, which some Postfix builds word differently.
 *
 * scripts/linux/queue-inspect.sh carries the POSIX form of this pattern and
 * tests/queue-gates.test.mjs asserts the two have not drifted apart.
 */
export const POSTFIX_QUEUE_ID = /^[0-9A-F]{5,}[*!]?[ \t]/;
export const POSTFIX_QUEUE_ID_POSIX = '^[0-9A-F]{5,}[*!]?[[:space:]]';

const POSTFIX_EMPTY = /Mail queue is empty/i;
/** Output that means "the spool could not be read", never "the spool is empty". */
const POSTFIX_UNREADABLE = /(^|\n)\s*(postqueue|postfix|mail_queue)[^\n]*(fatal|error|warning: unable|Permission denied|Connection refused|No such file)/i;

export function parsePostfixQueue(text) {
  const raw = String(text ?? '').trim();
  if (POSTFIX_UNREADABLE.test(raw)) {
    return { readable: false, entries: null, empty: false, detail: 'postqueue reported an error; the spool depth is unknown.' };
  }
  if (raw === '' || POSTFIX_EMPTY.test(raw)) {
    return { readable: true, entries: 0, empty: true, detail: 'The Postfix spool is empty.' };
  }
  const entries = raw.split(/\r?\n/).filter((line) => POSTFIX_QUEUE_ID.test(line)).length;
  if (entries === 0) {
    // Output that is neither empty, nor an error we recognise, nor a queue
    // listing. Guessing "empty" here is exactly the failure this gate exists to
    // prevent.
    return { readable: false, entries: null, empty: false, detail: 'postqueue output was not recognised; refusing to read it as an empty spool.' };
  }
  return { readable: true, entries, empty: false, detail: `The Postfix spool holds ${entries} message(s).` };
}

/**
 * Postal v3 keeps its queue in MariaDB, so the depth arrives as a single
 * integer summed across every Postal database. Anything else is unreadable.
 */
export function parsePostalQueue(value) {
  const raw = String(value ?? '').trim();
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const last = lines.at(-1);
  if (!last || !/^\d+$/.test(last)) {
    return { readable: false, queued: null, empty: false, detail: 'Postal queue depth could not be read.' };
  }
  const queued = Number.parseInt(last, 10);
  return {
    readable: true,
    queued,
    empty: queued === 0,
    detail: queued === 0 ? 'Postal has nothing queued.' : `Postal still has ${queued} queued message(s).`,
  };
}

/** An empty spool is never migrated; a non-empty one always is. */
export function shouldMigrateSpool(postfix) {
  return Boolean(postfix?.readable && postfix.entries > 0);
}

/**
 * The gate itself. `open` is true only when both queues were read and both are
 * empty; every other combination, including an unreadable queue, is closed and
 * says why.
 */
export function evaluateQueueGate({ postfix, postal } = {}) {
  const reasons = [];
  if (!postfix?.readable) reasons.push(postfix?.detail ?? 'The Postfix spool could not be read.');
  else if (!postfix.empty) reasons.push(`The Postfix spool holds ${postfix.entries} message(s).`);
  if (!postal?.readable) reasons.push(postal?.detail ?? 'The Postal queue could not be read.');
  else if (!postal.empty) reasons.push(`Postal still has ${postal.queued} queued message(s).`);
  return {
    open: reasons.length === 0,
    reasons,
    postfix: postfix ?? null,
    postal: postal ?? null,
    migrateSpool: shouldMigrateSpool(postfix),
  };
}

function parseArgs(argv) {
  const options = { postfix: null, postal: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--postfix') options.postfix = argv[++index];
    else if (arg === '--postal') options.postal = argv[++index];
    else if (arg === '--json') options.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function readMaybeFile(value) {
  if (value === null || value === undefined) return '';
  try {
    return readFileSync(value, 'utf8');
  } catch {
    return value;
  }
}

function main(argv) {
  const options = parseArgs(argv);
  const gate = evaluateQueueGate({
    postfix: parsePostfixQueue(readMaybeFile(options.postfix)),
    postal: parsePostalQueue(readMaybeFile(options.postal)),
  });
  if (options.json) process.stdout.write(`${JSON.stringify(gate, null, 2)}\n`);
  else {
    process.stdout.write(`postfix: ${gate.postfix.detail}\n`);
    process.stdout.write(`postal:  ${gate.postal.detail}\n`);
    process.stdout.write(gate.open ? 'The cutover gate is open.\n' : `The cutover gate is closed:\n  - ${gate.reasons.join('\n  - ')}\n`);
  }
  return gate.open ? 0 : 1;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`queue-gates: ${error.message}\n`);
    process.exitCode = 2;
  }
}
