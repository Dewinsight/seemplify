/**
 * Opt-in live ChatGPT / Codex token expiry and refresh checkpoint.
 *
 * This is deliberately a separate script from the acceptance harness, because
 * it cannot be satisfied in a single sitting. Arming records the instant the
 * account was known good; verifying refuses to pass until at least twenty hours
 * have elapsed AND the UTC calendar day has changed, so it can never pass on
 * the day it was armed. Verification then requires the account to still be
 * connected with no new sign-in, the live model catalog to still load, and a
 * real job to complete on ChatGPT / Codex: all of which need a silently
 * refreshed access token.
 *
 * Usage: node scripts/codex-live-expiry-checkpoint.mjs arm|verify|status
 *
 * Environment is identical to codex-live-acceptance.mjs, plus the optional
 * SEEMPLIFY_CODEX_ACCEPTANCE_CHECKPOINT_FILE and
 * SEEMPLIFY_CODEX_ACCEPTANCE_CHECKPOINT_MIN_HOURS (at least 20).
 *
 * Exit codes: 0 verified or status, 1 failed or not due, 2 refused, 3 armed.
 */
import path from 'node:path';
import {
  AcceptanceError, CHECKPOINT_NAME, armExpiryCheckpoint, createCheckpointState, evaluateExpiryCheckpoint,
  resolveHarnessOptions, verifyExpiryCheckpoint
} from './codex-live-acceptance-core.mjs';
import {
  createLogger, createRuntimeDeps, defaultEvidenceDir, readHarnessFile, writeHarnessFile
} from './codex-live-acceptance-runtime.mjs';

const log = createLogger(CHECKPOINT_NAME);
const action = String(process.argv[2] || '').trim().toLowerCase();

if (!['arm', 'verify', 'status'].includes(action)) {
  log('refused: ACTION_REQUIRED');
  log('Usage: node scripts/codex-live-expiry-checkpoint.mjs arm|verify|status');
  process.exit(2);
}

let options;
try {
  options = resolveHarnessOptions(process.env, { defaultEvidenceDir });
} catch (error) {
  log(`refused: ${error instanceof AcceptanceError ? error.code : 'CONFIGURATION_INVALID'}`);
  log(error.message);
  process.exit(2);
}

const stateFile = options.checkpoint.file
  || path.join(options.evidenceDir, 'expiry-checkpoint-state.json');
const pathOptions = { runtimeDir: options.runtimeDir };
const deps = createRuntimeDeps(log);

function readState() {
  return readHarnessFile(stateFile, pathOptions);
}

function writeState(state) {
  return writeHarnessFile(path.dirname(stateFile), path.basename(stateFile), state, pathOptions);
}

function evidenceName(report) {
  return `${CHECKPOINT_NAME}-${report.action}-${String(report.startedAt).replace(/[:.]/gu, '-')}-${String(report.runId).slice(0, 8)}.json`;
}

if (action === 'status') {
  const state = readState();
  if (!state) {
    log('not armed: run "arm" first. An unarmed checkpoint can never pass.');
    process.exit(0);
  }
  const due = evaluateExpiryCheckpoint(state, deps.now());
  log(`armed ${state.armedAt} (UTC day ${state.armedDateUtc}), earliest verification ${state.notBefore}`);
  log(`elapsed ${due.elapsedHours}h, due ${due.due}${due.due ? '' : ` (${due.reasons.join(', ')})`}`);
  log(`verifications recorded: ${(state.verifications || []).length}`);
  process.exit(0);
}

if (action === 'arm') {
  const existing = readState();
  if (existing) {
    const due = evaluateExpiryCheckpoint(existing, deps.now());
    log(`re-arming discards the current window (armed ${existing.armedAt}, due ${due.due}).`);
  }
  const armed = await armExpiryCheckpoint({ mode: 'live', options, deps });
  const state = { ...armed.state, verifications: (existing && existing.verifications) || [] };
  writeState(state);
  const evidenceFile = writeHarnessFile(options.evidenceDir, evidenceName(armed.report), armed.report, pathOptions);
  log(`evidence ${evidenceFile}`);
  log(`armed at ${state.armedAt}; earliest verification ${state.notBefore} (UTC day must also differ from ${state.armedDateUtc}).`);
  log('ARMED is not a pass. Run "verify" after the boundary.');
  process.exit(3);
}

const state = readState();
if (!state) {
  log('refused: CHECKPOINT_NOT_ARMED');
  log('Run "arm" first; a checkpoint that was never armed can never be verified.');
  process.exit(1);
}

const report = await verifyExpiryCheckpoint({ mode: 'live', options, state, deps });
const evidenceFile = writeHarnessFile(options.evidenceDir, evidenceName(report), report, pathOptions);
log(`evidence ${evidenceFile}`);

if (report.passed) {
  // Roll the window forward so the next boundary is checked from a known-good
  // instant, keeping the recorded history of every verification.
  const next = createCheckpointState({
    now: deps.now(),
    runId: report.runId,
    host: options.baseUrlHost,
    accountFingerprint: report.data.accountFingerprint || state.accountFingerprint,
    minimumHours: options.checkpoint.minimumHours
  });
  next.verifications = [...(state.verifications || []), {
    runId: report.runId,
    armedAt: state.armedAt,
    verifiedAt: report.finishedAt,
    elapsedHours: report.data.elapsedHours
  }].slice(-50);
  writeState(next);
  log(`verified after ${report.data.elapsedHours}h; re-armed until ${next.notBefore}.`);
  process.exit(0);
}

log(`failure: ${report.failure ? `${report.failure.code} ${report.failure.message}` : 'unknown'}`);
process.exit(1);
