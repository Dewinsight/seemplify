const { AttendanceRulePack } = require('../models');

function deepMerge(base, override) {
    if (!override || typeof override !== 'object' || Array.isArray(override)) return override ?? base;
    const output = { ...(base || {}) };
    for (const [key, value] of Object.entries(override)) {
        if (value === undefined) continue;
        output[key] = value && typeof value === 'object' && !Array.isArray(value)
            ? deepMerge(output[key], value)
            : value;
    }
    return output;
}

function validateRulePack(pack) {
    const errors = [];
    const rules = pack.rules || {};
    if (!pack.key) errors.push({ path: 'key', message: 'Key is required' });
    if (!pack.name) errors.push({ path: 'name', message: 'Name is required' });
    if (!pack.jurisdiction?.kind) errors.push({ path: 'jurisdiction.kind', message: 'Jurisdiction kind is required' });
    if (pack.jurisdiction?.kind === 'regional' && !pack.jurisdiction?.regionCode) errors.push({ path: 'jurisdiction.regionCode', message: 'Regional packs require a region code' });
    if (pack.jurisdiction?.kind === 'country' && !pack.jurisdiction?.countryCode) errors.push({ path: 'jurisdiction.countryCode', message: 'Country packs require an ISO country code' });
    if (pack.jurisdiction?.kind === 'subdivision' && !pack.jurisdiction?.subdivisionCode) errors.push({ path: 'jurisdiction.subdivisionCode', message: 'Subdivision packs require an ISO subdivision code' });
    if (!pack.effectiveFrom || Number.isNaN(new Date(pack.effectiveFrom).getTime())) errors.push({ path: 'effectiveFrom', message: 'A valid effective start is required' });
    if (rules.work?.standardHoursPerDay > 24) errors.push({ path: 'rules.work.standardHoursPerDay', message: 'Cannot exceed 24 hours' });
    if (rules.work?.maximumHoursPerWeek > 168) errors.push({ path: 'rules.work.maximumHoursPerWeek', message: 'Cannot exceed 168 hours' });
    if (rules.overtime?.dailyThresholdHours > 24) errors.push({ path: 'rules.overtime.dailyThresholdHours', message: 'Cannot exceed 24 hours' });
    if (rules.overtime?.weeklyThresholdHours > 168) errors.push({ path: 'rules.overtime.weeklyThresholdHours', message: 'Cannot exceed 168 hours' });
    if (rules.retention?.presenceEventDays > 90) errors.push({ path: 'rules.retention.presenceEventDays', message: 'Raw presence evidence cannot be retained for more than 90 days' });
    if (pack.effectiveTo && new Date(pack.effectiveTo) <= new Date(pack.effectiveFrom)) {
        errors.push({ path: 'effectiveTo', message: 'Effective end must be after effective start' });
    }
    if (!Array.isArray(pack.sources) || pack.sources.length === 0) {
        errors.push({ path: 'sources', message: 'At least one source or internal policy reference is required' });
    }
    return { valid: errors.length === 0, errors };
}

async function resolvePack(pack, seen = new Set()) {
    const current = pack?.toObject ? pack.toObject() : pack;
    if (!pack?.parent?.key) return {
        ...current,
        inheritedRulePacks: current?.key ? [{ id: current._id, key: current.key, version: current.version }] : [],
    };
    const marker = `${pack.parent.key}:${pack.parent.version || 'latest'}`;
    if (seen.has(marker)) throw new Error('Rule pack inheritance cycle detected');
    seen.add(marker);
    const parent = await AttendanceRulePack.findOne({
        key: pack.parent.key,
        ...(pack.parent.version ? { version: pack.parent.version } : { status: 'published' }),
    }).sort({ version: -1 });
    if (!parent) throw new Error(`Parent rule pack ${marker} was not found`);
    const resolvedParent = await resolvePack(parent, seen);
    const child = current;
    return {
        ...resolvedParent,
        ...child,
        rules: deepMerge(resolvedParent.rules, child.rules),
        inheritedFrom: marker,
        inheritedRulePacks: [
            ...(resolvedParent.inheritedRulePacks || []),
            { id: child._id, key: child.key, version: child.version },
        ],
    };
}

async function resolveEffectiveRulePack({ organizationId, countryCode, subdivisionCode, locationId, teamId, userId, at = new Date() }) {
    const active = {
        status: 'published',
        effectiveFrom: { $lte: at },
        $or: [{ effectiveTo: null }, { effectiveTo: { $exists: false } }, { effectiveTo: { $gt: at } }],
    };
    const candidates = await AttendanceRulePack.find({
        ...active,
        $and: [{
            $or: [
                { 'jurisdiction.kind': 'global' },
                { 'jurisdiction.countryCode': String(countryCode || '').toUpperCase() },
                { 'jurisdiction.subdivisionCode': String(subdivisionCode || '').toUpperCase() },
                { 'scope.organizationId': organizationId },
            ],
        }],
    }).sort({ version: 1 });

    const scored = candidates.map(pack => {
        let score = pack.jurisdiction?.kind === 'global' ? 0 : 10;
        if (pack.jurisdiction?.countryCode === String(countryCode || '').toUpperCase()) score = 20;
        if (pack.jurisdiction?.subdivisionCode === String(subdivisionCode || '').toUpperCase()) score = 30;
        if (pack.scope?.organizationId === organizationId) score = 40;
        if (pack.scope?.locationId && pack.scope.locationId === locationId) score = 50;
        if (pack.scope?.teamId && pack.scope.teamId === teamId) score = 50;
        if (pack.scope?.userId && pack.scope.userId === userId) score = 60;
        return { pack, score };
    }).filter(item => !item.pack.scope?.locationId || item.pack.scope.locationId === locationId)
        .filter(item => !item.pack.scope?.teamId || item.pack.scope.teamId === teamId)
        .filter(item => !item.pack.scope?.userId || item.pack.scope.userId === userId)
        .sort((a, b) => a.score - b.score || a.pack.version - b.pack.version);

    let effective = {};
    const applied = [];
    const appliedMarkers = new Set();
    for (const item of scored) {
        const resolved = await resolvePack(item.pack);
        effective = deepMerge(effective, resolved.rules || {});
        for (const inherited of resolved.inheritedRulePacks || [{ id: item.pack._id, key: item.pack.key, version: item.pack.version }]) {
            const marker = `${inherited.key}:${inherited.version}`;
            if (appliedMarkers.has(marker)) continue;
            appliedMarkers.add(marker);
            applied.push({ ...inherited, score: item.score });
        }
    }
    return { rules: effective, applied };
}

async function resolveCalculationPolicy({ policy, organizationId, userId, teamId, locationId, countryCode, subdivisionCode, at = new Date() }) {
    const base = policy?.toObject ? policy.toObject() : JSON.parse(JSON.stringify(policy || {}));
    const resolved = await resolveEffectiveRulePack({
        organizationId,
        userId,
        teamId,
        locationId,
        countryCode: countryCode || base.jurisdiction?.countryCode,
        subdivisionCode: subdivisionCode || base.jurisdiction?.subdivisionCode,
        at,
    });
    const rules = resolved.rules || {};
    const calculationPolicy = deepMerge(base, {
        workSchedule: {
            standardHoursPerDay: rules.work?.standardHoursPerDay,
            standardHoursPerWeek: rules.work?.standardHoursPerWeek,
            workDays: rules.work?.workDays,
            defaultShift: {
                startTime: rules.work?.defaultStartTime,
                endTime: rules.work?.defaultEndTime,
                breakDuration: rules.breaks?.minimumBreakMinutes,
            },
        },
        breakRules: {
            requiredAfterMinutes: rules.breaks?.requiredAfterMinutes,
            minimumBreakMinutes: rules.breaks?.minimumBreakMinutes,
            paid: rules.breaks?.paid,
        },
        restRules: { minimumMinutesBetweenShifts: rules.rest?.minimumDailyRestMinutes },
        overtime: {
            enabled: rules.overtime?.enabled,
            dailyThreshold: rules.overtime?.dailyThresholdHours,
            weeklyThreshold: rules.overtime?.weeklyThresholdHours,
            multiplier: rules.overtime?.multiplier,
            requiresApproval: rules.overtime?.requiresApproval,
        },
        gracePeriod: {
            lateArrival: rules.exceptions?.lateGraceMinutes,
            earlyDeparture: rules.exceptions?.earlyDepartureGraceMinutes,
        },
        clockSettings: { rounding: rules.rounding },
    });
    return { policy: calculationPolicy, applied: resolved.applied };
}

module.exports = { deepMerge, resolveCalculationPolicy, resolveEffectiveRulePack, resolvePack, validateRulePack };
