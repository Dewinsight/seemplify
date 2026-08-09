const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const mongoose = require('mongoose');

const DEFAULT_BUCKET_NAME = 'cv_ingestion_files';

function bucketName() {
  return String(process.env.CV_INGESTION_GRIDFS_BUCKET || DEFAULT_BUCKET_NAME)
    .replace(/[^A-Za-z0-9_.-]/g, '')
    .slice(0, 120) || DEFAULT_BUCKET_NAME;
}

function database() {
  const db = mongoose.connection?.db;
  if (!db) {
    const error = new Error('MongoDB is not connected; durable CV storage is unavailable');
    error.code = 'CV_DURABLE_STORAGE_UNAVAILABLE';
    throw error;
  }
  return db;
}

function bucket(name = bucketName()) {
  return new mongoose.mongo.GridFSBucket(database(), { bucketName: name });
}

async function defaultFinalizeUploadMetadata(name, fileId, sha256, length) {
  return database().collection(`${name}.files`).updateOne(
    { _id: fileId },
    {
      $set: {
        'metadata.sha256': sha256,
        'metadata.sourceLength': length
      }
    }
  );
}

let finalizeUploadMetadata = defaultFinalizeUploadMetadata;

function referenceBucketName(value) {
  const name = String(value || bucketName());
  if (!new Set([bucketName(), DEFAULT_BUCKET_NAME]).has(name)) {
    const error = new Error('The durable CV bucket reference is invalid');
    error.code = 'CV_DURABLE_FILE_INVALID';
    throw error;
  }
  return name;
}

function objectId(value) {
  if (value instanceof mongoose.mongo.ObjectId) return value;
  if (!mongoose.mongo.ObjectId.isValid(String(value || ''))) {
    const error = new Error('The durable CV file reference is invalid');
    error.code = 'CV_DURABLE_FILE_INVALID';
    throw error;
  }
  return new mongoose.mongo.ObjectId(String(value));
}

function safeFileName(value) {
  return path.basename(String(value || 'cv-upload'))
    .replace(/[^\w .()-]/g, '_')
    .slice(0, 180) || 'cv-upload';
}

function integrityError(message, code = 'CV_DURABLE_FILE_CORRUPT') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function expectedIntegrity(reference) {
  const length = Number(reference?.length);
  const sha256 = String(reference?.sha256 || '').toLowerCase();
  if (!Number.isSafeInteger(length) || length < 1 || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw integrityError(
      'The durable CV file is missing required integrity metadata',
      'CV_DURABLE_FILE_INTEGRITY_MISSING'
    );
  }
  return { length, sha256 };
}

function assertWorkerTempDirectory(directory) {
  const resolvedDirectory = path.resolve(String(directory || ''));
  const resolvedTempRoot = path.resolve(os.tmpdir());
  const comparable = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
  if (
    comparable(path.dirname(resolvedDirectory)) !== comparable(resolvedTempRoot)
    || !path.basename(resolvedDirectory).startsWith('seemplify-cv-worker-')
  ) {
    const error = new Error('Refusing to remove an unsafe CV worker directory');
    error.code = 'CV_WORKER_TEMP_PATH_UNSAFE';
    throw error;
  }
  return resolvedDirectory;
}

async function removeWorkerTempDirectory(directory) {
  const safeDirectory = assertWorkerTempDirectory(directory);
  await fs.promises.rm(safeDirectory, { recursive: true, force: true });
}

async function persistPath(filePath, metadata = {}) {
  const stats = await fs.promises.stat(filePath);
  if (!stats.isFile() || stats.size < 1) {
    const error = new Error('The uploaded CV is empty');
    error.code = 'CV_FILE_EMPTY';
    throw error;
  }

  const name = bucketName();
  const storage = bucket(name);
  const digest = crypto.createHash('sha256');
  let streamedLength = 0;
  const upload = storage.openUploadStream(safeFileName(metadata.originalName), {
    contentType: String(metadata.fileType || 'application/octet-stream').slice(0, 127),
    metadata: {
      purpose: 'cv-ingestion',
      organizationId: String(metadata.organizationId || '').slice(0, 100),
      source: String(metadata.source || '').slice(0, 40),
      // These opaque intake fields let maintenance distinguish a committed
      // processing file from bytes stranded by a process exit between the
      // GridFS upload and CVProcessingJob.create(). Never persist the raw
      // idempotency key here.
      intakeId: String(metadata.intakeId || '').slice(0, 120),
      intakeKeyHash: String(metadata.intakeKeyHash || '').slice(0, 64),
      requestFingerprint: String(metadata.requestFingerprint || '').slice(0, 64),
      createdAt: new Date()
    }
  });
  const hashStream = new Transform({
    transform(chunk, _encoding, callback) {
      digest.update(chunk);
      streamedLength += chunk.length;
      callback(null, chunk);
    }
  });

  try {
    await pipeline(fs.createReadStream(filePath), hashStream, upload);
  } catch (error) {
    try {
      await upload.abort();
    } catch (cleanupError) {
      error.cleanupError = cleanupError;
      error.cleanupReference = {
        provider: 'gridfs',
        bucket: name,
        fileId: String(upload.id)
      };
    }
    error.code = error.code || 'CV_DURABLE_STORAGE_WRITE_FAILED';
    throw error;
  }

  const sha256 = digest.digest('hex');
  try {
    const result = await finalizeUploadMetadata(name, upload.id, sha256, streamedLength);
    if (Number(result?.matchedCount || 0) !== 1) {
      throw integrityError(
        'The durable CV upload metadata could not be finalized',
        'CV_DURABLE_STORAGE_METADATA_FAILED'
      );
    }
  } catch (error) {
    try {
      await storage.delete(upload.id);
    } catch (cleanupError) {
      error.cleanupError = cleanupError;
      error.cleanupReference = {
        provider: 'gridfs',
        bucket: name,
        fileId: String(upload.id)
      };
    }
    error.code = error.code || 'CV_DURABLE_STORAGE_METADATA_FAILED';
    throw error;
  }
  return {
    provider: 'gridfs',
    bucket: name,
    fileId: String(upload.id),
    sha256,
    length: streamedLength,
    persistedAt: new Date()
  };
}

async function sweepOrphanedIntakes({
  now = new Date(),
  graceMs = Number(process.env.CV_INGESTION_ORPHAN_GRACE_MS || 15 * 60 * 1000),
  legacyGraceMs = Number(process.env.CV_INGESTION_LEGACY_ORPHAN_GRACE_MS || 24 * 60 * 60 * 1000),
  pageSize = 100,
  isReferenced
} = {}) {
  if (typeof isReferenced !== 'function') {
    throw new TypeError('A durable CV reference resolver is required');
  }
  const name = bucketName();
  const files = database().collection(`${name}.files`);
  const safeGraceMs = Math.max(0, Number(graceMs) || 0);
  const staleBefore = new Date(new Date(now).getTime() - safeGraceMs);
  // Pre-rollout files did not carry an intake ID. Give every old server/request
  // a much longer drain window, then match those files only by ObjectId.
  const legacyStaleBefore = new Date(
    new Date(now).getTime() - Math.max(safeGraceMs, Number(legacyGraceMs) || 0)
  );
  const size = Math.min(Math.max(Number(pageSize) || 100, 1), 500);
  const baseFilter = {
    'metadata.purpose': 'cv-ingestion',
    $or: [
      {
        uploadDate: { $lte: staleBefore },
        'metadata.intakeId': { $type: 'string', $ne: '' }
      },
      {
        uploadDate: { $lte: legacyStaleBefore },
        $or: [
          { 'metadata.intakeId': { $exists: false } },
          { 'metadata.intakeId': null },
          { 'metadata.intakeId': '' }
        ]
      }
    ]
  };
  const tail = await files.find(baseFilter).sort({ _id: -1 }).limit(1).next();
  if (!tail) return { examined: 0, removed: 0, retained: 0, errors: 0 };

  let cursor;
  let examined = 0;
  let removed = 0;
  let retained = 0;
  let errors = 0;
  while (true) {
    const page = await files.find({
      ...baseFilter,
      _id: {
        ...(cursor ? { $gt: cursor } : {}),
        $lte: tail._id
      }
    }).sort({ _id: 1 }).limit(size).toArray();
    if (!page.length) break;
    for (const file of page) {
      examined += 1;
      const reference = {
        provider: 'gridfs',
        bucket: name,
        fileId: String(file._id),
        intakeId: file.metadata?.intakeId,
        intakeKeyHash: file.metadata?.intakeKeyHash,
        requestFingerprint: file.metadata?.requestFingerprint,
        organizationId: file.metadata?.organizationId,
        sha256: file.metadata?.sha256,
        length: Number(file.metadata?.sourceLength || file.length || 0),
        persistedAt: file.uploadDate,
        originalName: file.filename,
        fileType: file.contentType,
        legacy: !file.metadata?.intakeId
      };
      try {
        if (await isReferenced(reference)) {
          retained += 1;
          continue;
        }
        await bucket(name).delete(file._id);
        removed += 1;
      } catch {
        // A lookup/provider outage is fail-closed: retain bytes for the next
        // pass rather than risk deleting a live intake.
        errors += 1;
      }
    }
    cursor = page.at(-1)._id;
    if (String(cursor) === String(tail._id)) break;
  }
  return { examined, removed, retained, errors };
}

async function materialize(reference, metadata = {}) {
  if (!reference?.fileId) {
    const error = new Error('The durable CV file is missing');
    error.code = 'CV_DURABLE_FILE_MISSING';
    throw error;
  }
  const expected = expectedIntegrity(reference);
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'seemplify-cv-worker-'));
  const filePath = path.join(directory, safeFileName(metadata.originalName));
  const digest = crypto.createHash('sha256');
  let materializedLength = 0;
  const hashStream = new Transform({
    transform(chunk, _encoding, callback) {
      digest.update(chunk);
      materializedLength += chunk.length;
      callback(null, chunk);
    }
  });
  try {
    await pipeline(
      bucket(referenceBucketName(reference.bucket)).openDownloadStream(objectId(reference.fileId)),
      hashStream,
      fs.createWriteStream(filePath, { flags: 'wx', mode: 0o600 })
    );
    const materializedSha256 = digest.digest('hex');
    if (
      materializedLength !== expected.length
      || materializedSha256 !== expected.sha256
    ) {
      throw integrityError(
        `The durable CV file failed integrity verification (expected ${expected.length} bytes, received ${materializedLength})`
      );
    }
  } catch (error) {
    await removeWorkerTempDirectory(directory).catch(() => {});
    error.code = error.code === 'ENOENT' ? 'CV_DURABLE_FILE_MISSING' : (error.code || 'CV_DURABLE_STORAGE_READ_FAILED');
    throw error;
  }
  return {
    filePath,
    async cleanup() {
      await removeWorkerTempDirectory(directory);
    }
  };
}

async function remove(reference) {
  if (!reference?.fileId) return false;
  try {
    await bucket(referenceBucketName(reference.bucket)).delete(objectId(reference.fileId));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || /FileNotFound/i.test(String(error.message || ''))) return false;
    throw error;
  }
}

module.exports = {
  _resetDependenciesForTests() {
    finalizeUploadMetadata = defaultFinalizeUploadMetadata;
  },
  _setMetadataFinalizerForTests(finalizer) {
    finalizeUploadMetadata = finalizer;
  },
  assertWorkerTempDirectory,
  materialize,
  persistPath,
  remove,
  sweepOrphanedIntakes
};
