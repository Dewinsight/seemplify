const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../lib/jobWorkspace.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const loaded = { exports: {} };
new Function('exports', 'module', compiled.outputText)(loaded.exports, loaded);
const { getJobWorkspace, jobRecordPath } = loaded.exports;

test('assessment pages retain their own names and all job subroutes', () => {
  const workspace = getJobWorkspace('/employee-assessments/record/edit');
  assert.equal(workspace.workflowType, 'employee-assessment');
  for (const suffix of ['', '/new', '/bulk-upload', '/record', '/record/edit', '/record/feedback', '/record/schedule-multi']) {
    assert.equal(workspace.path('/jobs' + suffix), '/employee-assessments' + suffix);
  }
  assert.equal(workspace.copy('Job Management'), 'Employee Assessments');
  assert.equal(workspace.copy('Job Details'), 'Assessment Details');
  assert.equal(workspace.copy('Candidates'), 'Employees');
  assert.equal(workspace.copy('Create Job Posting'), 'Create Assessment');
  assert.equal(workspace.path('/api/jobs/record'), '/api/jobs/record');
  assert.equal(workspace.path('/jobs-archive'), '/jobs-archive');
});

test('existing recruitment language and links remain unchanged', () => {
  const workspace = getJobWorkspace('/jobs/record');
  assert.equal(workspace.copy('Job Management'), 'Job Management');
  assert.equal(workspace.copy('Candidates'), 'Candidates');
  assert.equal(workspace.path('/jobs/new'), '/jobs/new');
  assert.equal(jobRecordPath({ _id: 'a' }), '/jobs/a');
  assert.equal(jobRecordPath({ _id: 'b', workflowType: 'employee-assessment' }, '/edit'), '/employee-assessments/b/edit');
});

test('assessment routes share the real job implementations rather than copies', () => {
  for (const file of ['page', 'loading', 'new/page', 'bulk-upload/page', '[jobId]/page', '[jobId]/edit/page', '[jobId]/feedback/page', '[jobId]/schedule-multi/page']) {
    const alias = fs.readFileSync(path.join(__dirname, '../app/employee-assessments', file + '.tsx'), 'utf8');
    assert.match(alias, /export \{ default \} from/);
    assert.ok(alias.includes('@/app/jobs/' + file));
  }
});
