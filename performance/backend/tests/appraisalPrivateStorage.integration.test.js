'use strict';
// Real appraisal routes, authorization, Mongo records and Cloudinary signing.
// Upload/delete transport is a named substitute; no provider is contacted.
jest.mock('../services/platformConfigurationClient', () => ({ resolveStoragePlatformConfiguration: jest.fn(async () => ({
  configured: true, defaultProvider: 'cloudinary', providers: { cloudinary: {
    configured: true, cloudName: 'synthetic-cloud', apiKey: 'synthetic-key', apiSecret: 'synthetic-secret'
  } }
})) }));
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { Writable } = require('node:stream');
const cloudinary = require('cloudinary').v2;
const Appraisal = require('../models/Appraisal');
const Cycle = require('../models/AppraisalCycle');
const Document = require('../models/AppraisalDocument');
const routes = require('../routes/appraisals');
let app, mongo, appraisal;
const org = 'private-storage-acceptance';
const actor = name => ({ id: name, sub: name, name: `Synthetic ${name}`, email: `${name}@example.test`,
  currentOrganization: { id: name === 'foreign' ? 'other-organization' : org, role: 'staff', appAccess: { mode: 'all', appIds: [] } },
  organizations: [{ id: name === 'foreign' ? 'other-organization' : org, role: 'staff', appAccess: { mode: 'all', appIds: [] } }] });
const call = (method, suffix, who = 'employee') => request(app)[method](`/api/appraisals/${appraisal._id}${suffix}`).set('x-storage-actor', who);
async function document(values = {}) {
  return Document.create({ appraisalId: appraisal._id, organizationId: org, fileName: 'server-private-key.txt', originalName: 'synthetic.txt',
    fileType: 'txt', mimeType: 'text/plain', storageProvider: 'cloudinary', storageKey: 'server-private-key.txt', storageResourceType: 'raw',
    storageDeliveryType: 'authenticated', storageFormat: 'txt', visibility: 'employee_only', uploadedBy: { userId: 'employee', role: 'employee' }, ...values });
}
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json());
  app.use((req, _res, next) => { const who = req.get('x-storage-actor') || 'employee'; if (who !== 'anonymous') {
    const user = actor(who); req.session = { user, currentOrganizationId: user.currentOrganization.id };
  } next(); });
  app.use('/api/appraisals', routes);
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  const cycle = await Cycle.create({ organizationId: org, name: 'Synthetic private documents', status: 'active', periodStart: '2026-01-01',
    periodEnd: '2026-12-31', createdBy: { userId: 'manager' }, settings: { enableAiAssist: false, requireOkrAlignment: false } });
  appraisal = await Appraisal.create({ organizationId: org, cycleId: cycle._id, employee: { userId: 'employee', name: 'Synthetic employee', email: 'employee@example.test' },
    manager: { userId: 'manager', name: 'Synthetic manager', email: 'manager@example.test' }, status: 'self_assessment_pending' });
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

test('content authorization precedes fresh five-minute signing; foreign, anonymous and unrelated actors never sign', async () => {
  const source = await document(); const sign = jest.spyOn(cloudinary.utils, 'private_download_url');
  for (const [who, code] of [['anonymous', 401], ['foreign', 404], ['outsider', 403]]) {
    await call('get', `/documents/${source._id}/content`, who).expect(code);
  }
  expect(sign).not.toHaveBeenCalled();
  const now = jest.spyOn(Date, 'now').mockReturnValue(1800000000000);
  const first = await call('get', `/documents/${source._id}/content`).expect(302);
  expect(first.headers['cache-control']).toBe('private, no-store'); expect(first.headers['referrer-policy']).toBe('no-referrer');
  const url = new URL(first.headers.location); expect(url.pathname).toBe('/v1_1/synthetic-cloud/raw/download');
  expect(url.searchParams.get('public_id')).toBe('server-private-key.txt'); expect(url.searchParams.get('type')).toBe('authenticated');
  expect(url.searchParams.get('expires_at')).toBe('1800000300'); expect(url.searchParams.has('format')).toBe(false);
  expect(url.searchParams.get('signature')).toMatch(/^[a-f0-9]+$/);
  now.mockReturnValue(1800000600000);
  const next = await call('get', `/documents/${source._id}/content`).expect(302);
  expect(new URL(next.headers.location).searchParams.get('expires_at')).toBe('1800000900');
  expect(next.headers.location).not.toBe(first.headers.location);
});

test('legacy Azure and public Cloudinary contents retain original URL after central default switch', async () => {
  const sign = jest.spyOn(cloudinary.utils, 'private_download_url');
  for (const [provider, url] of [['azure-blob', 'https://synthetic.blob.core.windows.net/original/file?synthetic-sas'],
    ['cloudinary', 'https://res.cloudinary.com/synthetic/image/upload/original.pdf']]) {
    const source = await document({ storageProvider: provider, storageUrl: url, storageDeliveryType: undefined });
    const response = await call('get', `/documents/${source._id}/content`).expect(302); expect(response.headers.location).toBe(url);
  }
  expect(sign).not.toHaveBeenCalled();
});

test('ordinary upload persists private snapshot but upload/detail/appraisal JSON contain no provider keys or links', async () => {
  const upload = jest.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation((options, done) => {
    const parts = []; return new Writable({ write(chunk, _encoding, callback) { parts.push(chunk); callback(); }, final(callback) {
      done(null, { public_id: options.public_id, resource_type: 'raw', type: 'authenticated', bytes: Buffer.concat(parts).length,
        secure_url: 'https://res.cloudinary.com/synthetic/raw/authenticated/not-for-the-client' }); callback();
    } });
  });
  const response = await call('post', '/documents').attach('file', Buffer.from('Synthetic plain text evidence.'), { filename: 'evidence.txt', contentType: 'text/plain' }).expect(201);
  expect(upload).toHaveBeenCalledTimes(1); const source = await Document.findById(response.body.data._id);
  expect(source.storageDeliveryType).toBe('authenticated'); expect(source.storageResourceType).toBe('raw'); expect(source.storageFormat).toBe('txt');
  expect(source.storageKey).toMatch(/\.txt$/); expect(source.storageUrl).toBeUndefined();
  for (const value of [response.body.data, (await call('get', `/documents/${source._id}`).expect(200)).body.data,
    JSON.parse(JSON.stringify(await Appraisal.findById(appraisal._id).populate('documents'))).documents[0]]) {
    for (const key of ['storageKey', 'storagePath', 'fileName', 'storageUrl', 'publicUrl', 'storageDeliveryType', 'storageFormat']) expect(value[key]).toBeUndefined();
  }
  expect(source.toObject().storageKey).toBe(source.storageKey);
});

test('delete passes captured authenticated type and cannot be repeated by unrelated actors', async () => {
  const source = await document(); appraisal.documents.push(source._id); await appraisal.save();
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
  await call('delete', `/documents/${source._id}`, 'outsider').expect(403); expect(destroy).not.toHaveBeenCalled();
  await call('delete', `/documents/${source._id}`).expect(200);
  expect(destroy).toHaveBeenCalledWith('server-private-key.txt', expect.objectContaining({ resource_type: 'raw', type: 'authenticated', invalidate: true }));
  await call('get', `/documents/${source._id}/content`).expect(404);
  expect((await Document.findById(source._id)).status).toBe('deleted');
});

test('database failure after private upload deletes the captured authenticated snapshot without a storage URL', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation((options, done) => new Writable({
    write(_chunk, _encoding, callback) { callback(); },
    final(callback) { done(null, { public_id: options.public_id, resource_type: 'raw', type: 'authenticated', bytes: 28 }); callback(); }
  }));
  jest.spyOn(Document.prototype, 'save').mockRejectedValueOnce(new Error('Synthetic database failure'));
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
  await call('post', '/documents').attach('file', Buffer.from('Synthetic persistence failure'), { filename: 'evidence.txt', contentType: 'text/plain' }).expect(500);
  expect(destroy).toHaveBeenCalledWith(expect.stringMatching(/\.txt$/), expect.objectContaining({ type: 'authenticated', resource_type: 'raw' }));
  expect(await Document.countDocuments()).toBe(0);
});
