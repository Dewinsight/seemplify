const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const mongoose = require('mongoose');
const { STORE_PATH, readStore, shouldUseMongo } = require('./store');

const BUCKET_NAME = 'ai_interview_cv_ingestion_files';
const defaultCreateGridFsBucket = (db, options) => new mongoose.mongo.GridFSBucket(db, options);
let createGridFsBucket = defaultCreateGridFsBucket;

function safeFileName(value) {
  return path.basename(String(value || 'cv-upload'))
    .replace(/[^\w .()-]/g, '_')
    .slice(0, 180) || 'cv-upload';
}

async function database() {
  await readStore();
  if (!mongoose.connection?.db) {
    const error = new Error('MongoDB is not connected; durable CV storage is unavailable');
    error.code = 'CV_DURABLE_STORAGE_UNAVAILABLE';
    throw error;
  }
  return mongoose.connection.db;
}

function storageDirectory() {
  return process.env.AI_INTERVIEW_CV_STORAGE_DIR
    ? path.resolve(process.env.AI_INTERVIEW_CV_STORAGE_DIR)
    : path.join(path.dirname(STORE_PATH), 'cv-files');
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

function assertBufferIntegrity(buffer, reference) {
  const expected = expectedIntegrity(reference);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  if (buffer.length !== expected.length || sha256 !== expected.sha256) {
    throw integrityError(
      `The durable CV file failed integrity verification (expected ${expected.length} bytes, received ${buffer.length})`
    );
  }
  return buffer;
}

function objectId(value) {
  if (value instanceof mongoose.mongo.ObjectId) return value;
  if (!mongoose.mongo.ObjectId.isValid(String(value || ''))) {
    throw integrityError('The durable CV file reference is invalid', 'CV_DURABLE_FILE_INVALID');
  }
  return new mongoose.mongo.ObjectId(String(value));
}

function gridFsBucketName(value) {
  const name = String(value || BUCKET_NAME);
  if (name !== BUCKET_NAME) {
    throw integrityError('The durable CV bucket reference is invalid', 'CV_DURABLE_FILE_INVALID');
  }
  return name;
}

function filesystemTarget(storageKey) {
  const normalizedKey = String(storageKey || '');
  if (!normalizedKey || normalizedKey !== path.basename(normalizedKey)) {
    throw integrityError('The durable CV file reference is invalid', 'CV_DURABLE_FILE_INVALID');
  }
  const directory = path.resolve(storageDirectory());
  const target = path.resolve(directory, normalizedKey);
  if (path.dirname(target) !== directory) {
    throw integrityError('The durable CV file reference is invalid', 'CV_DURABLE_FILE_INVALID');
  }
  return target;
}

function planReference(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    const error = new Error('Uploaded CV is empty');
    error.code = 'CV_FILE_EMPTY';
    throw error;
  }
  const integrity = {
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    length: buffer.length
  };
  if (shouldUseMongo()) {
    return {
      provider: 'gridfs',
      bucket: BUCKET_NAME,
      fileId: String(new mongoose.mongo.ObjectId()),
      ...integrity
    };
  }
  return {
    provider: 'filesystem',
    storageKey: `${crypto.randomUUID()}.cv`,
    ...integrity
  };
}

function referenceKey(reference = {}) {
  if (reference.provider === 'gridfs' && reference.fileId) {
    return `gridfs:${gridFsBucketName(reference.bucket)}:${String(reference.fileId)}`;
  }
  if (reference.provider === 'filesystem' && reference.storageKey) {
    return `filesystem:${path.basename(filesystemTarget(reference.storageKey))}`;
  }
  return null;
}

function assertPlannedReference(reference, sha256, length) {
  if (!reference) return;
  const expected = expectedIntegrity(reference);
  if (expected.sha256 !== sha256 || expected.length !== length) {
    throw integrityError(
      'The durable CV intake binding does not match the uploaded bytes',
      'CV_DURABLE_FILE_BINDING_MISMATCH'
    );
  }
  referenceKey(reference);
}

async function readGridFsBuffer(db, reference) {
  const name = gridFsBucketName(reference.bucket);
  const fileId = objectId(reference.fileId);
  const file = await db.collection(`${name}.files`).findOne({ _id: fileId });
  if (!file) {
    throw integrityError('The durable CV file is missing', 'CV_DURABLE_FILE_MISSING');
  }
  const expected = expectedIntegrity(reference);
  if (
    Number(file.length) !== expected.length
    || String(file.metadata?.sha256 || '').toLowerCase() !== expected.sha256
  ) {
    throw integrityError('The durable CV GridFS metadata failed integrity verification');
  }
  const bucket = createGridFsBucket(db, { bucketName: name });
  const chunks = [];
  try {
    for await (const chunk of bucket.openDownloadStream(fileId)) chunks.push(chunk);
  } catch (error) {
    if (error.code === 'ENOENT' || /File\s*not\s*found/i.test(String(error.message || ''))) {
      throw integrityError('The durable CV file is missing', 'CV_DURABLE_FILE_MISSING');
    }
    error.code = error.code || 'CV_DURABLE_STORAGE_READ_FAILED';
    throw error;
  }
  return assertBufferIntegrity(Buffer.concat(chunks), reference);
}

async function persistBuffer(buffer, metadata = {}, { reference = null } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    const error = new Error('Uploaded CV is empty');
    error.code = 'CV_FILE_EMPTY';
    throw error;
  }
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  assertPlannedReference(reference, sha256, buffer.length);
  if (shouldUseMongo()) {
    const db = await database();
    const bucket = createGridFsBucket(db, { bucketName: BUCKET_NAME });
    const plannedId = reference ? objectId(reference.fileId) : null;
    if (plannedId) {
      try {
        await readGridFsBuffer(db, reference);
        return { ...reference, persistedAt: reference.persistedAt || new Date().toISOString() };
      } catch (error) {
        if (error.code !== 'CV_DURABLE_FILE_MISSING') throw error;
      }
    }
    const uploadOptions = {
      contentType: String(metadata.mimeType || 'application/octet-stream').slice(0, 127),
      metadata: {
        purpose: 'ai-interview-cv-ingestion',
        organizationId: String(metadata.organizationId || '').slice(0, 100),
        intakeId: String(metadata.intakeId || '').slice(0, 100),
        sha256,
        createdAt: new Date()
      }
    };
    const upload = plannedId
      ? bucket.openUploadStreamWithId(
        plannedId,
        safeFileName(metadata.originalName),
        uploadOptions
      )
      : bucket.openUploadStream(safeFileName(metadata.originalName), uploadOptions);
    let completed = false;
    try {
      await pipeline(Readable.from(buffer), upload);
      completed = true;
      await readGridFsBuffer(db, {
        provider: 'gridfs',
        bucket: BUCKET_NAME,
        fileId: String(upload.id),
        sha256,
        length: buffer.length
      });
    } catch (error) {
      if (!completed) {
        try {
          await upload.abort();
        } catch (cleanupError) {
          error.cleanupError = cleanupError;
          error.cleanupReference = {
            provider: 'gridfs',
            bucket: BUCKET_NAME,
            fileId: String(upload.id)
          };
        }
      } else {
        try {
          await bucket.delete(upload.id);
        } catch (cleanupError) {
          error.cleanupError = cleanupError;
          error.cleanupReference = {
            provider: 'gridfs',
            bucket: BUCKET_NAME,
            fileId: String(upload.id)
          };
        }
      }
      // Concurrent exact replays use the same pre-committed file identity. One
      // upload can lose GridFS's unique-files race after the other has safely
      // completed; in that case the verified winner is the durable result.
      if (plannedId) {
        try {
          await readGridFsBuffer(db, reference);
          return { ...reference, persistedAt: reference.persistedAt || new Date().toISOString() };
        } catch {}
      }
      error.code = error.code || 'CV_DURABLE_STORAGE_WRITE_FAILED';
      throw error;
    }
    return {
      provider: 'gridfs',
      bucket: BUCKET_NAME,
      fileId: String(plannedId || upload.id),
      sha256,
      length: buffer.length,
      persistedAt: new Date().toISOString()
    };
  }

  const directory = storageDirectory();
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
  // Keep user-provided filenames out of filesystem paths and cleanup records.
  const storageKey = reference?.storageKey || `${crypto.randomUUID()}.cv`;
  const target = filesystemTarget(storageKey);
  if (reference) {
    try {
      const existing = await fs.promises.readFile(target);
      assertBufferIntegrity(existing, reference);
      return { ...reference, persistedAt: reference.persistedAt || new Date().toISOString() };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let renamed = false;
  try {
    await fs.promises.writeFile(temporary, buffer, { flag: 'wx', mode: 0o600 });
    try {
      await fs.promises.rename(temporary, target);
      renamed = true;
    } catch (error) {
      if (!reference || !['EEXIST', 'EPERM'].includes(error.code)) throw error;
      assertBufferIntegrity(await fs.promises.readFile(target), reference);
      await fs.promises.unlink(temporary).catch(() => {});
    }
    assertBufferIntegrity(await fs.promises.readFile(target), {
      sha256,
      length: buffer.length
    });
  } catch (error) {
    const cleanupErrors = [];
    for (const cleanupPath of renamed ? [temporary, target] : [temporary]) {
      try {
        await fs.promises.unlink(cleanupPath);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length) {
      error.cleanupError = cleanupErrors[0];
      error.cleanupReference = {
        provider: 'filesystem',
        storageKey: renamed ? storageKey : path.basename(temporary)
      };
    }
    error.code = error.code || 'CV_DURABLE_STORAGE_WRITE_FAILED';
    throw error;
  }
  return {
    provider: 'filesystem',
    storageKey,
    sha256,
    length: buffer.length,
    persistedAt: new Date().toISOString()
  };
}

async function readBuffer(reference) {
  if (reference?.provider === 'gridfs' && reference.fileId) {
    const db = await database();
    return readGridFsBuffer(db, reference);
  }
  if (reference?.provider === 'filesystem' && reference.storageKey) {
    const target = filesystemTarget(reference.storageKey);
    try {
      return assertBufferIntegrity(await fs.promises.readFile(target), reference);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw integrityError('The durable CV file is missing', 'CV_DURABLE_FILE_MISSING');
      }
      throw error;
    }
  }
  const error = new Error('The durable CV file is missing');
  error.code = 'CV_DURABLE_FILE_MISSING';
  throw error;
}

async function removeGridFs(db, reference) {
  const bucketName = gridFsBucketName(reference.bucket);
  const fileId = objectId(reference.fileId);
  try {
    const bucket = createGridFsBucket(db, { bucketName });
    await bucket.delete(fileId);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || /File\s*not\s*found/i.test(String(error.message || ''))) {
      // A process can die after GridFS chunks are written but before the files
      // document is committed. The pre-committed intake ID lets cleanup remove
      // those otherwise invisible PII chunks directly.
      const result = await db.collection(`${bucketName}.chunks`).deleteMany({ files_id: fileId });
      return Number(result.deletedCount || 0) > 0;
    }
    throw error;
  }
}

async function remove(reference) {
  if (reference?.provider === 'gridfs' && reference.fileId) {
    const db = await database();
    return removeGridFs(db, reference);
  }
  if (reference?.provider === 'filesystem' && reference.storageKey) {
    const target = filesystemTarget(reference.storageKey);
    await fs.promises.unlink(target).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    return true;
  }
  return false;
}

async function listManagedReferences({
  before = new Date(),
  limit = 500,
  after = null
} = {}) {
  const safeLimit = Math.max(1, Math.min(5_000, Math.floor(Number(limit) || 500)));
  const cutoff = new Date(before);
  if (shouldUseMongo()) {
    const db = await database();
    const filter = {
      'metadata.purpose': 'ai-interview-cv-ingestion',
      uploadDate: { $lte: cutoff }
    };
    if (after) filter._id = { $gt: objectId(after) };
    const rows = await db.collection(`${BUCKET_NAME}.files`).find(filter)
      .sort({ _id: 1 })
      .limit(safeLimit)
      .toArray();
    const references = rows.map((file) => ({
      provider: 'gridfs',
      bucket: BUCKET_NAME,
      fileId: String(file._id),
      length: Number(file.length),
      sha256: String(file.metadata?.sha256 || '').toLowerCase(),
      persistedAt: new Date(file.uploadDate || file.metadata?.createdAt || 0).toISOString()
    }));
    return {
      references,
      nextCursor: rows.length === safeLimit ? String(rows[rows.length - 1]._id) : null
    };
  }

  const directory = storageDirectory();
  let names;
  try {
    names = (await fs.promises.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.cv'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error.code === 'ENOENT') return { references: [], nextCursor: null };
    throw error;
  }
  const references = [];
  let lastVisited = null;
  for (const name of names) {
    if (after && name <= String(after)) continue;
    lastVisited = name;
    const stat = await fs.promises.stat(filesystemTarget(name));
    if (stat.mtimeMs > cutoff.getTime()) continue;
    references.push({
      provider: 'filesystem',
      storageKey: name,
      length: stat.size,
      persistedAt: stat.mtime.toISOString()
    });
    if (references.length >= safeLimit) break;
  }
  return {
    references,
    nextCursor: references.length === safeLimit ? lastVisited : null
  };
}

module.exports = {
  _readGridFsBufferForTests: readGridFsBuffer,
  _removeGridFsForTests: removeGridFs,
  _resetDependenciesForTests() {
    createGridFsBucket = defaultCreateGridFsBucket;
  },
  _setGridFsBucketFactoryForTests(factory) {
    createGridFsBucket = factory;
  },
  assertBufferIntegrity,
  listManagedReferences,
  planReference,
  persistBuffer,
  readBuffer,
  referenceKey,
  remove
};
