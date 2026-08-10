/**
 * Opt-in live ChatGPT / Codex acceptance harness.
 *
 * This script makes real ChatGPT requests through the product's own HTTP API
 * and is never part of ordinary testing or continuous integration. It refuses
 * to run unless an operator opts in explicitly, and it fails closed whenever a
 * property cannot be proven.
 *
 * It proves, in order:
 *   1. readiness             backend healthy, ChatGPT selected, no Terra fallback
 *   2. device status         a real ChatGPT account is already connected
 *   3. model catalog         the live catalog, with no fixture models
 *   4. foreground job        a real job runs on the chosen model and effort
 *   5. signed-out job        queued work finishes after logout and browser close
 *   6. backend restart       the same runtime directory keeps the connection
 *
 * Token expiry and refresh is a separate checkpoint that cannot pass on the day
 * it was armed: see codex-live-expiry-checkpoint.mjs.
 *
 * Required environment:
 *   SEEMPLIFY_CODEX_ACCEPTANCE_OPT_IN=live-chatgpt-codex-acceptance
 *   SEEMPLIFY_CODEX_ACCEPTANCE_BASE_URL=http://127.0.0.1:5410
 *   SEEMPLIFY_CODEX_ACCEPTANCE_EMAIL=...        (never read from a file)
 *   SEEMPLIFY_CODEX_ACCEPTANCE_PASSWORD=...     (never read from a file)
 *   SEEMPLIFY_CODEX_ACCEPTANCE_RUNTIME_DIR=...  (the backend CODEX_RUNTIME_DIR)
 *   SEEMPLIFY_CODEX_ACCEPTANCE_RESTART_MODE=manual | command
 *   SEEMPLIFY_CODEX_ACCEPTANCE_RESTART_COMMAND=...  (command mode only)
 *
 * Optional: _EVIDENCE_DIR, _SPACE_ID, _MODEL, _EFFORT, _JOB_TIMEOUT_MS,
 * _SIGNED_OUT_WINDOW_MS, _RESTART_TIMEOUT_MS, _POLL_MS, _REQUEST_TIMEOUT_MS.
 *
 * Exit codes: 0 passed, 1 failed, 2 refused before any live call was made.
 */
import {
  AcceptanceError, HARNESS_NAME, evidenceFilename, resolveHarnessOptions, runAcceptance
} from './codex-live-acceptance-core.mjs';
import {
  createLogger, createRuntimeDeps, defaultEvidenceDir, describeFailure, writeHarnessFile
} from './codex-live-acceptance-runtime.mjs';

const log = createLogger(HARNESS_NAME);

let options;
try {
  options = resolveHarnessOptions(process.env, { defaultEvidenceDir });
} catch (error) {
  log(`refused: ${error instanceof AcceptanceError ? error.code : 'CONFIGURATION_INVALID'}`);
  log(error.message);
  process.exit(2);
}

log('This run makes real ChatGPT / Codex requests and queues real AI jobs in the target workspace.');
log(`target ${options.baseUrlHost}, restart mode ${options.restart.mode}`);

const report = await runAcceptance({
  mode: 'live',
  options,
  deps: createRuntimeDeps(log)
});

const evidenceFile = writeHarnessFile(options.evidenceDir, evidenceFilename(report), report, {
  runtimeDir: options.runtimeDir
});

log(`evidence ${evidenceFile}`);
log(describeFailure(report));
if (report.restoredPreference === false) {
  log('WARNING: the workspace AI model and effort override could not be restored. Review workspace AI settings.');
}
log('Generated surveys are removed by the harness; the AI job rows it created remain for audit.');
log(`result ${report.status.toUpperCase()} in ${Math.round(report.durationMs / 1000)}s`);

process.exit(report.status === 'passed' ? 0 : 1);
