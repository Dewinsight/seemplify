const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { INDEX_KEY, INDEX_NAME, migrateGoalIdempotencyIndex } = require('../services/goalIdempotencyIndex');
const OKR = require('../models/OKR');

const LEGACY = 'organizationId_1_assignment.idempotencyKey_1';
let mongo;
let collection;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { autoIndex: false });
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  collection = mongoose.connection.db.collection('okrs');
  await collection.createIndex(INDEX_KEY, { name: LEGACY, unique: true, sparse: true });
});
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

test('repairs the deployed sparse index without changing goals, and keeps tenant-scoped retry protection', async () => {
  const original = { _id: new mongoose.Types.ObjectId(), organizationId: 'org-a', title: 'Existing goal' };
  await collection.insertOne(original);
  await expect(collection.insertOne({ organizationId: 'org-a', title: 'Second manual goal' })).rejects.toMatchObject({ code: 11000 });
  const preview = await migrateGoalIdempotencyIndex(collection);
  expect(preview).toMatchObject({ mode: 'dry-run', legacyExists: true, replacementExists: false });
  expect((await collection.indexes()).some((index) => index.name === LEGACY)).toBe(true);
  const repaired = await migrateGoalIdempotencyIndex(collection, { apply: true });
  expect(repaired).toMatchObject({ created: true, retired: true });
  expect(await collection.findOne({ _id: original._id })).toEqual(original);
  await collection.insertMany([
    { organizationId: 'org-a' }, { organizationId: 'org-a' },
    { organizationId: 'org-a', assignment: { idempotencyKey: null } },
    { organizationId: 'org-a', assignment: { idempotencyKey: null } },
    { organizationId: 'org-a', assignment: { idempotencyKey: 'retry-one' } },
    { organizationId: 'org-b', assignment: { idempotencyKey: 'retry-one' } }
  ]);
  await expect(collection.insertOne({ organizationId: 'org-a', assignment: { idempotencyKey: 'retry-one' } })).rejects.toMatchObject({ code: 11000 });
  expect(await collection.countDocuments()).toBe(7);
  expect(await migrateGoalIdempotencyIndex(collection, { apply: true })).toMatchObject({ replacementExists: true, legacyExists: false, created: false, retired: false });
  await OKR.createIndexes();
  expect((await collection.indexes()).some((index) => index.name === LEGACY)).toBe(false);
});

test('refuses to retire a legacy index whose options differ from the known defect', async () => {
  await collection.dropIndex(LEGACY);
  await collection.createIndex(INDEX_KEY, { name: LEGACY, unique: true });
  await expect(migrateGoalIdempotencyIndex(collection, { apply: true })).rejects.toThrow('unexpected options');
  expect((await collection.indexes()).some((index) => index.name === LEGACY)).toBe(true);
  expect((await collection.indexes()).some((index) => index.name === INDEX_NAME)).toBe(false);
});

test('a failed replacement build preserves existing documents and unrelated indexes', async () => {
  await collection.dropIndex(LEGACY);
  await collection.createIndex({ title: 1 });
  await collection.insertMany([1, 2].map((number) => ({ organizationId: 'org-a', title: `Goal ${number}`, assignment: { idempotencyKey: 'duplicate' } })));
  await expect(migrateGoalIdempotencyIndex(collection, { apply: true })).rejects.toMatchObject({ code: 11000 });
  expect(await collection.countDocuments()).toBe(2);
  expect((await collection.indexes()).some((index) => index.name === 'title_1')).toBe(true);
});

test('a fresh database can install the replacement without requiring a legacy collection', async () => {
  await collection.drop();
  expect(await migrateGoalIdempotencyIndex(collection)).toMatchObject({ replacementExists: false, legacyExists: false });
  expect(await migrateGoalIdempotencyIndex(collection, { apply: true })).toMatchObject({ created: true, retired: false });
  expect((await collection.indexes()).find((index) => index.name === INDEX_NAME).unique).toBe(true);
});
