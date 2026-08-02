const test = require('node:test');
const assert = require('node:assert/strict');
const candidateEmailRouter = require('../routes/candidateEmails');
const { requireOrganization } = require('../middleware/organizationMiddleware');

const protectedRoutes = [
  ['post', '/send-rejection'],
  ['post', '/send-bulk-rejection'],
  ['get', '/job/:jobId/email-settings'],
  ['put', '/job/:jobId/email-settings'],
  ['post', '/test-email'],
];

test('candidate email operations require the active organization context', () => {
  for (const [method, path] of protectedRoutes) {
    const routeLayer = candidateEmailRouter.stack.find(
      (layer) => layer.route?.path === path && layer.route.methods[method]
    );

    assert.ok(routeLayer, `${method.toUpperCase()} ${path} route is missing`);
    assert.ok(
      routeLayer.route.stack.some((layer) => layer.handle === requireOrganization),
      `${method.toUpperCase()} ${path} does not require organization context`
    );
  }
});

test('default template files remain available without organization context', () => {
  const templateRoute = candidateEmailRouter.stack.find(
    (layer) => layer.route?.path === '/templates/:templateName' && layer.route.methods.get
  );

  assert.ok(templateRoute);
  assert.equal(
    templateRoute.route.stack.some((layer) => layer.handle === requireOrganization),
    false
  );
});
