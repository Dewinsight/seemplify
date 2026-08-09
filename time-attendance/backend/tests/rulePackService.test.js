const { deepMerge, validateRulePack } = require('../services/rulePackService');
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
});
