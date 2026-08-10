/**
 * Real-machine dependencies for the live ChatGPT / Codex acceptance harness.
 *
 * The core harness is dependency-injected on purpose; this is the only place
 * that touches the filesystem, the clock, or another process. The filesystem
 * surface is deliberately tiny and is never pointed at credential material:
 * directories are inspected with stat only, and the harness writes just its own
 * redacted evidence and checkpoint state.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcceptanceError, assertHarnessFilePath } from './codex-live-acceptance-core.mjs';

export const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const projectDir = path.resolve(scriptDir, '..');
export const defaultEvidenceDir = path.join(projectDir, 'tmp', 'codex-live-acceptance');

/** Directory identity only. Nothing inside the runtime directory is ever read. */
export function statDirectory(directory) {
  try {
    const stats = fs.statSync(directory);
    return { isDirectory: stats.isDirectory(), ino: String(stats.ino), birthtimeMs: Math.round(stats.birthtimeMs) };
  } catch {
    return { isDirectory: false, ino: '', birthtimeMs: 0 };
  }
}

export function sleep(milliseconds) {
  return new Promise((resolve) => { setTimeout(resolve, milliseconds); });
}

export function createLogger(prefix) {
  return function log(message) {
    process.stdout.write(`[${prefix}] ${message}\n`);
  };
}

/**
 * Trigger the operator's restart. In command mode the harness waits only for a
 * short grace period: a restart command that stays in the foreground is normal,
 * and the real proof is the observed downtime and recovery, not the exit code.
 */
export function createRestarter(log, graceMs = 30_000) {
  return function restart(configuration) {
    if (configuration.mode === 'manual') {
      log('MANUAL RESTART REQUIRED: restart the Experience backend now, keeping its CODEX_RUNTIME_DIR unchanged.');
      log('Waiting for the backend to go down and come back.');
      return Promise.resolve({ triggered: 'manual' });
    }
    log('Running the configured restart command.');
    return new Promise((resolve, reject) => {
      let settled = false;
      const child = spawn(configuration.command, {
        shell: true, stdio: 'inherit', windowsHide: true, cwd: projectDir
      });
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.unref();
        resolve({ triggered: 'command', stillRunning: true });
      }, graceMs);
      timer.unref();
      child.once('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new AcceptanceError(`The restart command could not start: ${error.message}`, 'RESTART_COMMAND_FAILED'));
      });
      child.once('exit', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) resolve({ triggered: 'command', exitCode: 0 });
        else reject(new AcceptanceError(`The restart command exited with code ${String(code)}.`, 'RESTART_COMMAND_FAILED'));
      });
    });
  };
}

export function createRuntimeDeps(log) {
  return {
    fetchImpl: (...args) => fetch(...args),
    statDirectory,
    restart: createRestarter(log),
    sleep,
    log,
    now: () => Date.now()
  };
}

export function writeHarnessFile(directory, filename, payload, options) {
  const target = assertHarnessFilePath(path.join(directory, filename), options);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return target;
}

export function readHarnessFile(file, options) {
  const target = assertHarnessFilePath(file, options);
  if (!fs.existsSync(target)) return null;
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    throw new AcceptanceError('The harness state file is not readable JSON.', 'CHECKPOINT_STATE_INVALID');
  }
}

export function describeFailure(report) {
  const lines = [];
  for (const phase of report.phases || []) {
    const failed = (phase.checks || []).filter((entry) => !entry.ok).map((entry) => entry.id);
    lines.push(`  ${phase.status === 'passed' ? 'PASS' : phase.status === 'failed' ? 'FAIL' : phase.status.toUpperCase()} ${phase.id}${failed.length ? ` (${failed.join(', ')})` : ''}`);
  }
  if (report.failure) lines.push(`  failure: ${report.failure.code} ${report.failure.message}`);
  return lines.join('\n');
}
