'use strict';

const {
  EU_MEMBER_STATES,
  AFRICA_FUTURE_DYNAMIC_PACKS,
  OTHER_AMERICAS_SOVEREIGN_STATES,
  CANADA_PROVINCES_AND_TERRITORIES,
  US_STATES_AND_DC,
  getDynamicPackBacklogEntry,
  getRolloutInventory,
} = require('../tax/TaxJurisdictionRolloutInventory');

describe('TaxJurisdictionRolloutInventory', () => {
  test('expands broad UI labels into explicit national and subnational jurisdictions', () => {
    expect(EU_MEMBER_STATES).toHaveLength(27);
    expect(OTHER_AMERICAS_SOVEREIGN_STATES).toHaveLength(33);
    expect(CANADA_PROVINCES_AND_TERRITORIES).toHaveLength(13);
    expect(US_STATES_AND_DC).toHaveLength(51);
    expect(AFRICA_FUTURE_DYNAMIC_PACKS).toHaveLength(2);
  });

  test('contains unique codes and never asserts runnable coverage', () => {
    const all = getRolloutInventory().flatMap((group) => group.entries);
    expect(new Set(all.map((item) => item.code)).size).toBe(all.length);
    expect(all.some((item) => item.payrollRunnable)).toBe(false);
  });

  test('records Ontario as a quarantined candidate without treating Canada as complete', () => {
    const canada = getRolloutInventory().find((group) => group.id === 'CANADA_PROVINCES_AND_TERRITORIES');
    expect(canada.candidateCount).toBe(1);
    expect(canada.runnableCount).toBe(0);
    expect(canada.entries.find((item) => item.code === 'CA-ON')).toMatchObject({
      implementationStatus: 'certification_candidate',
      payrollRunnable: false,
    });
  });

  test('pins a primary public inventory source and discloses additional liability scope', () => {
    for (const group of getRolloutInventory()) {
      expect(group.source).toMatch(/^https:\/\//);
      expect(group.additionalScope.length).toBeGreaterThan(30);
      expect(group.requiredModules.length).toBeGreaterThanOrEqual(6);
      expect(group.dynamicCreationTemplate).toMatchObject({
        creationMode: 'admin_create_or_clone',
        initialVersionStatus: 'draft',
        initialValidationStatus: 'draft',
        initialCalculationStatus: 'blocked',
        payrollRunnable: false,
      });
    }
  });

  test('documents the governed dynamic-pack requirements for any backlog jurisdiction', () => {
    expect(getDynamicPackBacklogEntry('de')).toMatchObject({
      code: 'DE',
      groupId: 'EU_MEMBER_STATES',
      implementationStatus: 'dynamic_pack_backlog',
      payrollRunnable: false,
    });
    expect(getDynamicPackBacklogEntry('US-CA').requiredModules).toContain('state unemployment insurance');
    expect(getDynamicPackBacklogEntry('CA-QC').requiredModules).toContain('CPP/CPP2 and EI or Quebec QPP/QPIP/Quebec EI treatment');
    expect(getDynamicPackBacklogEntry('CM')).toMatchObject({
      groupId: 'AFRICA_FUTURE_DYNAMIC_PACKS',
      implementationStatus: 'dynamic_pack_backlog',
    });
    expect(getDynamicPackBacklogEntry('ZZ')).toBeNull();
  });
});
