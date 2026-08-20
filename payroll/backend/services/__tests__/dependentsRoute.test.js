jest.mock('../../middleware/rbac', () => ({ requireAuth: (_req, _res, next) => next() }));
jest.mock('../../models/PayrollProfile', () => ({ findOne: jest.fn() }));

const PayrollProfile = require('../../models/PayrollProfile');
const router = require('../../routes/dependents');

function handler(path, method) {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
}
function request(body = {}, params = {}) {
  return { body, params, currentOrganization: { id: 'org-1' }, session: { user: { id: 'employee-1' } } };
}
function profile() {
  const dependents = [];
  dependents.id = (id) => dependents.find((item) => item._id === id);
  return { dependents, taxConfig: {}, dependentsDeclaration: {}, save: jest.fn() };
}

describe('Payroll dependents routes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('adding a dependent updates the authoritative tax count', async () => {
    const record = profile();
    record.dependents.push = function push(value) { return Array.prototype.push.call(this, { _id: 'dep-1', ...value }); };
    PayrollProfile.findOne.mockResolvedValue(record);
    const res = response();
    await handler('/', 'post')(request({ name: 'Jamie Stone', relationship: 'child', dateOfBirth: '2018-03-12', taxDependent: true }), res);
    expect(res.statusCode).toBe(201);
    expect(record.taxConfig.dependents).toBe(1);
    expect(record.dependentsDeclaration.status).toBe('provided');
    expect(record.save).toHaveBeenCalled();
  });

  test('no-dependents declaration sets the tax count to zero', async () => {
    const record = profile();
    record.taxConfig.dependents = 3;
    PayrollProfile.findOne.mockResolvedValue(record);
    const res = response();
    await handler('/declare-none', 'post')(request(), res);
    expect(res.statusCode).toBe(200);
    expect(record.taxConfig.dependents).toBe(0);
    expect(record.dependentsDeclaration.status).toBe('none');
  });
});
