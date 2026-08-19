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
    const assignmentTargets = ['locationId', 'teamId', 'userId'].filter(key => pack.scope?.[key]);
    if (assignmentTargets.length > 1) {
        errors.push({ path: 'scope', message: 'Choose only one location, team, or employee assignment' });
    }
    if (assignmentTargets.length && !pack.scope?.organizationId) {
        errors.push({ path: 'scope.organizationId', message: 'Employee, team, and location assignments require an organization' });
    }
    return { valid: errors.length === 0, errors };
}

function normalized(value) {
    return String(value || '').trim().toUpperCase();
}

function candidateSpecificity(pack, context) {
    const scope = pack.scope || {};
    const jurisdiction = pack.jurisdiction || {};
    if (scope.organizationId && String(scope.organizationId) !== String(context.organizationId || '')) return -1;

    if (scope.userId) return String(scope.userId) === String(context.userId || '') ? 60 : -1;
    if (scope.teamId) return String(scope.teamId) === String(context.teamId || '') ? 50 : -1;
    if (scope.locationId) return String(scope.locationId) === String(context.locationId || '') ? 50 : -1;

    if (jurisdiction.kind === 'subdivision') {
        return normalized(jurisdiction.subdivisionCode) === normalized(context.subdivisionCode) ? 30 : -1;
    }
    if (jurisdiction.kind === 'country') {
        return normalized(jurisdiction.countryCode) === normalized(context.countryCode) ? 20 : -1;
    }
    if (jurisdiction.kind === 'regional') {
        return normalized(jurisdiction.regionCode) === normalized(context.regionCode) ? 10 : -1;
    }
    if (scope.organizationId) return 5;
    return jurisdiction.kind === 'global' ? 0 : -1;
}

function selectEffectiveCandidate(candidates, context) {
    return candidates.map(pack => ({ pack, score: candidateSpecificity(pack, context) }))
        .filter(item => item.score >= 0)
        .sort((a, b) => {
            if (a.score !== b.score) return b.score - a.score;
            const aOwned = Boolean(a.pack.scope?.organizationId);
            const bOwned = Boolean(b.pack.scope?.organizationId);
            if (aOwned !== bOwned) return bOwned ? 1 : -1;
            const effectiveDifference = new Date(b.pack.effectiveFrom || 0) - new Date(a.pack.effectiveFrom || 0);
            if (effectiveDifference) return effectiveDifference;
            if ((b.pack.version || 0) !== (a.pack.version || 0)) return (b.pack.version || 0) - (a.pack.version || 0);
            return String(b.pack._id || '').localeCompare(String(a.pack._id || ''));
        })[0] || null;
}

function assignmentSignature(pack) {
    const scope = pack.scope || {};
    if (scope.userId) return `user:${scope.userId}`;
    if (scope.teamId) return `team:${scope.teamId}`;
    if (scope.locationId) return `location:${scope.locationId}`;
    const jurisdiction = pack.jurisdiction || {};
    if (jurisdiction.kind === 'subdivision') return `subdivision:${normalized(jurisdiction.subdivisionCode)}`;
    if (jurisdiction.kind === 'country') return `country:${normalized(jurisdiction.countryCode)}`;
    if (jurisdiction.kind === 'regional') return `region:${normalized(jurisdiction.regionCode)}`;
    return 'organization';
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

    const selected = selectEffectiveCandidate(candidates, {
        organizationId, countryCode, subdivisionCode, locationId, teamId, userId,
    });
    if (!selected) return { rules: {}, applied: [] };
    const resolved = await resolvePack(selected.pack);
    const applied = (resolved.inheritedRulePacks || []).map(pack => ({ ...pack, score: selected.score }));
    return { rules: resolved.rules || {}, applied };
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

module.exports = {
    assignmentSignature,
    candidateSpecificity,
    deepMerge,
    resolveCalculationPolicy,
    resolveEffectiveRulePack,
    resolvePack,
    selectEffectiveCandidate,
    validateRulePack,
};
