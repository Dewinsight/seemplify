import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const ledgerPath = path.join(root, 'docs', 'CONNECTED-JOURNEY-MANAGEMENT-TRACEABILITY.md');
const evidencePath = path.join(root, 'docs', 'journey-management', 'completion-evidence.json');
const source = fs.readFileSync(ledgerPath, 'utf8');
const allowedStates = new Set(['Not started', 'Foundation', 'In progress', 'Implemented', 'Verified']);
const expectedGroups = new Map([
  ['P0', 8], ['P1', 15], ['P2', 11], ['P3', 11], ['P4', 8],
  ['P5A', 8], ['P5B', 4], ['P5C', 3], ['P5D', 4], ['P5E', 3], ['X', 10]
]);
const expectedIds = [...expectedGroups].flatMap(([group, count]) => Array.from(
  { length: count }, (_, index) => `${group}-${String(index + 1).padStart(2, '0')}`
));

const rows = source.split(/\r?\n/u).flatMap((line, lineIndex) => {
  if (!/^\| (?:P[0-9][A-Z]?|X)-[0-9]{2} \|/u.test(line)) return [];
  const columns = line.split('|').slice(1, -1).map((value) => value.trim());
  return [{ line: lineIndex + 1, id: columns[0], requirement: columns[1], state: columns[2], evidence: columns[3] }];
});
const problems = [];
const seen = new Map();
for (const row of rows) {
  if (seen.has(row.id)) problems.push(`${row.id} is duplicated on lines ${seen.get(row.id)} and ${row.line}.`);
  else seen.set(row.id, row.line);
  if (!row.requirement) problems.push(`${row.id} has no requirement text.`);
  if (!allowedStates.has(row.state)) problems.push(`${row.id} has unsupported state ${JSON.stringify(row.state)}.`);
  if (!row.evidence) problems.push(`${row.id} has no evidence/gap statement.`);
}
for (const id of expectedIds) if (!seen.has(id)) problems.push(`${id} is missing.`);
for (const id of seen.keys()) if (!expectedIds.includes(id)) problems.push(`${id} is not part of the approved 85-item ledger.`);
if (rows.length !== expectedIds.length) problems.push(`Expected ${expectedIds.length} rows; found ${rows.length}.`);

if (problems.length) {
  console.error(`Journey traceability validation failed:\n- ${problems.join('\n- ')}`);
  process.exitCode = 1;
} else {
  const evidenceProblems = [];
  const evidenceSource = fs.readFileSync(evidencePath, 'utf8');
  const evidence = JSON.parse(evidenceSource);
  const allowedClasses = new Set(['Code', 'Data', 'Controls', 'Tests', 'Runtime', 'Operations']);
  const seenEvidenceIds = new Set();
  if (!Array.isArray(evidence?.records)) {
    evidenceProblems.push('completion-evidence.json must contain a records array.');
  } else {
    for (const [index, record] of evidence.records.entries()) {
      const prefix = `evidence record ${index + 1}`;
      if (!record || typeof record !== 'object') {
        evidenceProblems.push(`${prefix} must be an object.`);
        continue;
      }
      if (!record.evidenceId || typeof record.evidenceId !== 'string') {
        evidenceProblems.push(`${prefix} has no string evidenceId.`);
      } else if (seenEvidenceIds.has(record.evidenceId)) {
        evidenceProblems.push(`${prefix} duplicates evidenceId ${record.evidenceId}.`);
      } else {
        seenEvidenceIds.add(record.evidenceId);
      }
      if (!Array.isArray(record.requirementIds) || record.requirementIds.length === 0) {
        evidenceProblems.push(`${record.evidenceId || prefix} must name at least one requirementId.`);
      } else {
        for (const requirementId of record.requirementIds) {
          if (!expectedIds.includes(requirementId)) {
            evidenceProblems.push(`${record.evidenceId || prefix} references unknown requirementId ${JSON.stringify(requirementId)}.`);
          }
        }
      }
      if (!allowedClasses.has(record.class)) {
        evidenceProblems.push(`${record.evidenceId || prefix} has unsupported class ${JSON.stringify(record.class)}.`);
      }
      if (!record.summary || typeof record.summary !== 'string') {
        evidenceProblems.push(`${record.evidenceId || prefix} must have a summary.`);
      }
      if (!record.command && !record.artifactPath) {
        evidenceProblems.push(`${record.evidenceId || prefix} must have at least a command or artifactPath.`);
      }
      if (!record.observed || typeof record.observed !== 'object') {
        evidenceProblems.push(`${record.evidenceId || prefix} must have an observed object.`);
      }
      if (!Array.isArray(record.notClaimed) || record.notClaimed.length === 0) {
        evidenceProblems.push(`${record.evidenceId || prefix} must declare at least one notClaimed item.`);
      }
      if (!record.status || typeof record.status !== 'string') {
        evidenceProblems.push(`${record.evidenceId || prefix} must have a status.`);
      }
    }
  }
  if (evidenceProblems.length) {
    console.error(`Journey completion evidence validation failed:\n- ${evidenceProblems.join('\n- ')}`);
    process.exitCode = 1;
  }
}

if (process.exitCode !== 1) {
  const counts = Object.fromEntries([...allowedStates].map((state) => [
    state, rows.filter((row) => row.state === state).length
  ]));
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  console.log(JSON.stringify({
    valid: true,
    requirements: rows.length,
    uniqueIds: seen.size,
    states: counts,
    evidenceRecords: Array.isArray(evidence?.records) ? evidence.records.length : 0
  }));
}
