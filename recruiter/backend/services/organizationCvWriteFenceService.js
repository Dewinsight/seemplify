'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const Organization = require('../models/Organization');

const DEFAULT_LEASE_MS = Math.max(
  60_000,
  Number(process.env.ORGANIZATION_CV_WRITE_LEASE_MS || 15 * 60 * 1000)
);

function fenceError() {
  const error = new Error('This organization is being deleted and cannot accept new CV processing work.');
  error.code = 'ORGANIZATION_ERASURE_IN_PROGRESS';
  error.statusCode = 409;
  return error;
}

async function acquire(organizationId, kind = 'cv-write', { leaseMs = DEFAULT_LEASE_MS } = {}) {
  if (!mongoose.isValidObjectId(organizationId)) throw fenceError();
  const token = crypto.randomUUID();
  const acquiredAt = new Date();
  const expiresAt = new Date(acquiredAt.getTime() + Math.max(60_000, Number(leaseMs) || DEFAULT_LEASE_MS));
  const claimed = await Organization.updateOne(
    {
      _id: organizationId,
      isActive: { $ne: false },
      erasureState: { $ne: 'tombstoned' }
    },
    {
      $push: {
        cvWriteLeases: {
          token,
          kind: String(kind || 'cv-write').slice(0, 80),
          acquiredAt,
          expiresAt
        }
      }
    }
  );
  if (!Number(claimed.matchedCount || claimed.n || 0)) throw fenceError();
  return { organizationId: String(organizationId), token, acquiredAt, expiresAt, leaseMs };
}

async function renew(lease, { leaseMs = lease?.leaseMs || DEFAULT_LEASE_MS } = {}) {
  if (!lease?.token || !mongoose.isValidObjectId(lease.organizationId)) throw fenceError();
  const expiresAt = new Date(Date.now() + Math.max(60_000, Number(leaseMs) || DEFAULT_LEASE_MS));
  const renewed = await Organization.updateOne(
    {
      _id: lease.organizationId,
      erasureState: { $ne: 'tombstoned' },
      cvWriteLeases: { $elemMatch: { token: lease.token, expiresAt: { $gt: new Date() } } }
    },
    { $set: { 'cvWriteLeases.$[lease].expiresAt': expiresAt } },
    { arrayFilters: [{ 'lease.token': lease.token }] }
  );
  if (!Number(renewed.matchedCount || renewed.n || 0)) throw fenceError();
  lease.expiresAt = expiresAt;
  return lease;
}

async function release(lease) {
  if (!lease?.token || !mongoose.isValidObjectId(lease.organizationId)) return false;
  const result = await Organization.updateOne(
    { _id: lease.organizationId },
    { $pull: { cvWriteLeases: { token: lease.token } } }
  );
  return Number(result.modifiedCount || result.nModified || 0) > 0;
}

async function pruneExpired(organizationId, now = new Date()) {
  if (!mongoose.isValidObjectId(organizationId)) return 0;
  const result = await Organization.updateOne(
    { _id: organizationId },
    { $pull: { cvWriteLeases: { expiresAt: { $lte: now } } } }
  );
  return Number(result.modifiedCount || result.nModified || 0);
}

async function liveCount(organizationId, now = new Date()) {
  await pruneExpired(organizationId, now);
  const organization = await Organization.findById(organizationId).select('+cvWriteLeases').lean();
  if (!organization) return 0;
  return (organization.cvWriteLeases || []).filter((lease) => lease.expiresAt > now).length;
}

function startHeartbeat(lease, { intervalMs = Math.max(15_000, Math.floor((lease?.leaseMs || DEFAULT_LEASE_MS) / 3)) } = {}) {
  const timer = setInterval(() => {
    void renew(lease).catch(() => {});
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = {
  DEFAULT_LEASE_MS,
  acquire,
  fenceError,
  liveCount,
  pruneExpired,
  release,
  renew,
  startHeartbeat
};
