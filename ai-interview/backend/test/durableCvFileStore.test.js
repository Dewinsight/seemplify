const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-ai-cv-store-'));
process.env.AI_INTERVIEW_STORE_PATH = path.join(testDirectory, 'store.json');
process.env.AI_INTERVIEW_CV_STORAGE_DIR = path.join(testDirectory, 'cv-files');
delete process.env.AI_INTERVIEW_MONGO_URI;
delete process.env.MONGO_URI;
delete process.env.MONGODB_URI;

const durableCvFileStore = require('../src/durableCvFileStore');

test.after(() => {
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

test.afterEach(() => {
  durableCvFileStore._resetDependenciesForTests();
});

test('GridFS reads verify file metadata, byte length, and content SHA-256', async () => {
  const bytes = Buffer.from('verified GridFS bytes');
  const reference = {
    provider: 'gridfs',
    bucket: 'ai_interview_cv_ingestion_files',
    fileId: '507f1f77bcf86cd799439011',
    length: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex')
  };
  const database = {
    collection() {
      return {
        async findOne() {
          return {
            length: bytes.length,
            metadata: { sha256: reference.sha256 }
          };
        }
      };
    }
  };
  let downloaded = bytes;
  durableCvFileStore._setGridFsBucketFactoryForTests(() => ({
    openDownloadStream() {
      return Readable.from([downloaded]);
    }
  }));
  assert.deepEqual(
    await durableCvFileStore._readGridFsBufferForTests(database, reference),
    bytes
  );

  downloaded = Buffer.from('corrupted GridFS byte');
  assert.equal(downloaded.length, bytes.length);
  await assert.rejects(
    () => durableCvFileStore._readGridFsBufferForTests(database, reference),
    (error) => error.code === 'CV_DURABLE_FILE_CORRUPT'
  );
});

test('GridFS cleanup removes partial chunks when a crash left no files document', async () => {
  const reference = {
    provider: 'gridfs',
    bucket: 'ai_interview_cv_ingestion_files',
    fileId: '507f1f77bcf86cd799439012'
  };
  let deletedFileId;
  const database = {
    collection(name) {
      assert.equal(name, 'ai_interview_cv_ingestion_files.chunks');
      return {
        async deleteMany(filter) {
          deletedFileId = String(filter.files_id);
          return { deletedCount: 3 };
        }
      };
    }
  };
  durableCvFileStore._setGridFsBucketFactoryForTests(() => ({
    async delete() {
      throw new Error(`File not found for id ${reference.fileId}`);
    }
  }));
  assert.equal(
    await durableCvFileStore._removeGridFsForTests(database, reference),
    true
  );
  assert.equal(deletedFileId, reference.fileId);
});

test('filesystem persistence and reads verify length and SHA-256', async () => {
  const bytes = Buffer.from('Grace Hopper\ngrace@example.com\nCompiler and distributed systems leader.');
  const reference = await durableCvFileStore.persistBuffer(bytes, {
    originalName: 'grace.txt',
    mimeType: 'text/plain',
    organizationId: 'settings'
  });
  assert.equal(reference.provider, 'filesystem');
  assert.equal(reference.length, bytes.length);
  assert.equal(reference.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(await durableCvFileStore.readBuffer(reference), bytes);

  const target = path.join(process.env.AI_INTERVIEW_CV_STORAGE_DIR, reference.storageKey);
  await fs.promises.appendFile(target, 'corruption');
  await assert.rejects(
    () => durableCvFileStore.readBuffer(reference),
    (error) => error.code === 'CV_DURABLE_FILE_CORRUPT'
  );
  await durableCvFileStore.remove(reference);
});

test('filesystem persistence removes partial output when the atomic rename fails', async () => {
  const originalRename = fs.promises.rename;
  fs.promises.rename = async () => {
    const error = new Error('synthetic rename failure');
    error.code = 'EIO';
    throw error;
  };
  try {
    await assert.rejects(
      () => durableCvFileStore.persistBuffer(Buffer.from('partial bytes'), {
        originalName: 'partial.txt',
        mimeType: 'text/plain'
      }),
      /synthetic rename failure/
    );
  } finally {
    fs.promises.rename = originalRename;
  }
  const entries = await fs.promises.readdir(process.env.AI_INTERVIEW_CV_STORAGE_DIR);
  assert.deepEqual(entries, []);
});

test('filesystem references cannot escape or alias the owned storage directory', async () => {
  const sentinel = path.join(testDirectory, 'sentinel.txt');
  await fs.promises.writeFile(sentinel, 'keep');
  const malicious = {
    provider: 'filesystem',
    storageKey: '../sentinel.txt',
    length: 4,
    sha256: crypto.createHash('sha256').update('keep').digest('hex')
  };
  await assert.rejects(
    () => durableCvFileStore.readBuffer(malicious),
    (error) => error.code === 'CV_DURABLE_FILE_INVALID'
  );
  await assert.rejects(
    () => durableCvFileStore.remove(malicious),
    (error) => error.code === 'CV_DURABLE_FILE_INVALID'
  );
  assert.equal(await fs.promises.readFile(sentinel, 'utf8'), 'keep');
});
