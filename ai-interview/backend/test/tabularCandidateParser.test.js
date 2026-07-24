const test = require('node:test');
const assert = require('node:assert/strict');
const { strToU8, zipSync } = require('fflate');
const { MAX_IMPORT_ROWS, normalizeHeader, readCandidateRows } = require('../src/tabularCandidateParser');

function syntheticXlsx() {
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
        <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
      </Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
      </Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets><sheet name="Candidates" sheetId="1" r:id="rId1"/></sheets>
      </workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
      </Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8"?>
      <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <numFmts count="0"/>
        <fonts count="1"><font/></fonts>
        <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
        <borders count="1"><border/></borders>
        <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
        <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
      </styleSheet>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="1">
            <c r="A1" t="inlineStr"><is><t>Full Name</t></is></c>
            <c r="B1" t="inlineStr"><is><t>Email Address</t></is></c>
            <c r="C1" t="inlineStr"><is><t>Current_Title</t></is></c>
          </row>
          <row r="2">
            <c r="A2" t="inlineStr"><is><t>Ada Lovelace</t></is></c>
            <c r="B2" t="inlineStr"><is><t>ada@example.com</t></is></c>
            <c r="C2" t="inlineStr"><is><t>Principal Engineer</t></is></c>
          </row>
        </sheetData>
      </worksheet>`
  };
  return Buffer.from(zipSync(Object.fromEntries(
    Object.entries(files).map(([name, content]) => [name, strToU8(content)])
  )));
}

test('tabular parser normalizes CSV headers and preserves quoted values', async () => {
  const rows = await readCandidateRows({
    originalname: 'candidates.csv',
    buffer: Buffer.from('Full Name,Email Address,Skills\n"Ada Lovelace",ada@example.com,"TypeScript, PostgreSQL"')
  });
  assert.deepEqual(rows, [{
    fullname: 'Ada Lovelace',
    emailaddress: 'ada@example.com',
    skills: 'TypeScript, PostgreSQL'
  }]);
  assert.equal(normalizeHeader(' Current_Title '), 'currenttitle');
});

test('tabular parser reads XLSX without the vulnerable SheetJS package', async () => {
  const rows = await readCandidateRows({
    originalname: 'candidates.xlsx',
    buffer: syntheticXlsx()
  });
  assert.deepEqual(rows, [{
    fullname: 'Ada Lovelace',
    emailaddress: 'ada@example.com',
    currenttitle: 'Principal Engineer'
  }]);
});

test('tabular parser bounds row counts before candidate mutation', async () => {
  const body = ['Name,Email'];
  for (let index = 0; index <= MAX_IMPORT_ROWS; index += 1) {
    body.push(`Candidate ${index},candidate${index}@example.com`);
  }
  await assert.rejects(
    () => readCandidateRows({
      originalname: 'too-many.csv',
      buffer: Buffer.from(body.join('\n'))
    }),
    /limited to 5,000 rows/
  );
});
