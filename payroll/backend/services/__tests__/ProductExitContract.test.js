const fs = require('fs');
const path = require('path');

const repositoryRoot = path.resolve(__dirname, '../../../..');
const contracts = [
  ['payroll/frontend/lib/productExit.ts', "api.post('/auth/logout')", "removeItem('accessToken')"],
  ['leave-management/frontend/lib/productExit.ts', "api.post('/auth/logout')", "removeItem('accessToken')"],
  ['time-attendance/frontend/lib/productExit.ts', "api.post('/auth/logout')", "removeItem('access_token')"],
  ['performance/frontend/lib/productExit.ts', "api.post('/auth/logout')", "removeItem('accessToken')"],
  ['recruiter/frontend/utils/productExit.ts', '/api/auth/logout', 'tokenManager.clearTokens()'],
];

describe('cross-product App Hub exit contract', () => {
  test.each(contracts)('%s revokes its product session before replacing browser history', (relativePath, logoutCall, browserCleanup) => {
    const source = fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
    expect(source).toContain(logoutCall);
    expect(source).toContain(browserCleanup);
    expect(source).toContain('sessionStorage.clear()');
    expect(source).toContain('window.location.replace(hubUrl)');
    expect(source.indexOf(logoutCall)).toBeLessThan(source.indexOf('window.location.replace(hubUrl)'));
  });

  test('Recruiter server logout revokes the current refresh session without logging out the IdP', () => {
    const source = fs.readFileSync(path.join(repositoryRoot, 'recruiter/backend/routes/auth.js'), 'utf8');
    expect(source).toContain("router.post('/logout'");
    expect(source).toContain("revokeSessionById(decoded.jti, 'product_exit_to_hub')");
    expect(source).not.toContain("router.post('/logout', oidc");
  });

  test.each([
    'payroll/backend/routes/auth.js',
    'leave-management/backend/routes/auth.js',
    'time-attendance/backend/routes/auth.js',
    'performance/backend/app.js',
    'recruiter/backend/routes/auth.js',
  ])('%s marks logout responses as non-cacheable', (relativePath) => {
    const source = fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
    expect(source).toContain("res.set('Cache-Control', 'no-store')");
  });
});
