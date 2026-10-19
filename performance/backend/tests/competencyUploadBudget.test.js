'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createUploadBudget } = require('../services/competency/uploadBudget');
const files = require('../services/competency/fileSafetyService');
function appWith(budget, handler) {
  const app = express(); app.use((req, _res, next) => { req.competencyContext = { organizationId: 'synthetic-org', actor: { userId: 'synthetic-admin' }, permissions: new Set(['competency.role.manage']) }; next(); });
  app.use(budget); app.post('/imports', handler); app.get('/manual', (_req,res) => res.json({ available: true })); return app;
}
test('actual HTTP upload rate limit is per actor and manual paths stay available', async () => {
  const app = appWith(createUploadBudget({ max: 2 }), (_req,res) => res.status(201).json({ accepted: true }));
  for (let i=0;i<2;i++) await request(app).post('/imports').field('purpose','role').expect(201);
  const denied = await request(app).post('/imports').field('purpose','role').expect(429); assert.equal(denied.body.error.code, 'UPLOAD_RATE_LIMIT');
  await request(app).get('/manual').expect(200);
});
test('upload concurrency is bounded before parsing and capacity is released on response', async () => {
  let release, entered = false; const wait = new Promise(resolve => { release=resolve; });
  const app = appWith(createUploadBudget({ maxConcurrent: 1 }), async (_req,res) => { entered=true; await wait; res.sendStatus(201); });
  const first = request(app).post('/imports').field('purpose','role').then(value => value);
  for(let i=0;i<100&&!entered;i++) await new Promise(resolve => setTimeout(resolve,5));
  assert.equal(entered,true);
  const denied = await request(app).post('/imports').field('purpose','role').expect(429); assert.equal(denied.body.error.code,'UPLOAD_BUSY');
  release(); assert.equal((await first).status,201);
  await request(app).post('/imports').field('purpose','role').expect(201);
});
test('scanner concurrency rejects extra work and permits the next scan after completion', async () => {
  let release; const wait = new Promise(resolve => { release=resolve; });
  const input = { buffer: Buffer.from('Synthetic role description.'), originalName: 'role.txt', mimeType: 'text/plain' };
  const adapter = { scan: async () => { await wait; return { provider: 'explicit concurrency test adapter' }; } };
  const first = files.inspectAndScan(input,adapter); const second = files.inspectAndScan(input,adapter);
  await assert.rejects(files.inspectAndScan(input,adapter), error => error.code === 'SCAN_BUSY' && error.status === 429);
  release(); await Promise.all([first,second]); assert.equal((await files.inspectAndScan(input,adapter)).status,'clean');
});

test('document parser workers have a process-wide concurrency cap and release failed work', async () => {
  const invalidPDF = Buffer.from('%PDF-1.4\nSynthetic unreadable fixture');
  const first = files.extractText(invalidPDF, 'pdf'); const second = files.extractText(invalidPDF, 'pdf');
  await assert.rejects(files.extractText(invalidPDF, 'pdf'), error => error.code === 'PARSER_BUSY' && error.status === 429);
  const settled = await Promise.allSettled([first,second]); assert.equal(settled.every(value => value.status === 'rejected'),true);
  await assert.rejects(files.extractText(invalidPDF, 'pdf'), error => error.code === 'UNREADABLE_FILE');
  assert.equal((await files.extractText(Buffer.from('Manual fallback'), 'txt')).text, 'Manual fallback');
});
