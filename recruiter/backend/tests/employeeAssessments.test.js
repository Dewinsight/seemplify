const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { normalizeJobWorkflow, jobWorkflowFilter, assertWorkflowUnchanged } = require('../utils/jobWorkflow');

function controllerFixture() {
  const saved = [];
  let filter;
  class Job {
    constructor(data) { Object.assign(this, { _id: 'record-id' }, data); }
    async save() { saved.push(this); return this; }
    static find(query) {
      filter = query;
      const chain = { populate() { return chain; }, sort() { return chain; }, async limit() { return []; } };
      return chain;
    }
  }
  const dependencies = {
    '../models/Job': Job,
    '../models/Department': { async findOne() { return { _id: 'department' }; } },
    '../models/Notification': { async createJobCreatedNotification() {} },
    '../services/embeddingService': { async createJobEmbedding() {} },
    '../services/interviewService': class {},
    '../utils/htmlDecode': { decodeObjectHtmlEntities: (body) => body },
    '../utils/jobWorkflow': require('../utils/jobWorkflow'),
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/jobController'), 'utf8'), {
    module, exports: module.exports,
    require: (name) => dependencies[name] || (['fs', 'util'].includes(name) ? require(name) : {}),
    console: { log() {}, error() {}, warn() {} }, process, Buffer, setTimeout,
  });
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  return { controller: module.exports, saved, res, filter: () => filter };
}

test('legacy jobs stay in recruitment and assessment queries stay separate', () => {
  assert.equal(normalizeJobWorkflow(), 'recruitment');
  assert.deepEqual(jobWorkflowFilter(), { workflowType: { $ne: 'employee-assessment' } });
  assert.deepEqual(jobWorkflowFilter('employee-assessment'), { workflowType: 'employee-assessment' });
  for (const value of ['other', { $ne: 'recruitment' }, ['employee-assessment']]) {
    assert.throws(() => normalizeJobWorkflow(value), { statusCode: 400 });
  }
});

test('list controller preserves the organization boundary for each workflow', async () => {
  for (const workflowType of ['recruitment', 'employee-assessment']) {
    const f = controllerFixture();
    await f.controller.getAllJobs({ user: { currentOrganization: 'tenant-a' }, query: { workflowType } }, f.res);
    assert.equal(f.res.statusCode, 200);
    assert.equal(f.filter().organization, 'tenant-a');
    assert.deepEqual(JSON.parse(JSON.stringify(f.filter())).workflowType, jobWorkflowFilter(workflowType).workflowType);
  }
});

test('invalid list workflow cannot reach the database', async () => {
  const f = controllerFixture();
  await f.controller.getAllJobs({ user: { currentOrganization: 'tenant-a' }, query: { workflowType: 'all' } }, f.res);
  assert.equal(f.res.statusCode, 400);
  assert.equal(f.filter(), undefined);
});

test('assessment creation uses the existing job engine and authenticated organization', async () => {
  const f = controllerFixture();
  await f.controller.createJob({ user: { id: 'actor', currentOrganization: 'tenant-a' }, body: {
    workflowType: 'employee-assessment', title: 'Review', department: 'department', organization: 'tenant-b',
  } }, f.res);
  assert.equal(f.res.statusCode, 201);
  assert.equal(f.res.body.job.workflowType, 'employee-assessment');
  assert.equal(f.res.body.job.organization, 'tenant-a');
  assert.equal(f.res.body.job.createdBy, 'actor');
});

test('ordinary job creation remains recruitment; invalid type is rejected before saving', async () => {
  const f = controllerFixture();
  await f.controller.createJob({ user: { id: 'actor', currentOrganization: 'tenant-a' }, body: { title: 'Job' } }, f.res);
  assert.equal(f.res.body.job.workflowType, 'recruitment');
  const bad = controllerFixture();
  await bad.controller.createJob({ user: { id: 'actor', currentOrganization: 'tenant-a' }, body: { workflowType: 'invalid' } }, bad.res);
  assert.equal(bad.res.statusCode, 400);
  assert.equal(bad.saved.length, 0);
});

test('editing cannot silently reclassify existing records', () => {
  assert.doesNotThrow(() => assertWorkflowUnchanged({}, undefined));
  assert.doesNotThrow(() => assertWorkflowUnchanged({ workflowType: 'employee-assessment' }, 'employee-assessment'));
  assert.throws(() => assertWorkflowUnchanged({}, 'employee-assessment'), { statusCode: 400 });
  assert.throws(() => assertWorkflowUnchanged({ workflowType: 'employee-assessment' }, 'recruitment'), { statusCode: 400 });
});


test('creation notifications use assessment wording and canonical links for every recipient', async () => {
  class Schema {
    constructor() { this.statics = {}; this.methods = {}; }
    index() {}
    virtual() { return { get() {} }; }
    set() {}
  }
  Schema.Types = { ObjectId: class {}, Mixed: class {} };
  const module = { exports: {} };
  const organization = { name: 'Tenant A', members: [{ status: 'active', user: 'other' }], select() { return { async lean() { return { name: 'Tenant A' }; } }; } };
  const dependencies = {
    mongoose: { Schema, model(name, schema) { return { ...schema.statics, async insertMany(rows) { return rows; } }; } },
    '../utils/htmlDecode': { decodeHtmlEntities: value => value },
    './User': { async findById() { return { currentOrganization: 'tenant-a', name: 'Creator' }; }, async find() { return [{ _id: 'other' }]; } },
    './Organization': { findById() { return organization; } },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../models/Notification'), 'utf8'), {
    module, exports: module.exports, require: name => dependencies[name], console,
  });
  for (const workflowType of ['recruitment', 'employee-assessment']) {
    const assessment = workflowType === 'employee-assessment';
    const rows = await module.exports.createJobCreatedNotification('actor', { _id: 'record', workflowType, title: 'Original Job Title', department: 'Team' });
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.actionUrl, assessment ? '/employee-assessments/record' : '/jobs/record');
      assert.equal(row.actionText, assessment ? 'View Assessment' : 'View Job');
      assert.ok(row.title.endsWith('Original Job Title'));
      assert.ok(row.message.includes(assessment ? 'new employee assessment' : 'new job posting'));
      assert.equal(row.data.organizationId, 'tenant-a');
    }
  }
});
