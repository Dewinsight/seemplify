'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_GRACE_MS = 60 * 60 * 1000;
const ROOT_FILE_PATTERN = /^(?:resume-|cv-replacement-)/;
const BULK_STAGING_PATTERN = /^cv-bulk-[A-Za-z0-9-]+$/;
const BULK_HEARTBEAT_FILE = '.active';

function uploadRoot(rootDirectory) {
  const resolved = path.resolve(rootDirectory || path.join(__dirname, '..', 'uploads'));
  if (path.basename(resolved).toLowerCase() !== 'uploads') {
    const error = new Error('Refusing to sweep outside a dedicated uploads directory');
    error.code = 'CV_UPLOAD_SWEEP_PATH_UNSAFE';
    throw error;
  }
  return resolved;
}

function assertBulkStagingDirectory(root, directory) {
  const bulkRoot = path.resolve(root, 'bulk');
  const resolved = path.resolve(directory);
  if (
    path.dirname(resolved) !== bulkRoot
    || !BULK_STAGING_PATTERN.test(path.basename(resolved))
  ) {
    const error = new Error('Refusing to remove an unsafe bulk CV staging directory');
    error.code = 'CV_BULK_SWEEP_PATH_UNSAFE';
    throw error;
  }
  return resolved;
}

async function directoryActivity(directory) {
  let newest = (await fs.promises.lstat(directory)).mtime;
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const stats = await fs.promises.lstat(path.join(directory, entry.name));
    if (!stats.isSymbolicLink() && stats.mtime > newest) newest = stats.mtime;
  }
  return newest;
}

async function sweepStaleUploads({
  rootDirectory,
  now = new Date(),
  graceMs = Number(process.env.CV_UPLOAD_TEMP_ORPHAN_GRACE_MS || DEFAULT_GRACE_MS),
  limit = 10_000
} = {}) {
  const root = uploadRoot(rootDirectory);
  const cutoff = new Date(new Date(now).getTime() - Math.max(0, Number(graceMs) || 0));
  const maximum = Math.min(Math.max(Number(limit) || 1, 1), 50_000);
  let examined = 0;
  let removed = 0;
  let retained = 0;
  let errors = 0;
  const removeFileIfStale = async (filePath) => {
    if (examined >= maximum) return;
    examined += 1;
    try {
      const stats = await fs.promises.lstat(filePath);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.mtime > cutoff) {
        retained += 1;
        return;
      }
      await fs.promises.unlink(filePath);
      removed += 1;
    } catch (error) {
      if (error.code !== 'ENOENT') errors += 1;
    }
  };

  let rootEntries = [];
  try {
    rootEntries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const entry of rootEntries) {
    if (entry.isFile() && ROOT_FILE_PATTERN.test(entry.name)) {
      await removeFileIfStale(path.join(root, entry.name));
    }
  }

  const bulkRoot = path.join(root, 'bulk');
  let bulkEntries = [];
  try {
    bulkEntries = await fs.promises.readdir(bulkRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const entry of bulkEntries) {
    if (examined >= maximum) break;
    const target = path.join(bulkRoot, entry.name);
    if (entry.isFile()) {
      // Rolling-deploy compatibility for files written by the former flat
      // bulk storage. New requests always use a leased staging directory.
      await removeFileIfStale(target);
      continue;
    }
    if (!entry.isDirectory() || !BULK_STAGING_PATTERN.test(entry.name)) continue;
    examined += 1;
    try {
      const safeDirectory = assertBulkStagingDirectory(root, target);
      const lastActivity = await directoryActivity(safeDirectory);
      if (lastActivity > cutoff) {
        retained += 1;
        continue;
      }
      await fs.promises.rm(safeDirectory, { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      if (error.code !== 'ENOENT') errors += 1;
    }
  }
  return { examined, removed, retained, errors };
}

module.exports = {
  BULK_HEARTBEAT_FILE,
  BULK_STAGING_PATTERN,
  ROOT_FILE_PATTERN,
  assertBulkStagingDirectory,
  sweepStaleUploads,
  uploadRoot
};
