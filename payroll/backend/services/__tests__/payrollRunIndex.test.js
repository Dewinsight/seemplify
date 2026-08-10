const PayrollRun = require('../../models/PayrollRun');

describe('PayrollRun active-period uniqueness', () => {
  test('indexes only fully assigned legal-employer periods', () => {
    const entry = PayrollRun.schema.indexes().find(([keys]) => (
      keys.organizationId === 1
      && keys.employerEntityId === 1
      && keys.activePeriodKey === 1
    ));

    expect(entry).toBeDefined();
    expect(entry[1]).toMatchObject({
      unique: true,
      partialFilterExpression: {
        employerEntityId: { $type: 'objectId' },
        activePeriodKey: { $type: 'string' },
      },
    });
    expect(entry[1].sparse).not.toBe(true);
  });
});
