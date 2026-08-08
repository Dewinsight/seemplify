const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const EXECUTION_ID = /^chatgptexec_[a-f0-9]{48}$/;
const RECEIPT_FILE = /^[a-f0-9]{64}\.json$/;
const IDENTITY_LEDGER_DIRECTORY = 'identity-ledger';
const inProcessExecutions = new Map();

function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item) => item === undefined ? null : canonicalValue(item));
  if (!value || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => {
    const normalized = canonicalValue(value[key]);
    return normalized === undefined ? [] : [[key, normalized]];
  }));
}

function canonicalRequestFingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalValue(value))).digest('hex');
}

function identityConflict(executionId) {
  const error = new Error(`ChatGPT execution identity conflict for ${executionId}`);
  error.code = 'CHATGPT_EXECUTION_IDENTITY_CONFLICT';
  error.status = 409;
  error.retryable = false;
  return error;
}

function corruptReceipt(executionId, reason) {
  const error = new Error(`ChatGPT execution receipt ${executionId} is not readable${reason ? `: ${reason}` : ''}`);
  error.code = 'CHATGPT_EXECUTION_RECEIPT_CORRUPT';
  error.status = 503;
  error.retryable = false;
  return error;
}

function ownershipError(executionId) {
  const error = new Error(`ChatGPT execution receipt lease was lost for ${executionId}`);
  error.code = 'CHATGPT_EXECUTION_LEASE_LOST';
  error.status = 503;
  error.retryable = true;
  return error;
}

function abortError(signal) {
  const error = signal?.reason instanceof Error ? signal.reason : new Error('ChatGPT execution wait was cancelled');
  if (!error.code) error.code = 'CHATGPT_EXECUTION_WAIT_ABORTED';
  error.status ||= 503;
  error.retryable ??= true;
  return error;
}

function processIsAlive(pid) {
  const normalized = Number(pid);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) return false;
  try {
    process.kill(normalized, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but this account cannot signal it.
    return error?.code !== 'ESRCH';
  }
}

function wait(delayMs, signal) {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, Math.max(1, delayMs));
    function finish() {
      signal?.removeEventListener('abort', abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(abortError(signal));
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function waitForInProcessExecution(entry, signal) {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    function finish(outcome) {
      signal?.removeEventListener('abort', abort);
      resolve(outcome);
    }
    function abort() {
      signal?.removeEventListener('abort', abort);
      reject(abortError(signal));
    }
    entry.promise.then(finish);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function syncDirectory(directory) {
  try {
    const handle = await fs.promises.open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  } catch (error) {
    // Windows does not support fsync on directory handles. Its rename path is
    // still atomic; POSIX must surface durability failures before tombstones
    // are removed from the hot store.
    if (process.platform !== 'win32') throw error;
  }
}

async function syncDirectoryTree(directory, rootDirectory) {
  const root = path.resolve(rootDirectory);
  let current = path.resolve(directory);
  const relative = path.relative(root, current);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Durable directory is outside the receipt store');
  }
  while (true) {
    await syncDirectory(current);
    if (current === root) return;
    current = path.dirname(current);
  }
}

async function syncDirectoryAncestry(directory) {
  let current = path.resolve(directory);
  while (true) {
    await syncDirectory(current);
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

async function atomicWrite(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.promises.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(value, 'utf8');
    await handle.sync();
    await handle.close();
    await fs.promises.rename(temporary, file);
    await syncDirectory(path.dirname(file));
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.promises.unlink(temporary).catch(() => {});
    throw error;
  }
}

class ChatGptExecutionReceiptStore {
  constructor({
    directory,
    encryptionSecret,
    retentionMs = 30 * 24 * 60 * 60_000,
    maxReceipts = 10_000,
    maxTombstones = 50_000,
    maxBytes = 512 * 1024 * 1024,
    maxPreparedBytes = 8 * 1024 * 1024,
    leaseMs = 120_000,
    pollMs = 50,
    lockTimeoutMs = 15_000,
    pruneIntervalMs = 60_000,
    now = () => Date.now(),
    log = () => {}
  }) {
    if (!directory || !encryptionSecret) throw new TypeError('ChatGPT execution receipt store is not fully configured');
    this.directory = path.resolve(directory);
    this.key = crypto.createHash('sha256')
      .update('seemplify-chatgpt-execution-receipt-v1\0')
      .update(String(encryptionSecret))
      .digest();
    this.retentionMs = Math.max(1, Number(retentionMs) || 30 * 24 * 60 * 60_000);
    this.maxReceipts = Math.max(1, Math.floor(Number(maxReceipts) || 10_000));
    this.maxTombstones = Math.max(1, Math.floor(Number(maxTombstones) || 50_000));
    // These limits bound the hot receipt directory only. Expired identities
    // are archived into the sharded permanent ledger and never make the
    // gateway unavailable merely because it has served many requests.
    this.maxHotIdentities = this.maxReceipts + this.maxTombstones;
    this.maxBytes = Math.max(1_024, Math.floor(Number(maxBytes) || 512 * 1024 * 1024));
    this.maxPreparedBytes = Math.max(1_024, Math.floor(Number(maxPreparedBytes) || 8 * 1024 * 1024));
    this.leaseMs = Math.max(100, Number(leaseMs) || 120_000);
    this.pollMs = Math.max(5, Number(pollMs) || 50);
    this.lockTimeoutMs = Math.max(100, Number(lockTimeoutMs) || 15_000);
    this.pruneIntervalMs = Math.max(0, Number(pruneIntervalMs) || 0);
    this.now = now;
    this.log = log;
    this.directoryReadyPromise = null;
    this.lastPrunedAtMs = 0;
    this.prunePromise = null;
    this.retained = 0;
    this.retainedBytes = 0;
    this.replays = 0;
    this.recoveries = 0;
    this.coalesced = 0;
    this.conflicts = 0;
    this.lastReplayAt = null;
    this.lastRecoveryAt = null;
  }

  async ensureDirectory() {
    if (!this.directoryReadyPromise) {
      this.directoryReadyPromise = (async () => {
        await fs.promises.mkdir(this.directory, { recursive: true, mode: 0o700 });
        // The receipt directory itself is part of the durability boundary.
        // Sync every ancestor once so a crash cannot lose a newly-created
        // store-root entry after its receipts have already been acknowledged.
        await syncDirectoryAncestry(this.directory);
      })();
    }
    try {
      await this.directoryReadyPromise;
    } catch (error) {
      this.directoryReadyPromise = null;
      throw error;
    }
  }

  receiptFile(executionId) {
    if (!EXECUTION_ID.test(String(executionId || ''))) throw new TypeError('ChatGPT gateway execution ID is invalid');
    const digest = crypto.createHash('sha256').update(executionId).digest('hex');
    return path.join(this.directory, `${digest}.json`);
  }

  identityLedgerFile(executionId) {
    if (!EXECUTION_ID.test(String(executionId || ''))) throw new TypeError('ChatGPT gateway execution ID is invalid');
    const digest = crypto.createHash('sha256').update(executionId).digest('hex');
    return path.join(
      this.directory,
      IDENTITY_LEDGER_DIRECTORY,
      digest.slice(0, 2),
      digest.slice(2, 4),
      `${digest}.json`
    );
  }

  identityIntegrity(record) {
    const protectedFields = {
      schemaVersion: record.schemaVersion,
      recordType: record.recordType,
      executionId: record.executionId,
      requestFingerprint: record.requestFingerprint,
      state: record.state,
      createdAt: record.createdAt || null,
      completedAt: record.completedAt || null,
      expiredAt: record.expiredAt,
      archivedAt: record.archivedAt
    };
    return crypto.createHmac('sha256', this.key)
      .update('seemplify-chatgpt-execution-identity-v1\0')
      .update(JSON.stringify(canonicalValue(protectedFields)))
      .digest('hex');
  }

  async readArchivedIdentity(executionId) {
    let record;
    try {
      record = JSON.parse(await fs.promises.readFile(this.identityLedgerFile(executionId), 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw corruptReceipt(executionId, `identity ledger: ${error.message}`);
    }
    if (
      record?.schemaVersion !== 1
      || record.recordType !== 'expired-identity'
      || record.executionId !== executionId
      || record.state !== 'expired'
      || !/^[a-f0-9]{64}$/.test(String(record.requestFingerprint || ''))
      || !/^[a-f0-9]{64}$/.test(String(record.integrity || ''))
    ) throw corruptReceipt(executionId, 'invalid identity ledger record');
    const expected = Buffer.from(this.identityIntegrity(record), 'hex');
    const actual = Buffer.from(record.integrity, 'hex');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      throw corruptReceipt(executionId, 'identity ledger integrity check failed');
    }
    return record;
  }

  async archiveIdentity(receipt, timestampIso) {
    const existing = await this.readArchivedIdentity(receipt.executionId);
    if (existing) {
      if (existing.requestFingerprint !== receipt.requestFingerprint) {
        throw corruptReceipt(receipt.executionId, 'identity ledger fingerprint mismatch');
      }
      return existing;
    }
    const record = {
      schemaVersion: 1,
      recordType: 'expired-identity',
      executionId: receipt.executionId,
      requestFingerprint: receipt.requestFingerprint,
      state: 'expired',
      createdAt: receipt.createdAt || null,
      completedAt: receipt.completedAt || null,
      expiredAt: receipt.expiredAt || timestampIso,
      archivedAt: timestampIso
    };
    record.integrity = this.identityIntegrity(record);
    const file = this.identityLedgerFile(receipt.executionId);
    await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    // Persist every newly-created shard-directory entry before the hot
    // tombstone can be removed. Syncing only the leaf would not make its
    // ancestors crash-durable on POSIX after first use of a shard.
    await syncDirectoryTree(path.dirname(file), this.directory);
    await atomicWrite(file, JSON.stringify(record));
    return record;
  }

  inProcessExecutionKey(executionId) {
    return `${this.directory}\0${executionId}`;
  }

  registerInProcessExecution(executionId, requestFingerprint, ownerToken) {
    const key = this.inProcessExecutionKey(executionId);
    let settle;
    const promise = new Promise((resolve) => { settle = resolve; });
    inProcessExecutions.set(key, { requestFingerprint, ownerToken, promise, settle });
  }

  settleInProcessExecution(executionId, ownerToken, outcome = null) {
    const key = this.inProcessExecutionKey(executionId);
    const entry = inProcessExecutions.get(key);
    if (!entry || entry.ownerToken !== ownerToken) return;
    inProcessExecutions.delete(key);
    entry.settle(outcome);
  }

  lockDirectory(executionId) {
    return `${this.receiptFile(executionId)}.lock`;
  }

  lockOwnerEntryName(ownerToken) {
    return `owner-${crypto.createHash('sha256').update(String(ownerToken)).digest('hex')}.json`;
  }

  async writeLockOwner(lockDirectory, ownerToken) {
    const ownerMarker = path.join(lockDirectory, 'owner.json');
    await fs.promises.mkdir(ownerMarker, { mode: 0o700 });
    const ownerFile = path.join(ownerMarker, this.lockOwnerEntryName(ownerToken));
    const handle = await fs.promises.open(ownerFile, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, ownerToken }), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async tryCreateOwnedLock(lockDirectory, ownerToken) {
    // Populate an unobservable candidate first, then publish the whole owned
    // directory with one rename. A crash can leave a harmless candidate, but
    // never a newly-created public lock without its owner metadata.
    const candidate = `${lockDirectory}.candidate.${process.pid}.${crypto.randomUUID()}`;
    let published = false;
    await fs.promises.mkdir(candidate, { mode: 0o700 });
    try {
      await this.writeLockOwner(candidate, ownerToken);
      try {
        await fs.promises.rename(candidate, lockDirectory);
        published = true;
        return true;
      } catch (error) {
        if (['EEXIST', 'ENOTEMPTY'].includes(error?.code)) return false;
        // Windows reports EPERM rather than EEXIST when the destination is an
        // existing directory. Only treat it as contention after proving the
        // destination exists; real permission errors still propagate.
        if (process.platform === 'win32' && error?.code === 'EPERM') {
          try {
            await fs.promises.lstat(lockDirectory);
            return false;
          } catch (statError) {
            if (statError?.code === 'ENOENT') return false;
            throw statError;
          }
        }
        throw error;
      }
    } finally {
      if (!published) {
        const ownerMarker = path.join(candidate, 'owner.json');
        await fs.promises.unlink(path.join(ownerMarker, this.lockOwnerEntryName(ownerToken))).catch((error) => {
          if (error?.code !== 'ENOENT') throw error;
        });
        await fs.promises.rmdir(ownerMarker).catch((error) => {
          if (error?.code !== 'ENOENT') throw error;
        });
        await fs.promises.rmdir(candidate).catch((error) => {
          if (error?.code !== 'ENOENT') throw error;
        });
      }
    }
  }

  async tryClaimOwnerlessLock(lockDirectory, ownerToken) {
    // Compare-and-set recovery for ownerless directories left by the legacy
    // mkdir-then-write protocol. A fully-populated directory is atomically
    // renamed to the owner.json marker, so exactly one contender wins on
    // local, network, and removable filesystems without requiring hard-link
    // support. A legacy creator loses its O_EXCL file create and cannot enter.
    const candidate = `${lockDirectory}.owner.${process.pid}.${crypto.randomUUID()}.candidate`;
    const ownerMarker = path.join(lockDirectory, 'owner.json');
    const ownerEntry = this.lockOwnerEntryName(ownerToken);
    let published = false;
    // A process can crash after atomically deleting its token-specific owner
    // entry but before removing the now-empty marker directory. rmdir is the
    // compare-and-set here: it succeeds only while the marker is still empty.
    // If another owner publishes first, the non-empty directory is preserved
    // and the ordinary contention path retries without stealing its lock.
    await fs.promises.rmdir(ownerMarker).catch((error) => {
      if (!['ENOENT', 'ENOTEMPTY', 'ENOTDIR', 'EEXIST', 'EPERM'].includes(error?.code)) throw error;
    });
    await fs.promises.mkdir(candidate, { mode: 0o700 });
    const handle = await fs.promises.open(path.join(candidate, ownerEntry), 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, ownerToken }), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      try {
        await fs.promises.rename(candidate, ownerMarker);
        published = true;
        return true;
      } catch (error) {
        if (['EEXIST', 'ENOTEMPTY', 'ENOTDIR', 'EISDIR', 'ENOENT'].includes(error?.code)) return false;
        if (process.platform === 'win32' && error?.code === 'EPERM') {
          try {
            await fs.promises.lstat(ownerMarker);
            return false;
          } catch (statError) {
            if (statError?.code === 'ENOENT') return false;
            throw statError;
          }
        }
        throw error;
      }
    } catch (error) {
      throw error;
    } finally {
      if (!published) {
        await fs.promises.unlink(path.join(candidate, ownerEntry)).catch((error) => {
          if (error?.code !== 'ENOENT') throw error;
        });
        await fs.promises.rmdir(candidate).catch((error) => {
          if (error?.code !== 'ENOENT') throw error;
        });
      }
    }
  }

  async readLockOwner(lockDirectory) {
    try {
      const ownerMarker = path.join(lockDirectory, 'owner.json');
      const stats = await fs.promises.lstat(ownerMarker);
      let ownerFileName = null;
      if (stats.isDirectory()) {
        const entries = (await fs.promises.readdir(ownerMarker)).filter((name) => name.endsWith('.json'));
        if (entries.length !== 1) return null;
        [ownerFileName] = entries;
      }
      const ownerFile = stats.isDirectory() ? path.join(ownerMarker, ownerFileName) : ownerMarker;
      const owner = JSON.parse(await fs.promises.readFile(ownerFile, 'utf8'));
      if (!Number.isSafeInteger(Number(owner?.pid)) || !owner?.ownerToken) return null;
      return { ...owner, markerDirectory: stats.isDirectory(), ownerFileName };
    } catch {
      return null;
    }
  }

  async removeLockOwner(lockDirectory, owner) {
    const ownerMarker = path.join(lockDirectory, 'owner.json');
    if (owner?.markerDirectory) {
      if (!owner.ownerFileName || path.basename(owner.ownerFileName) !== owner.ownerFileName) return false;
      const ownerFile = path.join(ownerMarker, owner.ownerFileName);
      try {
        const current = JSON.parse(await fs.promises.readFile(ownerFile, 'utf8'));
        if (current?.ownerToken !== owner.ownerToken || Number(current?.pid) !== Number(owner.pid)) return false;
        await fs.promises.unlink(ownerFile);
      } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
      }
      try {
        await fs.promises.rmdir(ownerMarker);
      } catch (error) {
        if (['ENOENT', 'ENOTEMPTY'].includes(error?.code)) return false;
        throw error;
      }
      return true;
    }
    // Legacy file owners are read for compatibility. New generations always
    // use a directory marker, so an ABA replacement cannot be unlinked as a
    // file by a delayed legacy-owner reclaimer.
    try {
      const current = JSON.parse(await fs.promises.readFile(ownerMarker, 'utf8'));
      if (current?.ownerToken !== owner?.ownerToken || Number(current?.pid) !== Number(owner?.pid)) return false;
      await fs.promises.unlink(ownerMarker);
      return true;
    } catch (error) {
      if (['ENOENT', 'EISDIR', 'EPERM'].includes(error?.code)) return false;
      throw error;
    }
  }

  async releaseLock(lockDirectory, ownerToken) {
    const owner = await this.readLockOwner(lockDirectory);
    if (!owner || owner.ownerToken !== ownerToken || Number(owner.pid) !== process.pid) return;
    if (!await this.removeLockOwner(lockDirectory, owner)) return;
    await fs.promises.rmdir(lockDirectory).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }

  async withLock(executionId, action) {
    await this.ensureDirectory();
    const lockDirectory = this.lockDirectory(executionId);
    const deadline = Date.now() + this.lockTimeoutMs;
    const ownerToken = crypto.randomUUID();
    while (true) {
      if (await this.tryCreateOwnedLock(lockDirectory, ownerToken)) break;
      {
        const currentOwner = await this.readLockOwner(lockDirectory);
        // Never steal a lock because its timestamp is old. An inference or a
        // slow fsync can legitimately exceed a wall-clock lease. We only
        // remove a lock whose recorded OS process is conclusively gone; PID
        // reuse errs on the fail-closed side by leaving the lock in place.
        if (currentOwner && !processIsAlive(currentOwner.pid)) {
          if (!await this.removeLockOwner(lockDirectory, currentOwner)) continue;
          await fs.promises.rmdir(lockDirectory).catch((removeError) => {
            if (removeError?.code !== 'ENOENT' && removeError?.code !== 'ENOTEMPTY') throw removeError;
          });
          continue;
        }
        if (!currentOwner && await this.tryClaimOwnerlessLock(lockDirectory, ownerToken)) break;
        if (Date.now() >= deadline) {
          const timeout = new Error(`Timed out locking ChatGPT execution receipt ${executionId}`);
          timeout.code = 'CHATGPT_EXECUTION_LOCK_TIMEOUT';
          timeout.status = 503;
          timeout.retryable = true;
          throw timeout;
        }
        await wait(Math.min(25, Math.max(1, deadline - Date.now())));
      }
    }
    try {
      return await action();
    } finally {
      await this.releaseLock(lockDirectory, ownerToken).catch((error) => {
        this.log('error', 'ChatGPT execution receipt lock cleanup failed', {
          executionId,
          error: error.message
        });
      });
    }
  }

  async readReceipt(executionId) {
    const file = this.receiptFile(executionId);
    let receipt;
    try {
      receipt = JSON.parse(await fs.promises.readFile(file, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw corruptReceipt(executionId, error.message);
    }
    if (
      receipt?.schemaVersion !== 1
      || receipt.executionId !== executionId
      || !/^[a-f0-9]{64}$/.test(String(receipt.requestFingerprint || ''))
      || !['reserved', 'running', 'result_ready', 'completed', 'expired'].includes(receipt.state)
    ) {
      throw corruptReceipt(executionId, 'invalid receipt envelope');
    }
    return receipt;
  }

  preparedAad(executionId, requestFingerprint, state) {
    return Buffer.from(JSON.stringify({
      schemaVersion: 1,
      executionId,
      requestFingerprint,
      state
    }), 'utf8');
  }

  encryptPrepared(executionId, requestFingerprint, state, value) {
    const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
    if (plaintext.length > this.maxPreparedBytes) {
      const error = new Error('ChatGPT execution result is too large for the durable receipt store');
      error.code = 'CHATGPT_EXECUTION_RESULT_TOO_LARGE';
      error.status = 503;
      error.retryable = false;
      throw error;
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(this.preparedAad(executionId, requestFingerprint, state));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      aadVersion: 1,
      algorithm: 'aes-256-gcm',
      boundState: state,
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      ciphertext: ciphertext.toString('base64url')
    };
  }

  decryptPrepared(executionId, requestFingerprint, state, encrypted) {
    try {
      if (
        encrypted?.algorithm !== 'aes-256-gcm'
        || encrypted?.aadVersion !== 1
        || encrypted?.boundState !== state
      ) throw new Error('unsupported or mismatched encryption envelope');
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(encrypted.iv, 'base64url'));
      decipher.setAAD(this.preparedAad(executionId, requestFingerprint, state));
      decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64url'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(encrypted.ciphertext, 'base64url')),
        decipher.final()
      ]).toString('utf8');
      return JSON.parse(plaintext);
    } catch (error) {
      throw corruptReceipt(executionId, error.message);
    }
  }

  assertFingerprint(receipt, requestFingerprint) {
    if (receipt.requestFingerprint !== requestFingerprint) {
      this.conflicts += 1;
      throw identityConflict(receipt.executionId);
    }
  }

  expiredError(executionId) {
    const error = new Error(`ChatGPT execution receipt ${executionId} has expired; use a new execution identity`);
    error.code = 'CHATGPT_EXECUTION_RECEIPT_EXPIRED';
    error.status = 410;
    error.retryable = false;
    return error;
  }

  ambiguousError(executionId) {
    const error = new Error(`ChatGPT execution ${executionId} may have reached the provider before its gateway receipt was completed`);
    error.code = 'CHATGPT_EXECUTION_OUTCOME_AMBIGUOUS';
    error.status = 503;
    error.retryable = false;
    return error;
  }

  async acquire({ executionId, requestFingerprint, signal }) {
    if (!EXECUTION_ID.test(String(executionId || ''))) throw new TypeError('ChatGPT gateway execution ID is invalid');
    if (!/^[a-f0-9]{64}$/.test(String(requestFingerprint || ''))) throw new TypeError('Local request fingerprint is invalid');
    let waited = false;
    while (true) {
      if (signal?.aborted) throw abortError(signal);
      const inProcessExecution = inProcessExecutions.get(this.inProcessExecutionKey(executionId));
      if (inProcessExecution) {
        if (inProcessExecution.requestFingerprint !== requestFingerprint) {
          this.conflicts += 1;
          throw identityConflict(executionId);
        }
        if (!waited) {
          waited = true;
          this.coalesced += 1;
        }
        const localOutcome = await waitForInProcessExecution(inProcessExecution, signal);
        if (localOutcome) {
          this.replays += 1;
          this.lastReplayAt = new Date(this.now()).toISOString();
          return localOutcome;
        }
        continue;
      }
      const decision = await this.withLock(executionId, async () => {
        const receipt = await this.readReceipt(executionId);
        const timestamp = this.now();
        const timestampIso = new Date(timestamp).toISOString();
        if (!receipt) {
          const archivedIdentity = await this.readArchivedIdentity(executionId);
          if (archivedIdentity) {
            this.assertFingerprint(archivedIdentity, requestFingerprint);
            throw this.expiredError(executionId);
          }
          const ownerToken = crypto.randomUUID();
          await atomicWrite(this.receiptFile(executionId), JSON.stringify({
            schemaVersion: 1,
            executionId,
            requestFingerprint,
            state: 'reserved',
            ownerToken,
            leaseExpiresAt: new Date(timestamp + this.leaseMs).toISOString(),
            createdAt: timestampIso,
            updatedAt: timestampIso
          }));
          return { action: 'execute', executionId, requestFingerprint, ownerToken };
        }
        this.assertFingerprint(receipt, requestFingerprint);
        if (receipt.state === 'expired') throw this.expiredError(executionId);
        if (receipt.state === 'completed') {
          return { action: 'replay', prepared: this.decryptPrepared(executionId, requestFingerprint, receipt.state, receipt.prepared) };
        }
        const leaseExpiresAt = new Date(receipt.leaseExpiresAt || 0).getTime();
        if (!receipt.ownerToken || !Number.isFinite(leaseExpiresAt) || leaseExpiresAt <= timestamp) {
          if (receipt.state === 'running') throw this.ambiguousError(executionId);
          const ownerToken = crypto.randomUUID();
          const next = {
            ...receipt,
            ownerToken,
            leaseExpiresAt: new Date(timestamp + this.leaseMs).toISOString(),
            updatedAt: timestampIso
          };
          await atomicWrite(this.receiptFile(executionId), JSON.stringify(next));
          if (receipt.state === 'result_ready') {
            return { action: 'recover', executionId, requestFingerprint, ownerToken, prepared: this.decryptPrepared(executionId, requestFingerprint, receipt.state, receipt.prepared) };
          }
          return { action: 'execute', executionId, requestFingerprint, ownerToken };
        }
        return { action: 'wait', leaseExpiresAt };
      });
      if (decision.action !== 'wait') {
        if (decision.action === 'replay') {
          this.replays += 1;
          this.lastReplayAt = new Date(this.now()).toISOString();
        } else if (decision.action === 'recover') {
          this.recoveries += 1;
          this.lastRecoveryAt = new Date(this.now()).toISOString();
        }
        if (['execute', 'recover'].includes(decision.action)) {
          this.registerInProcessExecution(executionId, requestFingerprint, decision.ownerToken);
        }
        return decision;
      }
      if (!waited) {
        waited = true;
        this.coalesced += 1;
      }
      await wait(Math.min(this.pollMs, Math.max(1, decision.leaseExpiresAt - this.now())), signal);
    }
  }

  async heartbeat({ executionId, requestFingerprint, ownerToken }) {
    return this.withLock(executionId, async () => {
      const receipt = await this.readReceipt(executionId);
      if (!receipt) return false;
      this.assertFingerprint(receipt, requestFingerprint);
      if (receipt.state === 'completed' || receipt.ownerToken !== ownerToken) return false;
      const timestamp = this.now();
      await atomicWrite(this.receiptFile(executionId), JSON.stringify({
        ...receipt,
        leaseExpiresAt: new Date(timestamp + this.leaseMs).toISOString(),
        updatedAt: new Date(timestamp).toISOString()
      }));
      return true;
    });
  }

  async markStarted({ executionId, requestFingerprint, ownerToken }) {
    return this.withLock(executionId, async () => {
      const receipt = await this.readReceipt(executionId);
      if (!receipt) throw ownershipError(executionId);
      this.assertFingerprint(receipt, requestFingerprint);
      if (receipt.ownerToken !== ownerToken || !['reserved', 'running'].includes(receipt.state)) throw ownershipError(executionId);
      if (receipt.state === 'running') return true;
      const timestamp = this.now();
      await atomicWrite(this.receiptFile(executionId), JSON.stringify({
        ...receipt,
        state: 'running',
        providerStartedAt: new Date(timestamp).toISOString(),
        leaseExpiresAt: new Date(timestamp + this.leaseMs).toISOString(),
        updatedAt: new Date(timestamp).toISOString()
      }));
      return true;
    });
  }

  async prepare({ executionId, requestFingerprint, ownerToken, prepared }) {
    return this.withLock(executionId, async () => {
      const receipt = await this.readReceipt(executionId);
      if (!receipt) throw ownershipError(executionId);
      this.assertFingerprint(receipt, requestFingerprint);
      if (receipt.ownerToken !== ownerToken || !['running', 'result_ready'].includes(receipt.state)) throw ownershipError(executionId);
      if (receipt.state === 'result_ready') return this.decryptPrepared(executionId, requestFingerprint, receipt.state, receipt.prepared);
      const timestamp = this.now();
      const next = {
        ...receipt,
        state: 'result_ready',
        prepared: this.encryptPrepared(executionId, requestFingerprint, 'result_ready', prepared),
        leaseExpiresAt: new Date(timestamp + this.leaseMs).toISOString(),
        preparedAt: new Date(timestamp).toISOString(),
        updatedAt: new Date(timestamp).toISOString()
      };
      await atomicWrite(this.receiptFile(executionId), JSON.stringify(next));
      return prepared;
    });
  }

  async complete({ executionId, requestFingerprint, ownerToken }) {
    let prepared;
    try {
      prepared = await this.withLock(executionId, async () => {
      const receipt = await this.readReceipt(executionId);
      if (!receipt) throw ownershipError(executionId);
      this.assertFingerprint(receipt, requestFingerprint);
      if (receipt.state === 'completed') return this.decryptPrepared(executionId, requestFingerprint, receipt.state, receipt.prepared);
      if (receipt.state !== 'result_ready' || receipt.ownerToken !== ownerToken) throw ownershipError(executionId);
      const timestamp = this.now();
      const preparedValue = this.decryptPrepared(executionId, requestFingerprint, 'result_ready', receipt.prepared);
      const next = {
        ...receipt,
        state: 'completed',
        prepared: this.encryptPrepared(executionId, requestFingerprint, 'completed', preparedValue),
        ownerToken: null,
        leaseExpiresAt: null,
        completedAt: new Date(timestamp).toISOString(),
        expiresAt: new Date(timestamp + this.retentionMs).toISOString(),
        updatedAt: new Date(timestamp).toISOString()
      };
      await atomicWrite(this.receiptFile(executionId), JSON.stringify(next));
      return preparedValue;
      });
      await this.prune();
      return prepared;
    } finally {
      this.settleInProcessExecution(executionId, ownerToken, prepared
        ? { action: 'replay', prepared }
        : null);
    }
  }

  async release({ executionId, requestFingerprint, ownerToken }) {
    try {
      return await this.withLock(executionId, async () => {
      const receipt = await this.readReceipt(executionId);
      if (!receipt) return false;
      this.assertFingerprint(receipt, requestFingerprint);
      if (receipt.state === 'completed' || receipt.ownerToken !== ownerToken) return false;
      if (['reserved', 'running'].includes(receipt.state)) {
        await fs.promises.unlink(this.receiptFile(executionId)).catch((error) => {
          if (error?.code !== 'ENOENT') throw error;
        });
        return true;
      }
      const timestamp = this.now();
      await atomicWrite(this.receiptFile(executionId), JSON.stringify({
        ...receipt,
        ownerToken: null,
        leaseExpiresAt: new Date(timestamp).toISOString(),
        updatedAt: new Date(timestamp).toISOString()
      }));
      return true;
      });
    } finally {
      this.settleInProcessExecution(executionId, ownerToken);
    }
  }

  async forfeitAmbiguous({ executionId, requestFingerprint, ownerToken }) {
    try {
      return await this.withLock(executionId, async () => {
      const receipt = await this.readReceipt(executionId);
      if (!receipt) return false;
      this.assertFingerprint(receipt, requestFingerprint);
      if (receipt.state !== 'running' || receipt.ownerToken !== ownerToken) return false;
      const timestamp = this.now();
      await atomicWrite(this.receiptFile(executionId), JSON.stringify({
        ...receipt,
        ownerToken: null,
        leaseExpiresAt: new Date(timestamp).toISOString(),
        ambiguousAt: new Date(timestamp).toISOString(),
        updatedAt: new Date(timestamp).toISOString()
      }));
      return true;
      });
    } finally {
      this.settleInProcessExecution(executionId, ownerToken);
    }
  }

  async prune({ force = false } = {}) {
    if (this.prunePromise) return this.prunePromise;
    if (!force && this.pruneIntervalMs > 0 && this.now() - this.lastPrunedAtMs < this.pruneIntervalMs) return;
    this.prunePromise = this.pruneReceipts().finally(() => { this.prunePromise = null; });
    return this.prunePromise;
  }

  async pruneReceipts() {
    await this.ensureDirectory();
    const timestamp = this.now();
    const entries = [];
    for (const name of (await fs.promises.readdir(this.directory)).filter((item) => RECEIPT_FILE.test(item))) {
      const file = path.join(this.directory, name);
      try {
        const [contents, stats] = await Promise.all([fs.promises.readFile(file, 'utf8'), fs.promises.stat(file)]);
        let receipt = null;
        try { receipt = JSON.parse(contents); } catch {}
        const updatedAt = new Date(receipt?.completedAt || receipt?.expiredAt || receipt?.updatedAt || stats.mtimeMs).getTime();
        entries.push({
          file,
          name,
          bytes: stats.size,
          updatedAt: Number.isFinite(updatedAt) ? updatedAt : stats.mtimeMs,
          executionId: receipt?.executionId,
          state: receipt?.state
        });
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    entries.sort((left, right) => left.updatedAt - right.updatedAt || left.name.localeCompare(right.name));
    for (const entry of entries.filter((item) => ['reserved', 'running', 'result_ready'].includes(item.state))) {
      if (entry.updatedAt > timestamp - this.retentionMs || !EXECUTION_ID.test(String(entry.executionId || ''))) continue;
      await this.withLock(entry.executionId, async () => {
        const current = await this.readReceipt(entry.executionId);
        if (!current || !['reserved', 'running', 'result_ready'].includes(current.state)) return;
        const currentAt = new Date(current.updatedAt || 0).getTime();
        if (currentAt > timestamp - this.retentionMs) return;
        const expiredAt = new Date(timestamp).toISOString();
        await atomicWrite(this.receiptFile(entry.executionId), JSON.stringify({
          schemaVersion: 1,
          executionId: current.executionId,
          requestFingerprint: current.requestFingerprint,
          state: 'expired',
          createdAt: current.createdAt,
          expiredAt,
          updatedAt: expiredAt
        }));
      });
    }
    const completed = entries.filter((entry) => entry.state === 'completed');
    let completedBytes = completed.reduce((total, entry) => total + entry.bytes, 0);
    let completedCount = completed.length;
    for (const entry of completed) {
      const expiredByAge = entry.updatedAt <= timestamp - this.retentionMs;
      const overLimit = completedCount > this.maxReceipts || completedBytes > this.maxBytes;
      if (!expiredByAge && !overLimit) continue;
      if (!EXECUTION_ID.test(String(entry.executionId || ''))) continue;
      await this.withLock(entry.executionId, async () => {
        const current = await this.readReceipt(entry.executionId);
        if (!current || current.state !== 'completed') return;
        const currentAt = new Date(current.completedAt || current.updatedAt || 0).getTime();
        if (currentAt > timestamp - this.retentionMs && completedCount <= this.maxReceipts && completedBytes <= this.maxBytes) return;
        const expiredAt = new Date(timestamp).toISOString();
        await atomicWrite(this.receiptFile(entry.executionId), JSON.stringify({
          schemaVersion: 1,
          executionId: current.executionId,
          requestFingerprint: current.requestFingerprint,
          state: 'expired',
          createdAt: current.createdAt,
          completedAt: current.completedAt,
          expiredAt,
          updatedAt: expiredAt
        }));
      });
      completedCount -= 1;
      completedBytes -= entry.bytes;
    }
    // Keep only the configured working set of tombstones in the hot receipt
    // directory. Older identities move to a two-level sharded, authenticated
    // permanent ledger. They remain discoverable forever without imposing a
    // finite lifetime request cap or allowing an old job to execute again.
    const expiredEntries = [];
    for (const name of (await fs.promises.readdir(this.directory)).filter((item) => RECEIPT_FILE.test(item))) {
      const file = path.join(this.directory, name);
      try {
        const [contents, stats] = await Promise.all([fs.promises.readFile(file, 'utf8'), fs.promises.stat(file)]);
        let receipt = null;
        try { receipt = JSON.parse(contents); } catch {}
        if (receipt?.state !== 'expired') continue;
        const updatedAt = new Date(receipt.expiredAt || receipt.updatedAt || stats.mtimeMs).getTime();
        expiredEntries.push({
          file,
          name,
          executionId: receipt.executionId,
          updatedAt: Number.isFinite(updatedAt) ? updatedAt : stats.mtimeMs
        });
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    expiredEntries.sort((left, right) => left.updatedAt - right.updatedAt || left.name.localeCompare(right.name));
    let hotTombstones = expiredEntries.length;
    for (const entry of expiredEntries) {
      if (hotTombstones <= this.maxTombstones) break;
      if (!EXECUTION_ID.test(String(entry.executionId || ''))) continue;
      const archived = await this.withLock(entry.executionId, async () => {
        const current = await this.readReceipt(entry.executionId);
        if (!current || current.state !== 'expired') return false;
        const archivedAt = new Date(timestamp).toISOString();
        await this.archiveIdentity(current, archivedAt);
        await fs.promises.unlink(this.receiptFile(entry.executionId)).catch((error) => {
          if (error?.code !== 'ENOENT') throw error;
        });
        return true;
      });
      if (archived) hotTombstones -= 1;
    }
    const finalEntries = [];
    for (const name of (await fs.promises.readdir(this.directory)).filter((item) => RECEIPT_FILE.test(item))) {
      const file = path.join(this.directory, name);
      try { finalEntries.push(await fs.promises.stat(file)); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
    this.retained = finalEntries.length;
    this.retainedBytes = finalEntries.reduce((total, entry) => total + entry.size, 0);
    this.lastPrunedAtMs = timestamp;
  }

  status() {
    return {
      configured: true,
      retained: this.retained,
      retainedBytes: this.retainedBytes,
      retentionMs: this.retentionMs,
      maxReceipts: this.maxReceipts,
      maxTombstones: this.maxTombstones,
      maxHotIdentities: this.maxHotIdentities,
      identityLifetimeCapConfigured: false,
      identityStorageBoundedByDisk: true,
      identityLedgerPermanent: true,
      identityLedgerLayout: 'sha256-sharded-v1',
      maxBytes: this.maxBytes,
      replays: this.replays,
      recoveries: this.recoveries,
      coalesced: this.coalesced,
      conflicts: this.conflicts,
      lastReplayAt: this.lastReplayAt,
      lastRecoveryAt: this.lastRecoveryAt,
      lastPrunedAt: this.lastPrunedAtMs ? new Date(this.lastPrunedAtMs).toISOString() : null
    };
  }
}

module.exports = {
  ChatGptExecutionReceiptStore,
  canonicalRequestFingerprint
};
