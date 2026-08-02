import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (...segments) => fs.readFileSync(path.join(source, ...segments), 'utf8');

test('sidebar route changes retain the authenticated shell while lazy pages load', () => {
  const app = read('App.tsx');
  const router = read('lib', 'router.tsx');

  const linkNavigationIsTransitioned =
    /import\s*\{[^}]*\bstartTransition\b[^}]*\}\s*from\s*['"]react['"]/.test(router)
    && /startTransition\s*\(\s*\(\s*\)\s*=>\s*navigate\(to\)/.test(router);
  const shellOwnsThePageSuspense =
    /<AppShell>\s*<Suspense\b[\s\S]*?<Switch>/.test(app)
    && /<PlatformAdminShell>\s*<Suspense\b[\s\S]*?<Switch>/.test(app)
    && !/return\s*<Suspense\s+fallback=\{<PageLoader\s*\/>\}\s*>\s*<Switch>/.test(app);

  assert.ok(
    linkNavigationIsTransitioned || shellOwnsThePageSuspense,
    'lazy sidebar navigation must either run as a React transition or render page suspense inside persistent app shells'
  );
  assert.match(router, /event\.preventDefault\(\);\s*(?:startTransition\s*\([^;]+)?navigate\(to\)/);
  assert.doesNotMatch(router, /window\.location\.(?:assign|replace|reload)/);
});

test('verified-account continuation uses the SPA router instead of a raw internal anchor', () => {
  const verification = read('pages', 'EmailVerificationPage.tsx');

  assert.match(verification, /<Link\s+to=\{destination\}>/);
  assert.doesNotMatch(verification, /<a\s+href=\{destination\}>/);
});
