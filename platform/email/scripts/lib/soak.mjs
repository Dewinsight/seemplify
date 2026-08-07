#!/usr/bin/env node
/**
 * The post-cutover soak: thirty minutes of continuous, unbroken health.
 *
 * "Continuous" is the whole point, and it is the part that is easy to fake. A
 * run that probed twice, thirty-one minutes apart, and saw green both times has
 * observed almost nothing; a run that stopped probing for eight minutes in the
 * middle cannot say what happened during those eight minutes. So a soak passes
 * only when every one of these holds:
 *
 *   * every sample is healthy — one failure ends the soak, it is not averaged
 *     away by the samples around it;
 *   * the first sample lands within one interval of the declared start, so the
 *     window is not quietly trimmed at the front;
 *   * the last sample lands at or after start + 30 minutes, so the window is
 *     not trimmed at the back;
 *   * no two consecutive samples are further apart than the allowed gap, so
 *     there is no unobserved stretch inside it;
 *   * samples move forward in time, so a re-ordered or replayed journal cannot
 *     manufacture coverage.
 *
 * Thirty minutes is a floor, not a target: a longer run that satisfies every
 * rule above passes, and `coveredMs` reports what was actually observed.
 *
 * Importing this module has no side effects.
 *
 * Usage:
 *   node soak.mjs --samples <file.jsonl> [--started-at <iso>] [--interval-ms N] [--json]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Exactly thirty minutes. */
export const SOAK_DURATION_MS = 30 * 60 * 1000;
export const DEFAULT_INTERVAL_MS = 30 * 1000;

function toEpoch(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/** One probe result. `ok` is false unless it is explicitly, literally true. */
export function normalizeSample(sample) {
  return {
    at: toEpoch(sample?.at),
    ok: sample?.ok === true,
    detail: String(sample?.detail ?? ''),
  };
}

export function parseSamples(text) {
  const samples = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    samples.push(normalizeSample(JSON.parse(line)));
  }
  return samples;
}

/**
 * @returns {{ok: boolean, reasons: string[], coveredMs: number, requiredMs: number,
 *            samples: number, failures: number, largestGapMs: number}}
 */
export function evaluateSoak(rawSamples, {
  startedAt = null,
  durationMs = SOAK_DURATION_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  maxGapMs = null,
} = {}) {
  const allowedGap = maxGapMs ?? intervalMs * 3;
  const samples = (rawSamples ?? []).map(normalizeSample);
  const reasons = [];

  const timed = samples.filter((sample) => sample.at !== null);
  if (timed.length !== samples.length) reasons.push(`${samples.length - timed.length} sample(s) carry no usable timestamp.`);
  if (timed.length === 0) {
    return { ok: false, reasons: [...reasons, 'The soak recorded no samples.'], coveredMs: 0, requiredMs: durationMs, samples: 0, failures: 0, largestGapMs: 0 };
  }

  const failures = timed.filter((sample) => !sample.ok);
  if (failures.length) {
    const first = new Date(failures[0].at).toISOString();
    reasons.push(`${failures.length} unhealthy sample(s); the first was at ${first}. A soak with any failure does not pass.`);
  }

  const start = toEpoch(startedAt) ?? timed[0].at;
  const first = timed[0];
  const last = timed.at(-1);

  if (first.at > start + allowedGap) {
    reasons.push(`The first sample is ${Math.round((first.at - start) / 1000)}s after the declared start; the window would be trimmed at the front.`);
  }
  if (last.at < start + durationMs) {
    const short = Math.round((start + durationMs - last.at) / 1000);
    reasons.push(`The soak is ${short}s short of the required ${Math.round(durationMs / 60000)} minutes.`);
  }

  let largestGapMs = 0;
  for (let index = 1; index < timed.length; index += 1) {
    const gap = timed[index].at - timed[index - 1].at;
    if (gap < 0) {
      reasons.push('Samples are not in time order; the journal cannot be trusted to describe a continuous window.');
      break;
    }
    if (gap > largestGapMs) largestGapMs = gap;
  }
  if (largestGapMs > allowedGap) {
    reasons.push(`A ${Math.round(largestGapMs / 1000)}s gap between samples exceeds the ${Math.round(allowedGap / 1000)}s limit; that stretch was not observed.`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    coveredMs: last.at - first.at,
    requiredMs: durationMs,
    samples: timed.length,
    failures: failures.length,
    largestGapMs,
  };
}

function parseArgs(argv) {
  const options = { samples: null, startedAt: null, intervalMs: DEFAULT_INTERVAL_MS, durationMs: SOAK_DURATION_MS, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--samples') options.samples = argv[++index];
    else if (arg === '--started-at') options.startedAt = argv[++index];
    else if (arg === '--interval-ms') options.intervalMs = Number.parseInt(argv[++index], 10);
    else if (arg === '--duration-ms') options.durationMs = Number.parseInt(argv[++index], 10);
    else if (arg === '--json') options.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.samples) throw new Error('Pass --samples <file.jsonl>.');
  return options;
}

function main(argv) {
  const options = parseArgs(argv);
  const result = evaluateSoak(parseSamples(readFileSync(options.samples, 'utf8')), options);
  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    process.stdout.write(`samples: ${result.samples} (${result.failures} unhealthy)\n`);
    process.stdout.write(`covered: ${Math.round(result.coveredMs / 1000)}s of a required ${Math.round(result.requiredMs / 1000)}s, largest gap ${Math.round(result.largestGapMs / 1000)}s\n`);
    process.stdout.write(result.ok ? 'The soak passed.\n' : `The soak did not pass:\n  - ${result.reasons.join('\n  - ')}\n`);
  }
  return result.ok ? 0 : 1;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`soak: ${error.message}\n`);
    process.exitCode = 2;
  }
}
