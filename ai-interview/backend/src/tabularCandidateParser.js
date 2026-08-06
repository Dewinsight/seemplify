const readXlsxFile = require('read-excel-file/node');
const { parse: parseCsv } = require('csv-parse/sync');

const MAX_IMPORT_ROWS = 5000;

function normalizeHeader(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

async function readCandidateRows(file) {
  if (!file?.buffer?.length) throw new Error('Upload a CSV or XLSX file.');
  const name = String(file.originalname || '').toLowerCase();
  let table;
  if (name.endsWith('.csv')) {
    table = parseCsv(file.buffer.toString('utf8'), {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      max_record_size: 100_000
    });
  } else {
    const workbook = await readXlsxFile(file.buffer);
    table = Array.isArray(workbook) && workbook[0]?.data ? workbook[0].data : workbook;
  }
  if (!Array.isArray(table) || table.length < 2) throw new Error('The uploaded file has no candidate rows.');
  if (table.length > MAX_IMPORT_ROWS + 1) {
    throw new Error(`Candidate imports are limited to ${MAX_IMPORT_ROWS.toLocaleString('en-US')} rows per file.`);
  }
  const headers = table[0].map(normalizeHeader);
  if (!headers.some(Boolean)) throw new Error('The uploaded file has no column headers.');
  return table
    .slice(1)
    .filter((row) => row.some((value) => String(value ?? '').trim()))
    .map((values) => Object.fromEntries(headers
      .map((header, index) => [header, values[index] ?? ''])
      .filter(([header]) => header)));
}

module.exports = {
  MAX_IMPORT_ROWS,
  normalizeHeader,
  readCandidateRows
};
