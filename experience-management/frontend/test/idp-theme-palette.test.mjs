import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const styles = fs.readFileSync(path.join(frontend, 'src', 'styles.css'), 'utf8');
const tailwind = fs.readFileSync(path.join(frontend, 'tailwind.config.ts'), 'utf8');

const expectedTokens = [
  '--background: 45 22.2% 92.9%;', // Identity #f1efe9
  '--card: 36 100% 99%;', // Identity #fffdfa
  '--foreground: 40 6.4% 9.2%;', // Identity #191816
  '--primary: 255 80.4% 60%;', // Identity #7047eb
  '--background: 252 15.2% 6.5%;', // Identity #0f0e13
  '--card: 253.3 17% 10.4%;', // Identity #18161f
  '--foreground: 264 33.3% 97.1%;', // Identity #f7f5fa
  '--primary: 255.4 100% 69.4%;', // Identity #8b63ff
];

test('light and dark semantic themes use the canonical Identity palette', () => {
  for (const token of expectedTokens) assert.ok(styles.includes(token), `missing ${token}`);
  assert.match(styles, /:root\s*\{[\s\S]*?color-scheme:\s*light;/);
  assert.match(styles, /:root\[data-theme="dark"\]\s*\{[\s\S]*?color-scheme:\s*dark;/);
});

test('borders, inputs, selection, and panel shadows consume the shared theme tokens', () => {
  assert.match(tailwind, /border:\s*'hsl\(var\(--border\)\)'/);
  assert.match(tailwind, /input:\s*'hsl\(var\(--input\)\)'/);
  assert.match(tailwind, /panel:\s*'var\(--panel-shadow\)'/);
  assert.match(styles, /::selection\s*\{\s*background:\s*hsl\(var\(--primary\)\s*\/\s*0\.22\);\s*\}/);
});
