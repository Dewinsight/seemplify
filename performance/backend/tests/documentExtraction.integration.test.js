'use strict';
// Actual parser and a wholly synthetic one-page ReportLab document. This is
// the byte-identical PDF that reproduced the production bad-XRef failure.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const service = require('../services/documentExtractionService');
const fixture = path.join(__dirname, 'fixtures/reportlab-synthetic-evidence.pdf');

afterEach(() => jest.restoreAllMocks());

test('extracts the real ReportLab checklist without changing its original PDF bytes', async () => {
  const before = await fs.promises.readFile(fixture);
  expect(createHash('sha256').update(before).digest('hex')).toBe('d5a2d01f289cf558087315d79a496548d7aa4f2c4b1ea483b530c236b2ca158b');
  const result = await service.extractText(fixture, 'pdf');
  expect(result.pageCount).toBe(1);
  expect(result.text).toContain('Synthetic appraisal evidence');
  expect(result.text).toContain('Record the fictional milestone.');
  expect(result.text).toContain('Document the agreed handover.');
  expect(result.wordCount).toBeGreaterThan(20);
  expect(await fs.promises.readFile(fixture)).toEqual(before);
});

test('a malformed PDF still fails instead of fabricating extracted evidence', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const read = jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('%PDF-1.4\nInvalid synthetic PDF without an xref table.'));
  await expect(service.extractText('synthetic-corrupt.pdf', 'pdf')).rejects.toThrow();
  expect(read).toHaveBeenCalledWith('synthetic-corrupt.pdf');
});
