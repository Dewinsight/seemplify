'use strict';

const { buildPreviewMatrix } = require('../../scripts/runTaxPreviewMatrix');
const { renderReport } = require('../../scripts/renderTaxCertificationReport');

describe('tax preview synthetic staff matrix', () => {
  test('exercises four deterministic staff scenarios for every seeded pack and preserves template blocks', async () => {
    const report = await buildPreviewMatrix({ generatedAt: new Date('2026-08-09T00:00:00.000Z') });

    expect(report.certificationEvidence).toBe(true);
    expect(report.packs).toBeGreaterThanOrEqual(10);
    expect(report.scenarios).toBe(report.packs * 4);
    expect(report.results.every((entry) => entry.staffReference.includes('-SYNTHETIC-'))).toBe(true);
    expect(report.results.filter((entry) => ['CA', 'EU', 'OTHER'].includes(entry.countryCode))
      .every((entry) => entry.payrollRunnable === false && entry.blockingErrors.length > 0)).toBe(true);
    expect(report.results.filter((entry) => !['CA', 'EU', 'OTHER'].includes(entry.countryCode))
      .every((entry) => entry.payrollRunnable === true && entry.blockingErrors.length === 0)).toBe(true);
    expect(report.adapterCandidateCount).toBeGreaterThanOrEqual(3);
    expect(report.adapterCandidates.every((entry) => entry.releaseStatus === 'certification_candidate')).toBe(true);
    expect(report.independentAiReviews).toHaveLength(2);
    expect(report.independentAiReviews.every((review) => (
      review.generatedByAI === true
      && review.engineeringDecision === 'approved_for_quarantined_preview'
      && review.productionApproval === false
      && review.legalStanding === 'not_a_licensed_tax_professional_opinion'
      && /^[a-f0-9]{64}$/.test(review.reviewedContentHashSha256)
    ))).toBe(true);

    const fixtureSetByCountry = report.results.reduce((map, entry) => {
      if (!map.has(entry.countryCode)) map.set(entry.countryCode, new Set());
      map.get(entry.countryCode).add(entry.fixture);
      return map;
    }, new Map());
    for (const fixtureSet of fixtureSetByCountry.values()) {
      expect([...fixtureSet].sort()).toEqual([
        'high_income',
        'ordinary_period',
        'year_to_date',
        'zero_income',
      ]);
    }
  });

  test('records component-level employee and employer liabilities for packs that calculate them', async () => {
    const report = await buildPreviewMatrix({ generatedAt: new Date('2026-08-09T00:00:00.000Z') });
    const kenya = report.results.find((entry) => (
      entry.countryCode === 'KE' && entry.fixture === 'ordinary_period'
    ));

    expect(kenya).toBeDefined();
    expect(Object.keys(kenya.employeeLiabilities)).toEqual(expect.arrayContaining([
      'KE_AHL_EMPLOYEE',
      'KE_SHIF_EMPLOYEE',
      'KE_NSSF_TIER1_EMPLOYEE',
      'KE_NSSF_TIER2_EMPLOYEE',
    ]));
    expect(Object.keys(kenya.employerLiabilities)).toEqual(expect.arrayContaining([
      'KE_AHL_EMPLOYER',
      'KE_NSSF_TIER1_EMPLOYER',
      'KE_NSSF_TIER2_EMPLOYER',
    ]));
  });

  test('renders a source-linked audit report without presenting preview rows as certified', async () => {
    const report = await buildPreviewMatrix({ generatedAt: new Date('2026-08-09T00:00:00.000Z') });
    const html = renderReport(report);

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('8 packs released');
    expect(html).toContain('release fixture');
    expect(html).toContain('HMRC 2026/27 developer test data');
    expect(html).toContain('IRS Publication 15-T (2026)');
    expect(html).toContain('CRA T4127 January 2026');
    expect(html).toContain('Quarantined statutory adapters');
    expect(html).toContain('GB_PAYE_2026_WAVE_1');
    expect(html).toContain('KE_2026_MONTHLY_STANDALONE');
    expect(html).toContain('US_FEDERAL_2026_WAVE1');
    expect(html).toContain('posting disabled');
    expect(html).toContain('Independent automated reviews');
    expect(html).toContain('preview approved');
    expect(html).toContain('not a licensed tax-professional opinion');
    expect(html).toContain('>runnable</span>');
  });
});
