const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const PDFDocument = require('pdfkit');
const CVParsingService = require('../services/cvParsingService');
const { CV_EXTRACTION_SCHEMA } = require('../services/aiModelService');
const { signLocalRequest } = require('../services/aiRuntime/aiRuntimeService');
const { cvText: threePageCvText } = require('../../../tools/local-llm/three-page-cv-fixture.cjs');

const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
const runtimeDir = path.join(repositoryRoot, '.local-runtime', 'llm');
const fixtureDir = path.join(runtimeDir, 'fixtures');
const reportDir = path.join(runtimeDir, 'reports');
const secretFile = path.join(runtimeDir, 'service-secret');
const gatewayUrl = String(process.env.LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11435').replace(/\/+$/, '');
const repeatCount = Math.max(1, Number(process.argv.find((item) => item.startsWith('--repeat='))?.split('=')[1] || 2));

const fixtures = [
  {
    id: 'principal-engineer-three-page-a4-pdf',
    format: 'pdf',
    pages: threePageCvText.split(/\s*\f\s*/),
    expected: {
      firstName: 'Ada',
      lastName: 'Okafor',
      email: 'ada.okafor@example.test',
      phone: '7700 900123',
      location: 'London',
      position: 'Principal Software Engineer',
      experience: ['Northstar Systems', 'Harbor Labs', 'Meridian Health Technology', 'Elm Research'],
      education: ['Imperial College London', 'University of Bristol'],
      skills: ['TypeScript', 'Node.js', 'PostgreSQL', 'Kubernetes', 'Terraform', 'OpenTelemetry'],
      certifications: ['AWS Certified Solutions Architect', 'Certified Kubernetes Administrator'],
      projects: ['CV Processing Reliability Programme', 'Atlas Observability Platform'],
      languages: ['English', 'Igbo']
    },
    forbidden: ['Google', 'Microsoft', 'PhD', 'Cambridge'],
    text: threePageCvText
  },
  {
    id: 'software-engineer-pdf',
    format: 'pdf',
    expected: {
      firstName: 'Ada',
      lastName: 'Okafor',
      email: 'ada.okafor@example.test',
      phone: '+44 7700 900123',
      location: 'London',
      position: 'Senior Software Engineer',
      experience: 'eight years',
      education: ['BSc Computer Science', 'University of Bristol', '2017'],
      skills: ['TypeScript', 'Node.js', 'PostgreSQL']
    },
    forbidden: ['Google', 'Microsoft', 'PhD'],
    text: `ADA OKAFOR
Senior Software Engineer
London, United Kingdom | ada.okafor@example.test | +44 7700 900123

SUMMARY
Software engineer with eight years of experience building reliable recruitment and payments platforms.

SKILLS
TypeScript, Node.js, PostgreSQL, Redis, React, AWS

EXPERIENCE
Senior Software Engineer, Northstar Systems, January 2021 to Present
- Led a five-person team and reduced API latency by 38 percent.
- Built BullMQ processing workflows with idempotent retries.

Software Engineer, Harbor Labs, June 2017 to December 2020
- Developed Node.js services and React interfaces.

EDUCATION
BSc Computer Science, University of Bristol, 2017

LANGUAGES
English (fluent), Igbo (native)`
  },
  {
    id: 'data-analyst-docx',
    format: 'docx',
    expected: {
      firstName: 'Maya',
      lastName: 'Singh',
      email: 'maya.singh@example.test',
      location: 'Manchester',
      position: 'Data Analyst',
      experience: 'four years',
      education: ['BSc Statistics', 'University of Leeds', '2020'],
      skills: ['Python', 'SQL', 'Power BI']
    },
    forbidden: ['London', 'Java', 'MBA'],
    text: `MAYA SINGH
Data Analyst
Manchester | maya.singh@example.test

PROFILE
Data analyst with four years of experience producing commercial reporting.

SKILLS
Python, SQL, Power BI, Excel

EXPERIENCE
Data Analyst, Meridian Retail, March 2022 to Present
- Automated weekly reporting and saved twelve hours per month.

Junior Analyst, Elm Research, August 2020 to February 2022
- Cleaned survey data and maintained SQL dashboards.

EDUCATION
BSc Statistics, University of Leeds, 2020`
  },
  {
    id: 'blank-scanned-image',
    format: 'png',
    expectedRejection: true,
    text: ''
  }
];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(value);
    const checksum = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 8);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuffer.length, 26);
    local.push(header, nameBuffer, data);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(nameBuffer.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, nameBuffer);
    offset += header.length + nameBuffer.length + data.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, end]);
}

function xmlEscape(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function createFixtures() {
  fs.mkdirSync(fixtureDir, { recursive: true });
  for (const fixture of fixtures) {
    fixture.file = path.join(fixtureDir, `${fixture.id}.${fixture.format}`);
    if (fixture.format === 'pdf') {
      await new Promise((resolve, reject) => {
        const document = new PDFDocument({
          size: 'A4',
          margin: 45,
          autoFirstPage: !fixture.pages
        });
        const output = fs.createWriteStream(fixture.file);
        output.on('finish', resolve);
        output.on('error', reject);
        document.pipe(output);
        if (fixture.pages) {
          for (const page of fixture.pages) {
            document.addPage({ size: 'A4', margin: 45 });
            document.font('Helvetica').fontSize(9).text(page, { lineGap: 2 });
          }
        } else {
          document.font('Helvetica').fontSize(11).text(fixture.text, { lineGap: 4 });
        }
        document.end();
      });
    } else if (fixture.format === 'docx') {
      const paragraphs = fixture.text.split('\n').map((line) => (
        `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`
      )).join('');
      fs.writeFileSync(fixture.file, makeZip([
        ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
        ['_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
        ['word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`]
      ]));
    } else {
      fs.writeFileSync(fixture.file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
    }
  }
}

function schemaErrors(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['root must be an object'];
  for (const key of CV_EXTRACTION_SCHEMA.required) {
    if (!(key in value)) errors.push(`missing ${key}`);
  }
  for (const [key, definition] of Object.entries(CV_EXTRACTION_SCHEMA.properties)) {
    if (!(key in value)) continue;
    if (definition.type === 'array' && !Array.isArray(value[key])) errors.push(`${key} must be an array`);
    if (definition.type === 'object' && (!value[key] || typeof value[key] !== 'object' || Array.isArray(value[key]))) errors.push(`${key} must be an object`);
    if (definition.type === 'string' && typeof value[key] !== 'string') errors.push(`${key} must be a string`);
  }
  return errors;
}

function promptFor(text) {
  return [
    {
      role: 'system',
      content: [
        'Extract every fact explicitly present in this CV and return data matching the supplied JSON schema.',
        'Include ALL work roles, education entries, certifications, projects, publications, awards, languages,',
        'volunteering, memberships, links, and nonstandard sections. Never infer or invent a fact.'
      ].join(' ')
    },
    { role: 'user', content: `CV text:\n\n${text}` }
  ];
}

async function callLocal(text) {
  const secret = fs.readFileSync(secretFile, 'utf8').trim();
  const body = JSON.stringify({
    activity: 'candidate.cv_parse',
    model: 'selected-runtime-model',
    messages: promptFor(text),
    jsonSchema: CV_EXTRACTION_SCHEMA,
    temperature: 0,
    maxTokens: 8000,
    timeoutMs: 300_000
  });
  const signed = signLocalRequest(secret, body);
  const startedAt = Date.now();
  const response = await fetch(`${gatewayUrl}/v1/cv/analyze`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-seemplify-timestamp': signed.timestamp,
      'x-seemplify-nonce': signed.nonce,
      'x-seemplify-signature': signed.signature
    },
    body,
    signal: AbortSignal.timeout(330_000)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${payload.code || response.status}: ${payload.message || 'local request failed'}`);
  return {
    provider: `local-${payload.engine || 'unknown'}`,
    engine: payload.engine,
    model: payload.model,
    data: payload.data,
    latencyMs: Date.now() - startedAt,
    usage: payload.usage
  };
}

async function callGroq(text) {
  const apiKey = String(process.env.GROQ_API_KEY || '').trim();
  if (!apiKey) return null;
  const startedAt = Date.now();
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      messages: promptFor(text),
      temperature: 0,
      response_format: { type: 'json_object' }
    }),
    signal: AbortSignal.timeout(180_000)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || 'Groq comparison failed');
  return {
    provider: 'groq',
    data: JSON.parse(payload.choices[0].message.content),
    latencyMs: Date.now() - startedAt,
    usage: payload.usage
  };
}

function score(fixture, result) {
  const serialized = JSON.stringify(result.data).toLowerCase();
  const checks = [];
  const relatedFields = {
    experience: ['experience', 'summary', 'workExperience'],
    education: ['education', 'educationHistory'],
    certifications: ['certifications'],
    projects: ['projects'],
    languages: ['languages']
  };
  for (const [key, expected] of Object.entries(fixture.expected || {})) {
    const values = Array.isArray(expected) ? expected : [expected];
    const fields = relatedFields[key] || [key];
    const fieldValue = fields
      .map((field) => JSON.stringify(result.data?.[field] ?? ''))
      .join(' ')
      .toLowerCase();
    for (const value of values) {
      const expectedValue = String(value).toLowerCase();
      const numericEquivalent = {
        one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
        seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12'
      }[expectedValue.split(/\s+/)[0]];
      checks.push({
        field: key,
        expected: value,
        found: fieldValue.includes(expectedValue)
          || Boolean(numericEquivalent && fieldValue.includes(
            expectedValue.replace(/^\w+/, numericEquivalent)
          ))
      });
    }
  }
  const hallucinations = (fixture.forbidden || []).filter((value) => serialized.includes(String(value).toLowerCase()));
  const errors = schemaErrors(result.data);
  const accuracy = checks.length ? checks.filter((check) => check.found).length / checks.length : 1;
  return {
    accuracy,
    checks,
    hallucinations,
    schemaErrors: errors,
    passed: accuracy >= 0.95 && hallucinations.length === 0 && errors.length === 0
  };
}

async function main() {
  if (!fs.existsSync(secretFile)) throw new Error('Start the local gateway before running the harness.');
  fs.mkdirSync(reportDir, { recursive: true });
  await createFixtures();
  const parser = new CVParsingService();
  const runtimeStatus = await (await fetch(`${gatewayUrl}/control/status`)).json();
  const report = {
    generatedAt: new Date().toISOString(),
    engine: runtimeStatus.engine,
    model: runtimeStatus.model,
    repeatCount,
    fixtures: [],
    comparison: { groq: Boolean(process.env.GROQ_API_KEY) }
  };

  for (const fixture of fixtures) {
    const mime = fixture.format === 'pdf'
      ? 'application/pdf'
      : fixture.format === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'image/png';
    const extractedText = await parser.parseCV(fixture.file, mime);
    if (fixture.expectedRejection) {
      report.fixtures.push({ id: fixture.id, format: fixture.format, expectedRejection: true, extractedCharacters: extractedText.trim().length, passed: extractedText.trim().length < 50 });
      continue;
    }
    const localRuns = [];
    for (let index = 0; index < repeatCount; index += 1) {
      const result = await callLocal(extractedText);
      localRuns.push({ ...result, score: score(fixture, result) });
    }
    const groq = await callGroq(extractedText);
    report.fixtures.push({
      id: fixture.id,
      format: fixture.format,
      pages: fixture.pages?.length || null,
      extractedCharacters: extractedText.length,
      localRuns,
      groq: groq ? { ...groq, score: score(fixture, groq) } : { skipped: true, reason: 'GROQ_API_KEY is not available to this process' },
      repeatable: localRuns.every((run) => run.score.passed),
      exactOutputRepeat: new Set(localRuns.map((run) => JSON.stringify(run.data))).size === 1,
      passed: localRuns.every((run) => run.score.passed)
    });
  }

  report.passed = report.fixtures.every((fixture) => fixture.passed);
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const modelSlug = `${report.engine}-${report.model}`.replace(/[^a-z0-9_-]+/gi, '-');
  const jsonFile = path.join(reportDir, `local-cv-quality-${modelSlug}-${stamp}.json`);
  const markdownFile = path.join(reportDir, `local-cv-quality-${modelSlug}-${stamp}.md`);
  fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2));
  const lines = [
    '# Local CV quality report',
    '',
    `- Engine: ${report.engine}`,
    `- Model: ${report.model}`,
    `- Result: ${report.passed ? 'PASS' : 'FAIL'}`,
    `- Repetitions: ${repeatCount}`,
    '',
    '| Fixture | Format | Local accuracy | Schema | Hallucinations | Repeatable |',
    '| --- | --- | ---: | --- | --- | --- |',
    ...report.fixtures.map((fixture) => {
      const run = fixture.localRuns?.[0];
      return `| ${fixture.id} | ${fixture.format} | ${run ? `${(run.score.accuracy * 100).toFixed(0)}%` : 'rejection check'} | ${run?.score.schemaErrors.length ? 'FAIL' : 'PASS'} | ${run?.score.hallucinations.length || 0} | ${fixture.repeatable == null ? 'n/a' : fixture.repeatable ? 'yes' : 'no'} |`;
    })
  ];
  fs.writeFileSync(markdownFile, `${lines.join('\n')}\n`);
  process.stdout.write(`${JSON.stringify({ passed: report.passed, jsonFile, markdownFile })}\n`);
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
