import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const docsRoot = path.join(root, 'docs', 'journey-management');
const indexPath = path.join(docsRoot, 'index.md');
const problems = [];

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.')) return [];
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(target) : [target];
  });
}

if (!fs.existsSync(indexPath)) problems.push('docs/journey-management/index.md is missing.');
const files = filesUnder(docsRoot);
const indexed = new Set();

for (const file of files) {
  if (path.extname(file) === '.json') {
    try { JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
      problems.push(`${path.relative(root, file)} is not valid JSON: ${error.message}`);
    }
  }
  if (path.extname(file) !== '.md') continue;
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
    const href = match[1].trim();
    if (!href || /^(?:https?:|mailto:|#)/u.test(href)) continue;
    const withoutAnchor = decodeURIComponent(href.split('#', 1)[0]);
    if (!withoutAnchor) continue;
    const resolved = path.resolve(path.dirname(file), withoutAnchor);
    if (!fs.existsSync(resolved)) {
      problems.push(`${path.relative(root, file)} references missing local document ${JSON.stringify(href)}.`);
    }
    if (file === indexPath && resolved !== indexPath) indexed.add(path.normalize(resolved));
  }
}

for (const file of files) {
  if (file === indexPath) continue;
  if (!indexed.has(path.normalize(file))) {
    problems.push(`index.md does not list ${path.relative(docsRoot, file).replaceAll('\\', '/')}.`);
  }
}

if (fs.existsSync(indexPath)) {
  const index = fs.readFileSync(indexPath, 'utf8');
  for (const [lineIndex, line] of index.split(/\r?\n/u).entries()) {
    const match = /^- \*\*\[[^\]]+\]\([^)]+\)\*\* - (.+)$/u.exec(line);
    if (!match) continue;
    const words = match[1].trim().split(/\s+/u).length;
    if (words < 3 || words > 10) {
      problems.push(`index.md line ${lineIndex + 1} description must contain 3-10 words; found ${words}.`);
    }
  }
}

if (problems.length) {
  console.error(`Journey documentation validation failed:\n- ${problems.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ valid: true, indexedDocuments: indexed.size,
    markdownDocuments: files.filter((file) => path.extname(file) === '.md').length,
    jsonDocuments: files.filter((file) => path.extname(file) === '.json').length }));
}
