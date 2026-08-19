const express = require('express');
const router = express.Router();
const { requireAuth, requireOrganization, requireHRAdmin } = require('../middleware/auth');
const { AttendanceRulePack, AttendancePolicy, EmployeeRoster } = require('../models');
const { assignmentSignature, resolveEffectiveRulePack, resolvePack, validateRulePack } = require('../services/rulePackService');
const { seedDefaultRulePacks } = require('../services/rulePackSeedService');
const { calculatePeriod } = require('../services/timeCalculationService');

router.use(requireAuth, requireOrganization, requireHRAdmin);

function editableFields(body = {}) {
    const output = {};
    for (const key of [
        'key', 'name', 'description', 'jurisdiction', 'scope', 'parent', 'effectiveFrom',
        'effectiveTo', 'rules', 'sources', 'reviewRequired', 'changeNotes',
    ]) {
        if (body[key] !== undefined) output[key] = body[key];
    }
    return output;
}

function isOrganizationPack(pack, organizationId) {
    return String(pack.scope?.organizationId || '') === String(organizationId || '');
}

router.get('/', async (req, res) => {
    try {
        const query = {
            $or: [
                { 'scope.organizationId': { $exists: false } },
                { 'scope.organizationId': null },
                { 'scope.organizationId': req.organizationId },
            ],
        };
        if (req.query.status) query.status = req.query.status;
        if (req.query.countryCode) query['jurisdiction.countryCode'] = String(req.query.countryCode).toUpperCase();
        const packs = await AttendanceRulePack.find(query).sort({ key: 1, version: -1 }).lean();
        return res.json({ packs });
    } catch (error) {
        return res.status(500).json({ error: 'Failed to load rule packs' });
    }
});

router.post('/seed-defaults', async (req, res) => {
    try {
        const result = await seedDefaultRulePacks({ actorId: req.user.id });
        return res.status(result.inserted ? 201 : 200).json(result);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to add baseline rule-pack templates' });
    }
});

router.get('/assignment-options', async (req, res) => {
    try {
        const people = await EmployeeRoster.find({ organizationId: req.organizationId, status: 'active' })
            .select('userId name email teamIds teamAssignments jurisdiction rulePackAssignment')
            .sort({ name: 1, email: 1 })
            .lean();
        const teamsById = new Map();
        for (const person of people) {
            for (const assignment of person.teamAssignments || []) {
                teamsById.set(String(assignment.teamId), { id: String(assignment.teamId), name: assignment.name || String(assignment.teamId) });
            }
            for (const teamId of person.teamIds || []) {
                if (!teamsById.has(String(teamId))) teamsById.set(String(teamId), { id: String(teamId), name: String(teamId) });
            }
        }
        return res.json({ people, teams: [...teamsById.values()].sort((a, b) => a.name.localeCompare(b.name)) });
    } catch (error) {
        return res.status(500).json({ error: 'Failed to load rule-pack assignment options' });
    }
});

router.get('/coverage', async (req, res) => {
    try {
        const policy = await AttendancePolicy.getOrCreateDefault(req.organizationId, req.organization?.name, req.user.id);
        const people = await EmployeeRoster.find({ organizationId: req.organizationId, status: 'active' })
            .select('userId name email teamIds teamAssignments jurisdiction rulePackAssignment')
            .sort({ name: 1, email: 1 })
            .lean();
        const coverage = await Promise.all(people.map(async person => {
            const result = await resolveEffectiveRulePack({
                organizationId: req.organizationId,
                userId: person.userId,
                teamId: person.teamIds?.[0],
                countryCode: person.jurisdiction?.countryCode || policy.jurisdiction?.countryCode || 'NG',
                subdivisionCode: person.jurisdiction?.subdivisionCode,
                rulePackId: person.rulePackAssignment?.rulePackId,
            });
            return {
                userId: person.userId,
                name: person.name,
                email: person.email,
                teamIds: person.teamIds || [],
                jurisdiction: person.jurisdiction || {},
                fallbackJurisdiction: person.jurisdiction?.countryCode ? null : (policy.jurisdiction?.countryCode || 'NG'),
                assignment: person.rulePackAssignment || null,
                applied: result.applied,
                effectiveRulePack: result.applied.at(-1) || null,
            };
        }));
        return res.json({ coverage });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to calculate rule-pack coverage' });
    }
});

router.post('/bulk-assign', async (req, res) => {
    try {
        const userIds = [...new Set((Array.isArray(req.body.userIds) ? req.body.userIds : [])
            .map(value => String(value || '').trim()).filter(Boolean))];
        if (!userIds.length) return res.status(400).json({ error: 'Select at least one employee' });
        if (userIds.length > 1000) return res.status(400).json({ error: 'No more than 1,000 employees can be assigned at once' });

        const pack = await AttendanceRulePack.findOne({
            _id: req.body.rulePackId,
            status: 'published',
            $or: [
                { 'scope.organizationId': { $exists: false } },
                { 'scope.organizationId': null },
                { 'scope.organizationId': req.organizationId },
            ],
        }).lean();
        if (!pack) return res.status(404).json({ error: 'Choose an available published rule pack' });

        const result = await EmployeeRoster.updateMany(
            { organizationId: req.organizationId, status: 'active', userId: { $in: userIds } },
            { $set: { rulePackAssignment: {
                rulePackId: pack._id,
                key: pack.key,
                version: pack.version,
                assignedAt: new Date(),
                assignedBy: req.user.id,
            } } }
        );
        return res.json({
            assigned: result.modifiedCount || 0,
            matched: result.matchedCount || 0,
            rulePack: { id: pack._id, key: pack.key, name: pack.name, version: pack.version },
        });
    } catch (error) {
        return res.status(400).json({ error: error.message || 'Employees could not be assigned to the rule pack' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const pack = await AttendanceRulePack.findById(req.params.id);
        if (!pack) return res.status(404).json({ error: 'Rule pack not found' });
        if (pack.scope?.organizationId && !isOrganizationPack(pack, req.organizationId)) return res.status(403).json({ error: 'Access denied' });
        const resolved = await resolvePack(pack);
        return res.json({ pack, resolved });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load rule pack' });
    }
});

router.post('/', async (req, res) => {
    try {
        const fields = editableFields(req.body);
        fields.scope = { ...(fields.scope || {}), organizationId: req.organizationId };
        const latest = fields.key ? await AttendanceRulePack.findOne({ key: fields.key }).sort({ version: -1 }) : null;
        const pack = new AttendanceRulePack({ ...fields, version: latest ? latest.version + 1 : 1, status: 'draft', createdBy: req.user.id, updatedBy: req.user.id });
        const validation = validateRulePack(pack.toObject());
        if (!validation.valid && req.body.validate === true) return res.status(400).json(validation);
        await pack.save();
        return res.status(201).json({ pack, validation });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ error: 'A rule pack with this key and version already exists' });
        return res.status(400).json({ error: error.message || 'Failed to create rule pack' });
    }
});

router.post('/:id/clone', async (req, res) => {
    try {
        const sourceDocument = await AttendanceRulePack.findById(req.params.id);
        const source = sourceDocument?.toObject();
        if (!source) return res.status(404).json({ error: 'Rule pack not found' });
        const resolvedSource = await resolvePack(sourceDocument);
        const key = String(req.body.key || `${source.key}-${req.organizationId}`).trim();
        const latest = await AttendanceRulePack.findOne({ key }).sort({ version: -1 }).lean();
        const pack = await AttendanceRulePack.create({
            ...source,
            _id: undefined,
            key,
            name: req.body.name || `${source.name} copy`,
            version: (latest?.version || 0) + 1,
            status: 'draft',
            scope: { ...(req.body.scope || {}), organizationId: req.organizationId },
            parent: undefined,
            rules: resolvedSource.rules,
            createdBy: req.user.id,
            updatedBy: req.user.id,
            approvedAt: undefined,
            approvedBy: undefined,
        });
        return res.status(201).json({ pack });
    } catch (error) {
        return res.status(400).json({ error: error.message || 'Failed to clone rule pack' });
    }
});

router.patch('/:id', async (req, res) => {
    try {
        const pack = await AttendanceRulePack.findById(req.params.id);
        if (!pack) return res.status(404).json({ error: 'Rule pack not found' });
        if (pack.status === 'published') return res.status(409).json({ error: 'Published versions are immutable; clone a new version' });
        if (!isOrganizationPack(pack, req.organizationId)) return res.status(403).json({ error: 'Seeded rule packs are read-only; clone the pack before editing' });
        const fields = editableFields(req.body);
        if (fields.scope) fields.scope = { ...fields.scope, organizationId: req.organizationId };
        Object.assign(pack, fields, { updatedBy: req.user.id });
        await pack.save();
        return res.json({ pack, validation: validateRulePack(pack.toObject()) });
    } catch (error) {
        return res.status(400).json({ error: error.message || 'Failed to update rule pack' });
    }
});

router.post('/:id/validate', async (req, res) => {
    const pack = await AttendanceRulePack.findById(req.params.id);
    if (!pack) return res.status(404).json({ error: 'Rule pack not found' });
    if (!isOrganizationPack(pack, req.organizationId)) return res.status(403).json({ error: 'Clone the seeded rule pack before validation' });
    const validation = validateRulePack(pack.toObject());
    if (validation.valid && pack.status === 'draft') {
        pack.status = 'validated';
        await pack.save();
    }
    return res.status(validation.valid ? 200 : 400).json({ ...validation, pack });
});

router.post('/:id/publish', async (req, res) => {
    try {
        const pack = await AttendanceRulePack.findById(req.params.id);
        if (!pack) return res.status(404).json({ error: 'Rule pack not found' });
        if (!isOrganizationPack(pack, req.organizationId)) return res.status(403).json({ error: 'Clone the seeded rule pack before publication' });
        const validation = validateRulePack(pack.toObject());
        if (!validation.valid) return res.status(400).json(validation);
        await resolvePack(pack);
        if (pack.reviewRequired && req.body.confirmReviewed !== true) {
            return res.status(400).json({ error: 'Confirm jurisdictional review before publishing', code: 'LEGAL_REVIEW_REQUIRED' });
        }
        const publishedForOrganization = await AttendanceRulePack.find({
            'scope.organizationId': req.organizationId,
            status: 'published',
            _id: { $ne: pack._id },
        }).select('_id scope jurisdiction').lean();
        const signature = assignmentSignature(pack);
        const conflictingIds = publishedForOrganization
            .filter(candidate => assignmentSignature(candidate) === signature)
            .map(candidate => candidate._id);
        const effectiveFrom = new Date(pack.effectiveFrom);
        if (effectiveFrom <= new Date()) {
            await AttendanceRulePack.updateMany({ _id: { $in: conflictingIds } }, { $set: { status: 'superseded' } });
        } else {
            await AttendanceRulePack.updateMany({
                _id: { $in: conflictingIds },
                $or: [{ effectiveTo: null }, { effectiveTo: { $exists: false } }, { effectiveTo: { $gt: effectiveFrom } }],
            }, { $set: { effectiveTo: effectiveFrom } });
        }
        pack.status = 'published';
        pack.approvedAt = new Date();
        pack.approvedBy = req.user.id;
        pack.lastReviewedAt = req.body.reviewedAt || new Date();
        pack.reviewedBy = req.body.reviewedBy || req.user.name;
        await pack.save();
        if (assignmentSignature(pack) === 'organization') {
            await AttendancePolicy.updateOne({ organizationId: req.organizationId }, {
                $set: { activeRulePack: { rulePackId: pack._id, version: pack.version, appliedAt: new Date() } },
            });
        }
        return res.json({ pack });
    } catch (error) {
        return res.status(400).json({ error: error.message || 'Failed to publish rule pack' });
    }
});

router.post('/:id/retire', async (req, res) => {
    const pack = await AttendanceRulePack.findById(req.params.id);
    if (!pack) return res.status(404).json({ error: 'Rule pack not found' });
    if (!isOrganizationPack(pack, req.organizationId)) return res.status(403).json({ error: 'Seeded rule packs cannot be retired by an organization' });
    pack.status = 'retired';
    pack.effectiveTo = req.body.effectiveTo || new Date();
    pack.updatedBy = req.user.id;
    await pack.save();
    return res.json({ pack });
});

router.post('/:id/simulate', async (req, res) => {
    try {
        const pack = await AttendanceRulePack.findById(req.params.id);
        if (!pack) return res.status(404).json({ error: 'Rule pack not found' });
        const resolved = await resolvePack(pack);
        const entries = Array.isArray(req.body.entries) ? req.body.entries : [];
        const period = {
            start: new Date(req.body.startDate),
            end: new Date(req.body.endDate),
        };
        if (Number.isNaN(period.start.getTime()) || Number.isNaN(period.end.getTime())) {
            return res.status(400).json({ error: 'Valid startDate and endDate are required' });
        }
        const calculationPolicy = {
            timezone: req.body.timezone || 'Africa/Lagos',
            workSchedule: {
                workDays: resolved.rules?.work?.workDays,
                standardHoursPerDay: resolved.rules?.work?.standardHoursPerDay,
                standardHoursPerWeek: resolved.rules?.work?.standardHoursPerWeek,
            },
            overtime: {
                enabled: resolved.rules?.overtime?.enabled,
                dailyThreshold: resolved.rules?.overtime?.dailyThresholdHours,
                weeklyThreshold: resolved.rules?.overtime?.weeklyThresholdHours,
            },
            clockSettings: { rounding: resolved.rules?.rounding },
        };
        return res.json({ result: calculatePeriod(entries, period, calculationPolicy), applied: { key: pack.key, version: pack.version } });
    } catch (error) {
        return res.status(400).json({ error: error.message || 'Simulation failed' });
    }
});

module.exports = router;
