import fs from 'node:fs';
const targets = [
  'backend/test/journey-collaboration.test.ts',
  'backend/src/journeyCollaboration.ts',
  'backend/src/journeySavedViews.ts'
];
for (const p of targets) {
  const b = fs.readFileSync(p);
  let index = b.indexOf(0);
  if (index < 0) process.stdout.write(`${p} clean\n`);
  while (index >= 0) {
    const line = b.slice(0, index).toString('utf8').split('\n').length;
    process.stdout.write(`${p} offset=${index} line=${line} ${JSON.stringify(b.slice(index - 130, index + 130).toString('utf8'))}\n`);
    index = b.indexOf(0, index + 1);
  }
}
