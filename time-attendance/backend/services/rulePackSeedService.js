const { AttendancePolicy, AttendanceRulePack } = require('../models');

const EU_COUNTRIES = [
    ['AT', 'Austria'], ['BE', 'Belgium'], ['BG', 'Bulgaria'], ['HR', 'Croatia'], ['CY', 'Cyprus'],
    ['CZ', 'Czechia'], ['DK', 'Denmark'], ['EE', 'Estonia'], ['FI', 'Finland'], ['FR', 'France'],
    ['DE', 'Germany'], ['GR', 'Greece'], ['HU', 'Hungary'], ['IE', 'Ireland'], ['IT', 'Italy'],
    ['LV', 'Latvia'], ['LT', 'Lithuania'], ['LU', 'Luxembourg'], ['MT', 'Malta'], ['NL', 'Netherlands'],
    ['PL', 'Poland'], ['PT', 'Portugal'], ['RO', 'Romania'], ['SK', 'Slovakia'], ['SI', 'Slovenia'],
    ['ES', 'Spain'], ['SE', 'Sweden'],
];

const INTERNAL_SOURCE = {
    title: 'Seemplify configurable attendance defaults',
    note: 'Product default only; organization and jurisdictional review is required before production use.',
};
const EU_SOURCE = {
    title: 'Directive 2003/88/EC — organisation of working time',
    url: 'https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:32003L0088',
};

function baseRules() {
    return {
        work: { standardHoursPerDay: 8, standardHoursPerWeek: 40, maximumHoursPerWeek: 48, workDays: [1, 2, 3, 4, 5], defaultStartTime: '09:00', defaultEndTime: '17:00' },
        breaks: { requiredAfterMinutes: 360, minimumBreakMinutes: 30, paid: false },
        rest: { minimumDailyRestMinutes: 660, minimumWeeklyRestMinutes: 1440 },
        overtime: { enabled: true, dailyThresholdHours: 8, weeklyThresholdHours: 40, multiplier: 1.5, requiresApproval: true },
        rounding: { enabled: false, incrementMinutes: 5, mode: 'nearest' },
        retention: { attendanceDays: 2190, presenceEventDays: 90 },
        exceptions: { lateGraceMinutes: 15, earlyDepartureGraceMinutes: 15, longBreakAfterMinutes: 90 },
    };
}

function definitions() {
    const europeanRules = {
        ...baseRules(),
        work: { ...baseRules().work, maximumHoursPerWeek: 48 },
        breaks: { ...baseRules().breaks, requiredAfterMinutes: 360 },
        rest: { ...baseRules().rest, minimumDailyRestMinutes: 660 },
    };
    const unitedKingdomRules = {
        ...baseRules(),
        breaks: { ...baseRules().breaks, requiredAfterMinutes: 360, minimumBreakMinutes: 20 },
        rest: { ...baseRules().rest, minimumDailyRestMinutes: 660 },
    };
    const packs = [
        { key: 'global-fallback', name: 'Global fallback', version: 1, status: 'published', jurisdiction: { kind: 'global' }, rules: baseRules(), sources: [INTERNAL_SOURCE], reviewRequired: false, changeNotes: 'Published operational fallback for employees without a more specific assignment.' },
        { key: 'ng-default', name: 'Nigeria default', version: 1, status: 'published', jurisdiction: { kind: 'country', countryCode: 'NG' }, parent: { key: 'global-fallback', version: 1 }, rules: baseRules(), sources: [INTERNAL_SOURCE], reviewRequired: false, changeNotes: 'Published Nigeria operational default and default employee fallback.' },
        { key: 'gb-default', name: 'United Kingdom default', version: 1, status: 'published', jurisdiction: { kind: 'country', countryCode: 'GB' }, parent: { key: 'global-fallback', version: 1 }, rules: unitedKingdomRules, sources: [{ title: 'Working Time Regulations 1998', url: 'https://www.legislation.gov.uk/uksi/1998/1833/contents' }], reviewRequired: false, changeNotes: 'Published operational baseline. Organizations can clone it to add contract or policy rules.' },
        { key: 'eu-baseline', name: 'European Union baseline', version: 1, status: 'published', jurisdiction: { kind: 'regional', regionCode: 'EU' }, parent: { key: 'global-fallback', version: 1 }, rules: europeanRules, sources: [EU_SOURCE], reviewRequired: false, changeNotes: 'Published EU operational baseline used by member-state packs.' },
    ];
    for (const [code, name] of EU_COUNTRIES) {
        packs.push({
            key: `eu-${code.toLowerCase()}`, name: `${name} working-time overlay`, version: 1, status: 'published',
            jurisdiction: { kind: 'country', regionCode: 'EU', countryCode: code }, parent: { key: 'eu-baseline', version: 1 }, rules: europeanRules,
            sources: [EU_SOURCE, { ...INTERNAL_SOURCE, note: `${name} operational baseline. Clone it to add verified national, contractual, or company-specific rules.` }],
            reviewRequired: false, changeNotes: 'Published complete operational baseline inherited from the EU working-time minimums.',
        });
    }
    return packs;
}

async function seedDefaultRulePacks({ actorId = 'seed' } = {}) {
    const packs = definitions();
    let inserted = 0;
    for (const pack of packs) {
        const result = await AttendanceRulePack.updateOne(
            { key: pack.key, version: pack.version },
            {
                $set: {
                    ...pack,
                    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
                    effectiveTo: null,
                    approvedAt: new Date(),
                    approvedBy: actorId,
                    updatedBy: actorId,
                },
                $setOnInsert: { createdBy: actorId },
            },
            { upsert: true, setDefaultsOnInsert: true }
        );
        inserted += result.upsertedCount || (result.upsertedId ? 1 : 0);
    }
    await AttendancePolicy.updateMany({
        $and: [
            { $or: [{ timezone: 'UTC' }, { timezone: null }, { timezone: { $exists: false } }] },
            { $or: [{ 'jurisdiction.countryCode': 'NG' }, { 'jurisdiction.countryCode': null }, { 'jurisdiction.countryCode': { $exists: false } }] },
        ],
    }, { $set: { timezone: 'Africa/Lagos', 'jurisdiction.countryCode': 'NG', updatedBy: actorId } });
    return { total: packs.length, inserted, existing: packs.length - inserted };
}

module.exports = { EU_COUNTRIES, baseRules, definitions, seedDefaultRulePacks };
