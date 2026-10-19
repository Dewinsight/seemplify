const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
  INDEX_KEY, INDEX_NAME, INDEX_OPTIONS, LEGACY_NAME, migrateGoalCheckInIdempotencyIndex
} = require('../services/goalCheckInIdempotencyIndex');
const GoalCheckIn = require('../models/GoalCheckIn');

let mongo;
let collection;
let goalId;
const record = (sequence, fields = {}) => ({
  organizationId: 'org-a', goalId, ownerId: 'employee-a', sequence,
  checkedInBy: { userId: 'employee-a' }, summary: `Check-in ${sequence}`, ...fields
});
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { autoIndex: false });
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  collection = mongoose.connection.db.collection('goalcheckins');
  goalId = new mongoose.Types.ObjectId();
  await collection.createIndex(INDEX_KEY, { name: LEGACY_NAME, unique: true, sparse: true });
});
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

test('repairs the real second-unkeyed-check-in failure without changing existing evidence or unrelated indexes', async () => {
  const original = { _id: new mongoose.Types.ObjectId(), ...record(1) };
  await collection.createIndex({ summary: 1 });
  await collection.insertOne(original);
  await expect(collection.insertOne(record(2))).rejects.toMatchObject({ code: 11000 });
  const before = await collection.indexes();
  expect(await migrateGoalCheckInIdempotencyIndex(collection)).toMatchObject({ mode: 'dry-run', legacyExists: true, replacementExists: false, created: false, retired: false });
  expect(await collection.indexes()).toEqual(before);
  expect(await migrateGoalCheckInIdempotencyIndex(collection, { apply: true })).toMatchObject({ created: true, retired: true });
  await collection.insertOne(record(2));
  expect(await collection.findOne({ _id: original._id })).toEqual(original);
  expect(await collection.countDocuments()).toBe(2);
  expect((await collection.indexes()).some(index => index.name === 'summary_1')).toBe(true);
  expect(await migrateGoalCheckInIdempotencyIndex(collection, { apply: true })).toMatchObject({ replacementExists: true, legacyExists: false, created: false, retired: false });
});

test('model indexes allow repeated missing/null/empty keys and preserve retry uniqueness per tenant and goal', async () => {
  await collection.drop();
  await GoalCheckIn.createIndexes();
  await GoalCheckIn.create(record(1));
  await GoalCheckIn.create(record(2));
  await GoalCheckIn.create(record(3, { idempotencyKey: null }));
  await GoalCheckIn.create(record(4, { idempotencyKey: null }));
  await GoalCheckIn.create(record(5, { idempotencyKey: '' }));
  await GoalCheckIn.create(record(6, { idempotencyKey: '' }));
  await GoalCheckIn.create(record(7, { idempotencyKey: 'retry-one' }));
  await expect(GoalCheckIn.create(record(8, { idempotencyKey: 'retry-one' }))).rejects.toMatchObject({ code: 11000 });
  await GoalCheckIn.create(record(1, { organizationId: 'org-b', idempotencyKey: 'retry-one' }));
  await GoalCheckIn.create(record(1, { goalId: new mongoose.Types.ObjectId(), idempotencyKey: 'retry-one' }));
  expect(await GoalCheckIn.countDocuments()).toBe(9);
  expect((await collection.indexes()).some(index => index.name === LEGACY_NAME)).toBe(false);
});

test('refuses to remove a legacy index with unexpected options', async () => {
  await collection.dropIndex(LEGACY_NAME);
  await collection.createIndex(INDEX_KEY, { name: LEGACY_NAME, unique: true });
  await expect(migrateGoalCheckInIdempotencyIndex(collection, { apply: true })).rejects.toThrow('unexpected options');
  expect((await collection.indexes()).some(index => index.name === LEGACY_NAME)).toBe(true);
  expect((await collection.indexes()).some(index => index.name === INDEX_NAME)).toBe(false);
});

test('refuses an incorrectly configured replacement before retiring the legacy index', async () => {
  await collection.createIndex({ ownerId: 1 }, { name: INDEX_NAME });
  await expect(migrateGoalCheckInIdempotencyIndex(collection, { apply: true })).rejects.toThrow('unexpected options');
  expect((await collection.indexes()).some(index => index.name === LEGACY_NAME)).toBe(true);
});

test('refuses to replace a custom-collation legacy constraint', async () => {
  await collection.dropIndex(LEGACY_NAME);
  await collection.createIndex(INDEX_KEY, { name: LEGACY_NAME, unique: true, sparse: true, collation: { locale: 'en', strength: 2 } });
  await expect(migrateGoalCheckInIdempotencyIndex(collection, { apply: true })).rejects.toThrow('unexpected options');
  expect((await collection.indexes()).find(index => index.name === LEGACY_NAME).collation.strength).toBe(2);
  expect((await collection.indexes()).some(index => index.name === INDEX_NAME)).toBe(false);
});

test('refuses a custom-collation replacement before retiring the legacy constraint', async () => {
  await collection.createIndex(INDEX_KEY, { ...INDEX_OPTIONS, collation: { locale: 'en', strength: 2 } });
  await expect(migrateGoalCheckInIdempotencyIndex(collection, { apply: true })).rejects.toThrow('unexpected options');
  expect((await collection.indexes()).map(index => index.name)).toEqual(expect.arrayContaining([LEGACY_NAME, INDEX_NAME]));
});

test('duplicate populated keys fail dry-run and apply without editing evidence or indexes', async () => {
  await collection.dropIndex(LEGACY_NAME);
  await collection.createIndex({ summary: 1 });
  const originals = [record(1, { idempotencyKey: 'duplicate' }), record(2, { idempotencyKey: 'duplicate' })];
  await collection.insertMany(originals);
  const indexes = await collection.indexes();
  for (const apply of [false, true]) {
    await expect(migrateGoalCheckInIdempotencyIndex(collection, { apply })).rejects.toThrow('Duplicate populated');
  }
  expect(await collection.find({}).toArray()).toEqual(originals);
  expect(await collection.indexes()).toEqual(indexes);
});

test('replacement-build failure retains the working legacy constraint and all existing evidence', async () => {
  const original = record(1);
  await collection.insertOne(original);
  const failedBuild = { indexes: () => collection.indexes(), aggregate: (...args) => collection.aggregate(...args), createIndex: async () => { throw new Error('injected build outage'); }, dropIndex: () => { throw new Error('must not drop'); } };
  await expect(migrateGoalCheckInIdempotencyIndex(failedBuild, { apply: true })).rejects.toThrow('injected build outage');
  expect((await collection.indexes()).some(index => index.name === LEGACY_NAME)).toBe(true);
  expect(await collection.find({}).toArray()).toEqual([original]);
});

test('failed verification retains the legacy index; a later safe retry completes the migration', async () => {
  let reads = 0;
  const failedVerification = {
    indexes: async () => { const indexes = await collection.indexes(); return ++reads === 1 ? indexes : indexes.filter(index => index.name !== INDEX_NAME); },
    aggregate: (...args) => collection.aggregate(...args), createIndex: (...args) => collection.createIndex(...args),
    dropIndex: () => { throw new Error('must not drop'); }
  };
  await expect(migrateGoalCheckInIdempotencyIndex(failedVerification, { apply: true })).rejects.toThrow('verification failed');
  expect((await collection.indexes()).map(index => index.name)).toEqual(expect.arrayContaining([LEGACY_NAME, INDEX_NAME]));
  expect(await migrateGoalCheckInIdempotencyIndex(collection, { apply: true })).toMatchObject({ replacementExists: true, created: false, retired: true });
});

test('legacy-removal failure preserves both constraints and can be retried without evidence changes', async () => {
  const original = record(1);
  await collection.insertOne(original);
  const failedRemoval = {
    indexes: () => collection.indexes(), aggregate: (...args) => collection.aggregate(...args),
    createIndex: (...args) => collection.createIndex(...args), dropIndex: async () => { throw new Error('injected removal outage'); }
  };
  await expect(migrateGoalCheckInIdempotencyIndex(failedRemoval, { apply: true })).rejects.toThrow('injected removal outage');
  expect((await collection.indexes()).map(index => index.name)).toEqual(expect.arrayContaining([LEGACY_NAME, INDEX_NAME]));
  expect(await collection.find({}).toArray()).toEqual([original]);
  await migrateGoalCheckInIdempotencyIndex(collection, { apply: true });
  await collection.insertOne(record(2));
});

test('fresh-database preview creates nothing and applying installs the declared model index', async () => {
  await collection.drop();
  expect(await migrateGoalCheckInIdempotencyIndex(collection)).toMatchObject({ mode: 'dry-run', legacyExists: false, replacementExists: false });
  expect(await mongoose.connection.db.listCollections({ name: 'goalcheckins' }).hasNext()).toBe(false);
  expect(await migrateGoalCheckInIdempotencyIndex(collection, { apply: true })).toMatchObject({ created: true, retired: false });
  expect((await collection.indexes()).find(index => index.name === INDEX_NAME)).toMatchObject(INDEX_OPTIONS);
});
