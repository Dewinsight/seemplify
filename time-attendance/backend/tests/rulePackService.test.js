const { assignmentSignature, deepMerge, selectEffectiveCandidate, validateRulePack } = require('../services/rulePackService');
const { AttendanceRulePack } = require('../models');
const { EU_COUNTRIES, definitions, seedDefaultRulePacks } = require('../services/rulePackSeedService');

describe('rule-pack governance', () => {
    test('seeds Nigeria, UK, EU baseline and all 27 national overlays as reviewable drafts', () => {
        const packs = definitions();
        expect(EU_COUNTRIES).toHaveLength(27);
        expect(packs).toHaveLength(31);
        expect(packs.map(pack => pack.key)).toEqual(expect.arrayContaining(['global-fallback', 'ng-default', 'gb-default', 'eu-baseline']));
        expect(packs.filter(pack => pack.parent?.key === 'eu-baseline')).toHaveLength(27);
        expect(packs.every(pack => pack.status === 'draft' && pack.reviewRequired === true)).toBe(true);
    });

    test('adds missing templates idempotently without overwriting existing packs', async () => {
        const update = jest.spyOn(AttendanceRulePack, 'updateOne').mockResolvedValue({ upsertedCount: 1 });
        await expect(seedDefaultRulePacks({ actorId: 'admin-1' })).resolves.toEqual({ total: 31, inserted: 31, existing: 0 });
        expect(update).toHaveBeenCalledTimes(31);
        expect(update.mock.calls[0][1]).toHaveProperty('$setOnInsert');

        update.mockClear();
        update.mockResolvedValue({ upsertedCount: 0 });
        await expect(seedDefaultRulePacks({ actorId: 'admin-1' })).resolves.toEqual({ total: 31, inserted: 0, existing: 31 });
        expect(update).toHaveBeenCalledTimes(31);
        update.mockRestore();
    });

    test('rejects incomplete jurisdiction data and unsafe raw-presence retention', () => {
        const result = validateRulePack({
            key: 'invalid-country', name: 'Invalid', effectiveFrom: new Date(),
            jurisdiction: { kind: 'country' },
            rules: { retention: { presenceEventDays: 91 } },
            sources: [{ title: 'Policy' }],
        });
        expect(result.valid).toBe(false);
        expect(result.errors.map(error => error.path)).toEqual(expect.arrayContaining([
            'jurisdiction.countryCode', 'rules.retention.presenceEventDays',
        ]));
    });

    test('merges only defined override fields so scoped packs inherit safely', () => {
        const result = deepMerge(
            { work: { hours: 40, days: [1, 2, 3, 4, 5] }, overtime: { enabled: true, threshold: 40 } },
            { work: { hours: 37.5 }, overtime: { threshold: undefined } }
        );
        expect(result).toEqual({
            work: { hours: 37.5, days: [1, 2, 3, 4, 5] },
            overtime: { enabled: true, threshold: 40 },
        });
    });

    test('selects the most specific employee, team, jurisdiction, or organization assignment', () => {
        const candidates = [
            { _id: 'global', version: 1, effectiveFrom: '2026-01-01', jurisdiction: { kind: 'global' }, scope: {} },
            { _id: 'org', version: 1, effectiveFrom: '2026-01-01', jurisdiction: { kind: 'global' }, scope: { organizationId: 'org-1' } },
            { _id: 'country', version: 1, effectiveFrom: '2026-01-01', jurisdiction: { kind: 'country', countryCode: 'AU' }, scope: {} },
            { _id: 'team', version: 1, effectiveFrom: '2026-01-01', jurisdiction: { kind: 'global' }, scope: { organizationId: 'org-1', teamId: 'team-1' } },
            { _id: 'employee', version: 1, effectiveFrom: '2026-01-01', jurisdiction: { kind: 'global' }, scope: { organizationId: 'org-1', userId: 'employee-1' } },
        ];
        const context = { organizationId: 'org-1', countryCode: 'AU', teamId: 'team-1', userId: 'employee-1' };
        expect(selectEffectiveCandidate(candidates, context).pack._id).toBe('employee');
        expect(selectEffectiveCandidate(candidates.filter(pack => pack._id !== 'employee'), context).pack._id).toBe('team');
        expect(selectEffectiveCandidate(candidates.filter(pack => !['employee', 'team'].includes(pack._id)), context).pack._id).toBe('country');
    });

    test('does not treat organization ownership as more specific than an employee jurisdiction', () => {
        const selected = selectEffectiveCandidate([
            { _id: 'org-default', version: 9, effectiveFrom: '2026-07-01', jurisdiction: { kind: 'global' }, scope: { organizationId: 'org-1' } },
            { _id: 'mexico', version: 1, effectiveFrom: '2026-01-01', jurisdiction: { kind: 'country', countryCode: 'MX' }, scope: {} },
        ], { organizationId: 'org-1', countryCode: 'MX' });
        expect(selected.pack._id).toBe('mexico');
    });

    test('prefers an organization customization over a seeded template at the same jurisdiction', () => {
        const selected = selectEffectiveCandidate([
            { _id: 'seeded-au', version: 1, effectiveFrom: '2026-01-01', jurisdiction: { kind: 'country', countryCode: 'AU' }, scope: {} },
            { _id: 'org-au', version: 1, effectiveFrom: '2026-01-01', jurisdiction: { kind: 'country', countryCode: 'AU' }, scope: { organizationId: 'org-1' } },
        ], { organizationId: 'org-1', countryCode: 'AU' });
        expect(selected.pack._id).toBe('org-au');
    });

    test('rejects multiple assignment targets and produces stable assignment signatures', () => {
        const validation = validateRulePack({
            key: 'double-target', name: 'Double target', effectiveFrom: new Date(),
            jurisdiction: { kind: 'global' }, scope: { organizationId: 'org-1', teamId: 'team-1', userId: 'employee-1' },
            rules: {}, sources: [{ title: 'Policy' }],
        });
        expect(validation.errors).toContainEqual(expect.objectContaining({ path: 'scope' }));
        expect(assignmentSignature({ scope: { organizationId: 'org-1', userId: 'employee-1' } })).toBe('user:employee-1');
        expect(assignmentSignature({ scope: { organizationId: 'org-1' }, jurisdiction: { kind: 'country', countryCode: 'mx' } })).toBe('country:MX');
    });
});
