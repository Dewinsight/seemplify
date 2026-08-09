const { AttendanceRulePack } = require('../models');

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
    const packs = [
        { key: 'global-fallback', name: 'Global fallback', version: 1, status: 'draft', jurisdiction: { kind: 'global' }, rules: baseRules(), sources: [INTERNAL_SOURCE], reviewRequired: true, changeNotes: 'Global product fallback. Clone and review for production use.' },
        { key: 'ng-default', name: 'Nigeria default', version: 1, status: 'draft', jurisdiction: { kind: 'country', countryCode: 'NG' }, parent: { key: 'global-fallback', version: 1 }, rules: baseRules(), sources: [INTERNAL_SOURCE], reviewRequired: true, changeNotes: 'Default jurisdiction selected for new organizations; requires local review.' },
        { key: 'gb-default', name: 'United Kingdom default', version: 1, status: 'draft', jurisdiction: { kind: 'country', countryCode: 'GB' }, parent: { key: 'global-fallback', version: 1 }, rules: { breaks: { requiredAfterMinutes: 360, minimumBreakMinutes: 20 }, rest: { minimumDailyRestMinutes: 660 } }, sources: [{ title: 'Working Time Regulations 1998', url: 'https://www.legislation.gov.uk/uksi/1998/1833/contents' }], reviewRequired: true, changeNotes: 'Configurable starting template; requires current UK review before publication.' },
        { key: 'eu-baseline', name: 'European Union baseline', version: 1, status: 'draft', jurisdiction: { kind: 'regional', regionCode: 'EU' }, parent: { key: 'global-fallback', version: 1 }, rules: { work: { maximumHoursPerWeek: 48 }, breaks: { requiredAfterMinutes: 360 }, rest: { minimumDailyRestMinutes: 660 } }, sources: [EU_SOURCE], reviewRequired: true, changeNotes: 'EU minimum-area baseline. A reviewed member-state overlay must be selected.' },
    ];
    for (const [code, name] of EU_COUNTRIES) {
        packs.push({
            key: `eu-${code.toLowerCase()}`, name: `${name} working-time overlay`, version: 1, status: 'draft',
            jurisdiction: { kind: 'country', regionCode: 'EU', countryCode: code }, parent: { key: 'eu-baseline', version: 1 }, rules: {},
            sources: [EU_SOURCE, { ...INTERNAL_SOURCE, note: `Add and verify current ${name} sources and national rules before publishing.` }],
            reviewRequired: true, changeNotes: 'Draft national overlay intentionally contains no unreviewed national assumptions.',
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
            { $setOnInsert: { ...pack, effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), createdBy: actorId } },
            { upsert: true, setDefaultsOnInsert: true }
        );
        inserted += result.upsertedCount || (result.upsertedId ? 1 : 0);
    }
    return { total: packs.length, inserted, existing: packs.length - inserted };
}

module.exports = { EU_COUNTRIES, baseRules, definitions, seedDefaultRulePacks };
