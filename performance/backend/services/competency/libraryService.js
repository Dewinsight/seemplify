const crypto = require('crypto');
const mongoose = require('mongoose');
const Role = require('../../models/CompetencyRole');
const RoleVersion = require('../../models/CompetencyRoleVersion');
const Framework = require('../../models/CompetencyFramework');
const FrameworkVersion = require('../../models/CompetencyFrameworkVersion');
const Strategy = require('../../models/CompetencyStrategyVersion');
const Import = require('../../models/CompetencyImport');
const Cycle = require('../../models/CompetencyCycle');
const { DomainError, id, requiredText, cleanObject, hash, validateSources, validateScoring, validateRanking, validateWeights } = require('../../contracts/competency');
const files = require('./fileSafetyService');
const roleKeys = ['name', 'description', 'responsibilities', 'requirements', 'criteria'];
const frameworkKeys = ['name', 'criteria', 'levels', 'source', 'licenseProvenance'];
const strategyKeys = ['title', 'description', 'criteria', 'levels', 'sourceRef'];
const cycleKeys = ['includeApprovedGoals', 'workflowDefinition', 'reviewMode', 'cadence', 'regularTemplateId', 'name', 'period', 'selectedInputTypes', 'frameworkVersionIds', 'strategyVersionIds', 'roleVersionIds', 'scoringConfig', 'rankingConfig'];
const plain = d => d?.toObject ? d.toObject() : d;
function dto(d) { if (!d)
    return null; const v = plain(d); const { _id, __v, ...rest } = v; return { ...rest, id: String(_id), ...(v.roleId ? { roleId: String(v.roleId), versionId: String(_id) } : {}), ...(v.frameworkId ? { frameworkId: String(v.frameworkId), versionId: String(_id) } : {}), ...(v.strategyId ? { strategyId: String(v.strategyId), versionId: String(_id) } : {}) }; }
function definitionContent(value) { if (Array.isArray(value))
    return value.map(definitionContent); if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).filter(([k]) => !['createdAt', 'updatedAt', 'publishedAt', 'capturedAt', 'createdBy', 'publishedBy', 'revision'].includes(k)).map(([k, v]) => [k, definitionContent(v)]));
} return value; }
function invalid(message, path = '') { throw new DomainError(422, 'VALIDATION_FAILED', message, path ? [{ path, code: 'INVALID', message }] : []); }
function arr(v, p, max = 200) { if (!Array.isArray(v) || v.length > max)
    invalid(`Use a list of at most ${max} items.`, p); return v; }
function text(v, p, max = 10000) { if (v === undefined)
    return ''; if (typeof v !== 'string' || v.length > max)
    invalid('Enter valid text.', p); return v.trim(); }
function bool(v, p) { if (typeof v !== 'boolean')
    invalid('Choose true or false.', p); return v; }
function number(v, p) { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || !/^\d+(?:\.\d{1,6})?$/.test(String(v)))
    invalid('Use a non-negative finite number with up to six decimal places.', p); return v; }
function targetNumber(v, p) { if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e9 || !/^\-?\d+(?:\.\d{1,6})?$/.test(String(v)))
    invalid('Use a finite number with up to six decimal places.', p); return v; }
function unique(items, p) { if (new Set(items).size !== items.length)
    invalid('Remove duplicate identifiers.', p); return items; }
function key(v, p) { return requiredText(v, p, 100); }
function roleContent(input) {
    cleanObject(input, roleKeys);
    const out = { name: requiredText(input.name, 'name', 200), description: text(input.description, 'description') };
    out.responsibilities = arr(input.responsibilities || [], 'responsibilities').map((x, i) => { cleanObject(x, ['id', 'text']); return { id: key(x.id, `responsibilities.${i}.id`), text: requiredText(x.text, `responsibilities.${i}.text`, 5000) }; });
    unique(out.responsibilities.map(x => x.id), 'responsibilities');
    out.requirements = arr(input.requirements || [], 'requirements').map((x, i) => { cleanObject(x, ['id', 'text', 'required']); return { id: key(x.id, `requirements.${i}.id`), text: requiredText(x.text, `requirements.${i}.text`, 5000), required: bool(x.required, `requirements.${i}.required`) }; });
    unique(out.requirements.map(x => x.id), 'requirements');
    out.criteria = arr(input.criteria || [], 'criteria').map((x, i) => {
        const p = `criteria.${i}`;
        cleanObject(x, ['id', 'sourceType', 'frameworkVersionId', 'strategyVersionId', 'criterionId', 'expectedLevelId', 'evaluationTarget', 'weight', 'required', 'evidenceRequired', 'rationaleRequired', 'responsibilityIds', 'requirementIds']);
        if (!['sfia', 'internal', 'strategy'].includes(x.sourceType))
            invalid('Choose a valid criterion source.', `${p}.sourceType`);
        if ((x.sourceType === 'strategy') !== Boolean(x.strategyVersionId) || Boolean(x.frameworkVersionId) === Boolean(x.strategyVersionId))
            invalid('Choose exactly one matching source version.', p);
        if (x.expectedLevelId && x.evaluationTarget)
            invalid('Choose one expected level or numeric target.', p);
        let target;
        if (x.evaluationTarget) {
            cleanObject(x.evaluationTarget, ['scaleId', 'value']);
            target = { scaleId: key(x.evaluationTarget.scaleId, `${p}.evaluationTarget.scaleId`), value: targetNumber(x.evaluationTarget.value, `${p}.evaluationTarget.value`) };
        }
        const r = { id: key(x.id, `${p}.id`), sourceType: x.sourceType, criterionId: key(x.criterionId, `${p}.criterionId`), ...(x.frameworkVersionId ? { frameworkVersionId: id(x.frameworkVersionId) } : { strategyVersionId: id(x.strategyVersionId) }), ...(x.expectedLevelId ? { expectedLevelId: key(x.expectedLevelId, `${p}.expectedLevelId`) } : {}), ...(target ? { evaluationTarget: target } : {}), weight: number(x.weight, `${p}.weight`), required: bool(x.required, `${p}.required`), evidenceRequired: bool(x.evidenceRequired, `${p}.evidenceRequired`), rationaleRequired: bool(x.rationaleRequired, `${p}.rationaleRequired`), responsibilityIds: unique(arr(x.responsibilityIds || [], `${p}.responsibilityIds`).map(v => key(v, p)), p), requirementIds: unique(arr(x.requirementIds || [], `${p}.requirementIds`).map(v => key(v, p)), p) };
        if (r.responsibilityIds.some(v => !out.responsibilities.some(a => a.id === v)) || r.requirementIds.some(v => !out.requirements.some(a => a.id === v)))
            invalid('Choose responsibilities and requirements in this role.', p);
        return r;
    });
    unique(out.criteria.map(x => x.id), 'criteria');
    unique(out.criteria.map(x => `${x.frameworkVersionId || x.strategyVersionId}:${x.criterionId}`), 'criteria');
    return out;
}
function frameworkContent(input, strategy = false) {
    cleanObject(input, strategy ? strategyKeys : frameworkKeys);
    const out = strategy ? { title: requiredText(input.title, 'title', 200), description: text(input.description, 'description') } : { name: requiredText(input.name, 'name', 200), source: text(input.source, 'source', 1000), licenseProvenance: text(input.licenseProvenance, 'licenseProvenance', 5000) };
    out.levels = arr(input.levels || [], 'levels', 100).map((x, i) => { cleanObject(x, ['id', 'label', 'description', 'order']); if (!Number.isInteger(x.order) || x.order < 0)
        invalid('Use a non-negative integer display order.', `levels.${i}.order`); return { id: key(x.id, `levels.${i}.id`), label: requiredText(x.label, `levels.${i}.label`, 200), description: requiredText(x.description, `levels.${i}.description`, 5000), order: x.order }; });
    unique(out.levels.map(x => x.id), 'levels');
    out.criteria = arr(input.criteria || [], 'criteria').map((x, i) => { cleanObject(x, ['id', 'code', 'name', 'description', 'levelIds']); const levelIds = unique(arr(x.levelIds || [], `criteria.${i}.levelIds`, 100).map(v => key(v, 'levelIds')), 'levelIds'); if (levelIds.some(v => !out.levels.some(l => l.id === v)))
        invalid('Choose levels from this framework version.', `criteria.${i}.levelIds`); return { id: key(x.id, `criteria.${i}.id`), code: key(x.code, `criteria.${i}.code`), name: requiredText(x.name, `criteria.${i}.name`, 200), description: requiredText(x.description, `criteria.${i}.description`, 5000), levelIds }; });
    unique(out.criteria.map(x => x.id), 'criteria');
    unique(out.criteria.map(x => x.code), 'criteria');
    if (strategy && input.sourceRef !== undefined)
        out.sourceRef = input.sourceRef;
    return out;
}
async function find(Model, organizationId, resourceId, extra = {}) { const d = await Model.findOne({ organizationId, _id: id(String(resourceId)), ...extra }); if (!d)
    throw new DomainError(404, 'NOT_FOUND', 'The requested item was not found.'); return d; }
async function cas(Model, document, expected, updates, extra = {}) { if (document.revision !== expected)
    throw new DomainError(409, 'REVISION_CONFLICT', 'This draft changed. Reload before saving.'); const result = await Model.findOneAndUpdate({ _id: document._id, organizationId: document.organizationId, revision: expected, ...extra }, { $set: updates, $inc: { revision: 1 } }, { new: true, runValidators: true }); if (!result)
    throw new DomainError(409, 'REVISION_CONFLICT', 'This draft changed. Reload before saving.'); return result; }
const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80) + '-' + crypto.randomUUID();
const exactName = name => new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
async function list(kind, org, query = {}, scope = {}) { const model = { roles: Role, frameworks: Framework, strategies: Strategy, cycles: Cycle }[kind]; const filter = { organizationId: org, ...scope }; if (kind === 'roles' || kind === 'frameworks') {
    if (query.status === 'archived')
        filter.archivedAt = { $ne: null };
    else if (query.status !== 'all')
        filter.archivedAt = null;
} if (query.search)
    filter[kind === 'strategies' ? 'title' : 'name'] = { $regex: String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100), $options: 'i' }; return (await model.find(filter).sort({ updatedAt: -1, _id: -1 }).limit(200)).map(dto); }
async function getRole(org, roleId) { const role = await find(Role, org, roleId); const versions = await RoleVersion.find({ organizationId: org, roleId: role._id }).sort({ version: -1 }); return { ...dto(role), versions: versions.map(dto), publishedVersion: versions.find(v => String(v._id) === String(role.currentVersionId)) ? dto(versions.find(v => String(v._id) === String(role.currentVersionId))) : null }; }
async function createRole(ctx, input, sourceDocumentId) { cleanObject(input, [...roleKeys, 'duplicateConfirmed']); const { duplicateConfirmed, ...draft } = input; if (duplicateConfirmed !== undefined)
    bool(duplicateConfirmed, 'duplicateConfirmed'); const content = roleContent(draft); if (sourceDocumentId) {
    const existing = await Role.findOne({ _id: sourceDocumentId, organizationId: ctx.organizationId });
    if (existing) {
        const detail = await getRole(ctx.organizationId, String(existing._id));
        const draft = detail.versions.find(v => v.status === 'draft');
        if (!draft || hash(roleContent(Object.fromEntries(roleKeys.map(k => [k, draft[k]])))) !== hash(content))
            throw new DomainError(409, 'IMPORT_ALREADY_CONFIRMED', 'This import already created different role details.');
        return { ...detail, draftVersion: draft };
    }
} const duplicateNames = (await Role.find({ organizationId: ctx.organizationId, name: exactName(content.name), archivedAt: null }).select('name').limit(10)).map(dto); if (duplicateNames.length && !duplicateConfirmed)
    throw new DomainError(409, 'ROLE_NAME_EXISTS', 'A role with this name already exists. Open it or confirm creation of a separate role.', [{ path: 'name', code: 'DUPLICATE', message: 'Confirm that you want a separate role with this name.' }]); const role = await Role.create({ ...(sourceDocumentId ? { _id: sourceDocumentId } : {}), organizationId: ctx.organizationId, name: content.name, description: content.description, slug: slug(content.name), createdBy: ctx.actor }); try {
    const version = await RoleVersion.create({ organizationId: ctx.organizationId, roleId: role._id, version: 1, ...content, createdBy: ctx.actor, ...(sourceDocumentId ? { sourceDocumentId } : {}) });
    return { ...dto(role), versions: [dto(version)], draftVersion: dto(version), duplicateNames };
}
catch (e) {
    await Role.deleteOne({ _id: role._id, organizationId: ctx.organizationId });
    throw e;
} }
async function updateRole(org, roleId, input, rev) { cleanObject(input, ['name', 'description']); const role = await find(Role, org, roleId); if (role.archivedAt)
    throw new DomainError(409, 'ARCHIVED', 'Archived roles cannot be edited.'); return dto(await cas(Role, role, rev, { ...(input.name !== undefined ? { name: requiredText(input.name, 'name', 200) } : {}), ...(input.description !== undefined ? { description: text(input.description, 'description') } : {}) })); }
async function newRoleVersion(ctx, roleId, input, rev) { const role = await find(Role, ctx.organizationId, roleId); if (role.archivedAt)
    throw new DomainError(409, 'ARCHIVED', 'Archived roles cannot be revised.'); if (await RoleVersion.exists({ organizationId: ctx.organizationId, roleId: role._id, status: 'draft' }))
    throw new DomainError(409, 'DRAFT_EXISTS', 'Edit the existing draft before creating another version.'); const latest = await RoleVersion.findOne({ organizationId: ctx.organizationId, roleId: role._id }).sort({ version: -1 }); const content = Object.keys(input).length ? roleContent(input) : roleContent(Object.fromEntries(roleKeys.map(k => [k, plain(latest)[k]]))); await cas(Role, role, rev, {}); try {
    return dto(await RoleVersion.create({ organizationId: ctx.organizationId, roleId: role._id, version: (latest?.version || 0) + 1, ...content, createdBy: ctx.actor }));
}
catch (e) {
    if (e.code === 11000)
        throw new DomainError(409, 'REVISION_CONFLICT', 'A new version was already created. Reload.');
    throw e;
} }
async function updateRoleVersion(org, roleId, versionId, input, rev) { const role = await find(Role, org, roleId); if (role.archivedAt)
    throw new DomainError(409, 'ARCHIVED', 'Archived roles cannot be edited.'); const version = await find(RoleVersion, org, versionId, { roleId: role._id }); if (version.status !== 'draft')
    throw new DomainError(409, 'IMMUTABLE_VERSION', 'Create a new version to change published content.'); const content = roleContent({ ...Object.fromEntries(roleKeys.map(k => [k, plain(version)[k]])), ...input }); cleanObject(input, roleKeys); return dto(await cas(RoleVersion, version, rev, content, { status: 'draft' })); }
async function roleSources(org, role, publish = false) { const sources = []; for (const c of role.criteria) {
    const version = await find(c.sourceType === 'strategy' ? Strategy : FrameworkVersion, org, c.strategyVersionId || c.frameworkVersionId, { status: 'published' });
    if (c.sourceType !== 'strategy' && version.sourceType !== c.sourceType)
        invalid('The source does not match this framework.', 'criteria');
    const criterion = version.criteria.find(x => x.id === c.criterionId);
    if (!criterion)
        invalid('Choose a criterion in the selected source version.', 'criteria');
    if (c.expectedLevelId && !criterion.levelIds.includes(c.expectedLevelId))
        invalid('The expected level does not belong to this criterion.', 'criteria');
    if (publish && c.required && !c.expectedLevelId && !c.evaluationTarget)
        invalid('Choose an expected level or numeric target.', 'criteria');
    sources.push({ criterion, version: plain(version), mapping: c });
} return sources; }
async function publishRole(ctx, roleId, versionId, rev) { const role = await find(Role, ctx.organizationId, roleId); if (role.archivedAt)
    throw new DomainError(409, 'ARCHIVED', 'Archived roles cannot be published.'); const version = await find(RoleVersion, ctx.organizationId, versionId, { roleId: role._id }); if (version.status !== 'draft')
    throw new DomainError(409, 'IMMUTABLE_VERSION', 'This version is already published.'); const content = roleContent(Object.fromEntries(roleKeys.map(k => [k, plain(version)[k]]))); await roleSources(ctx.organizationId, content, true); const published = await cas(RoleVersion, version, rev, { status: 'published', contentHash: hash(content), publishedAt: new Date(), publishedBy: ctx.actor }, { status: 'draft' }); await Role.updateOne({ _id: role._id, organizationId: ctx.organizationId, archivedAt: null }, { $set: { currentVersionId: published._id }, $inc: { revision: 1 } }); return dto(published); }
async function archiveRole(org, roleId, rev) { const role = await find(Role, org, roleId); if (role.archivedAt)
    throw new DomainError(409, 'ARCHIVED', 'This role is already archived.'); return dto(await cas(Role, role, rev, { archivedAt: new Date() })); }
async function getFramework(org, frameworkId) { const fw = await find(Framework, org, frameworkId); const versions = await FrameworkVersion.find({ organizationId: org, frameworkId: fw._id }).sort({ version: -1 }); return { ...dto(fw), versions: versions.map(dto), publishedVersion: dto(versions.find(v => String(v._id) === String(fw.currentVersionId))) }; }
async function createFramework(ctx, input, sourceDocumentId) { cleanObject(input, [...frameworkKeys, 'sourceType', 'description']); if (!['sfia', 'internal'].includes(input.sourceType))
    invalid('Choose Internal or SFIA.', 'sourceType'); const content = frameworkContent(Object.fromEntries(frameworkKeys.filter(k => input[k] !== undefined).map(k => [k, input[k]]))); if (sourceDocumentId) {
    const existing = await Framework.findOne({ _id: sourceDocumentId, organizationId: ctx.organizationId });
    if (existing) {
        const detail = await getFramework(ctx.organizationId, String(existing._id));
        const draft = detail.versions.find(v => v.status === 'draft');
        if (!draft || hash(frameworkContent(Object.fromEntries(frameworkKeys.map(k => [k, draft[k]])))) !== hash(content))
            throw new DomainError(409, 'IMPORT_ALREADY_CONFIRMED', 'This import already created different framework details.');
        return { ...detail, draftVersion: draft };
    }
} const fw = await Framework.create({ ...(sourceDocumentId ? { _id: sourceDocumentId } : {}), organizationId: ctx.organizationId, name: content.name, slug: slug(content.name), sourceType: input.sourceType, description: text(input.description, 'description'), licenseProvenance: content.licenseProvenance, createdBy: ctx.actor }); try {
    const version = await FrameworkVersion.create({ organizationId: ctx.organizationId, frameworkId: fw._id, version: 1, sourceType: fw.sourceType, ...content, createdBy: ctx.actor });
    return { ...dto(fw), versions: [dto(version)], draftVersion: dto(version) };
}
catch (e) {
    await Framework.deleteOne({ _id: fw._id });
    throw e;
} }
async function updateFramework(org, frameworkId, input, rev) { cleanObject(input, ['name', 'description', 'licenseProvenance']); const fw = await find(Framework, org, frameworkId); const update = {}; for (const k of Object.keys(input))
    update[k] = k === 'name' ? requiredText(input[k], k, 200) : text(input[k], k); return dto(await cas(Framework, fw, rev, update)); }
async function newFrameworkVersion(ctx, frameworkId, input, rev) { const fw = await find(Framework, ctx.organizationId, frameworkId); if (await FrameworkVersion.exists({ organizationId: ctx.organizationId, frameworkId: fw._id, status: 'draft' }))
    throw new DomainError(409, 'DRAFT_EXISTS', 'Edit the existing draft first.'); const latest = await FrameworkVersion.findOne({ organizationId: ctx.organizationId, frameworkId: fw._id }).sort({ version: -1 }); const content = frameworkContent(Object.keys(input).length ? input : Object.fromEntries(frameworkKeys.map(k => [k, plain(latest)[k]]))); await cas(Framework, fw, rev, {}); try {
    return dto(await FrameworkVersion.create({ organizationId: ctx.organizationId, frameworkId: fw._id, sourceType: fw.sourceType, version: (latest?.version || 0) + 1, ...content, createdBy: ctx.actor }));
}
catch (e) {
    if (e.code === 11000)
        throw new DomainError(409, 'REVISION_CONFLICT', 'A new version was already created.');
    throw e;
} }
async function updateFrameworkVersion(org, frameworkId, versionId, input, rev) { const fw = await find(Framework, org, frameworkId); const version = await find(FrameworkVersion, org, versionId, { frameworkId: fw._id }); if (version.status !== 'draft')
    throw new DomainError(409, 'IMMUTABLE_VERSION', 'Create a new version to edit published content.'); cleanObject(input, frameworkKeys); const content = frameworkContent({ ...Object.fromEntries(frameworkKeys.map(k => [k, plain(version)[k]])), ...input }); return dto(await cas(FrameworkVersion, version, rev, content, { status: 'draft' })); }
async function publishFramework(ctx, frameworkId, versionId, rev) { const fw = await find(Framework, ctx.organizationId, frameworkId); const version = await find(FrameworkVersion, ctx.organizationId, versionId, { frameworkId: fw._id }); if (version.status !== 'draft')
    throw new DomainError(409, 'IMMUTABLE_VERSION', 'This version is already published.'); const content = frameworkContent(Object.fromEntries(frameworkKeys.map(k => [k, plain(version)[k]]))); if (!content.criteria.length || !content.levels.length)
    invalid('Add criteria and native level descriptions before publication.'); if (fw.sourceType === 'sfia' && !content.licenseProvenance)
    invalid('Record lawful SFIA source and licence provenance.', 'licenseProvenance'); const result = await cas(FrameworkVersion, version, rev, { status: 'published', contentHash: hash({ ...content, sourceType: fw.sourceType }), publishedBy: ctx.actor, publishedAt: new Date() }, { status: 'draft' }); await Framework.updateOne({ _id: fw._id, organizationId: ctx.organizationId }, { $set: { currentVersionId: result._id }, $inc: { revision: 1 } }); return dto(result); }
async function authorizeSource(req, ctx, sourceRef) { if (sourceRef === undefined || sourceRef === null)
    return sourceRef; cleanObject(sourceRef, ['type', 'id']); if (sourceRef.type !== 'okr')
    invalid('Only authorised existing goals may be linked.', 'sourceRef'); const goal = await require('../../models/OKR').findOne({ _id: id(sourceRef.id), organizationId: ctx.organizationId }); if (!goal)
    throw new DomainError(404, 'NOT_FOUND', 'The source objective was not found.'); if (!require('../goalPermissionService').canViewGoal(req, goal))
    throw new DomainError(403, 'FORBIDDEN', 'You cannot access this objective.'); return { type: 'okr', id: String(goal._id), capturedAt: new Date().toISOString(), contentHash: hash({ title: goal.title, description: goal.description }), title: goal.title }; }
async function createStrategy(ctx, input, req) { const content = frameworkContent(input, true); content.sourceRef = await authorizeSource(req, ctx, input.sourceRef); const sid = new mongoose.Types.ObjectId(); return dto(await Strategy.create({ _id: sid, organizationId: ctx.organizationId, strategyId: sid, version: 1, ...content, createdBy: ctx.actor })); }
async function newStrategyVersion(ctx, strategyId, input, rev, req) { const latest = await Strategy.findOne({ organizationId: ctx.organizationId, strategyId: id(strategyId) }).sort({ version: -1 }); if (!latest)
    throw new DomainError(404, 'NOT_FOUND', 'Strategy not found.'); if (latest.status === 'draft')
    throw new DomainError(409, 'DRAFT_EXISTS', 'Edit the existing draft first.'); const content = frameworkContent(Object.keys(input).length ? input : Object.fromEntries(strategyKeys.filter(k => k !== 'sourceRef').map(k => [k, plain(latest)[k]])), true); content.sourceRef = await authorizeSource(req, ctx, Object.keys(input).length ? input.sourceRef : latest.sourceRef ? {type:'okr',id:latest.sourceRef.id} : undefined); if (latest.revision !== rev)
    throw new DomainError(409, 'REVISION_CONFLICT', 'This strategy changed. Reload before saving.'); try {
    return dto(await Strategy.create({ organizationId: ctx.organizationId, strategyId: latest.strategyId, version: latest.version + 1, ...content, createdBy: ctx.actor }));
}
catch (e) {
    if (e.code === 11000)
        throw new DomainError(409, 'REVISION_CONFLICT', 'This version changed. Reload.');
    throw e;
} }
async function updateStrategyVersion(ctx, strategyId, versionId, input, rev, req) { const version = await find(Strategy, ctx.organizationId, versionId, { strategyId: id(strategyId) }); if (version.status !== 'draft')
    throw new DomainError(409, 'IMMUTABLE_VERSION', 'Create a new version to edit published content.'); cleanObject(input, strategyKeys); const existing = Object.fromEntries(strategyKeys.filter(k => k !== 'sourceRef').map(k => [k, plain(version)[k]])); const content = frameworkContent({ ...existing, ...input }, true); if (input.sourceRef !== undefined)
    content.sourceRef = await authorizeSource(req, ctx, input.sourceRef); return dto(await cas(Strategy, version, rev, content, { status: 'draft' })); }
async function publishStrategy(ctx, strategyId, versionId, rev) { const version = await find(Strategy, ctx.organizationId, versionId, { strategyId: id(strategyId) }); if (version.status !== 'draft')
    throw new DomainError(409, 'IMMUTABLE_VERSION', 'This strategy version is already published.'); if (!version.criteria.length)
    invalid('Add at least one strategy assessment criterion.', 'criteria'); const content = Object.fromEntries(strategyKeys.map(k => [k, plain(version)[k]])); return dto(await cas(Strategy, version, rev, { status: 'published', contentHash: hash(content), publishedAt: new Date(), publishedBy: ctx.actor }, { status: 'draft' })); }
function cycleContent(input) { cleanObject(input, cycleKeys); const out = { ...require('./cyclePolicy').setup(input), name: requiredText(input.name, 'name', 200) }; cleanObject(input.period || {}, ['start', 'end']); out.period = { start: text(input.period?.start, 'period.start', 40), end: text(input.period?.end, 'period.end', 40) }; if (out.period.start && (!Number.isFinite(Date.parse(out.period.start)) || !Number.isFinite(Date.parse(out.period.end)) || out.period.start > out.period.end))
    invalid('Choose a valid assessment period.', 'period'); out.selectedInputTypes = unique(arr(input.selectedInputTypes || [], 'selectedInputTypes', 3), 'selectedInputTypes'); if (out.selectedInputTypes.some(v => !['sfia', 'internal', 'strategy'].includes(v)))
    invalid('Choose valid assessment inputs.', 'selectedInputTypes'); for (const k of ['frameworkVersionIds', 'strategyVersionIds', 'roleVersionIds'])
    out[k] = unique(arr(input[k] || [], k).map(id), k); out.scoringConfig = input.scoringConfig || null; out.rankingConfig = input.rankingConfig || { enabled: false }; return out; }
async function createCycle(ctx, input) { require('./cyclePolicy').assertCreate(ctx); await require('./cyclePolicy').assertFeature(ctx, input); return dto(await Cycle.create({ organizationId: ctx.organizationId, ...cycleContent(input), configurationScope: ctx.organizationWide ? 'organization' : 'managed_teams', createdBy: ctx.actor })); }
async function updateCycle(org, cycleId, input, rev) { cleanObject(input, cycleKeys); const cycle = await find(Cycle, org, cycleId); if (cycle.status !== 'draft')
    throw new DomainError(409, 'IMMUTABLE_CYCLE', 'Create a new cycle to change published configuration.'); const content = cycleContent({ ...Object.fromEntries(cycleKeys.map(k => [k, plain(cycle)[k]])), ...input }); return dto(await cas(Cycle, cycle, rev, content, { status: 'draft' })); }
async function validateCycle(org, cycle) {
    const c = plain(cycle);
    const setup = require('./cyclePolicy').setup(c);
    if (setup.reviewMode !== 'competency') require('./cyclePolicy').regularWorkflow(c);
    if (!c.period?.start || !c.period?.end || !Number.isFinite(Date.parse(c.period.start)) || !Number.isFinite(Date.parse(c.period.end)) || c.period.start > c.period.end) invalid('Choose a valid assessment period.', 'period');
    if (setup.reviewMode === 'regular') {
        if (c.selectedInputTypes?.length || c.frameworkVersionIds?.length || c.strategyVersionIds?.length || c.roleVersionIds?.length || c.rankingConfig?.enabled) invalid('Regular appraisals do not use role frameworks or competency ranking. Choose combined to include them.');
        return { valid: true, selectedInputTypes: [], frameworks: [], strategies: [], roles: [], scoringConfig: null, rankingConfig: { enabled: false } };
    }
    validateSources(c.selectedInputTypes);
    const scoringConfig = validateScoring(c.scoringConfig, c.selectedInputTypes);
    const rankingConfig = validateRanking(c.rankingConfig);
    if (!c.period.start || !c.period.end)
        invalid('Choose an assessment period.', 'period');
    if (!c.roleVersionIds.length)
        invalid('Choose at least one published role.', 'roleVersionIds');
    const frameworks = [];
    for (const vid of c.frameworkVersionIds) {
        const version = await find(FrameworkVersion, org, vid, { status: 'published' });
        if (!c.selectedInputTypes.includes(version.sourceType))
            invalid('Remove unselected framework source references.', 'frameworkVersionIds');
        frameworks.push(dto(version));
    }
    const strategies = [];
    for (const vid of c.strategyVersionIds) {
        const version = await find(Strategy, org, vid, { status: 'published' });
        if (!c.selectedInputTypes.includes('strategy'))
            invalid('Remove unselected strategy references.', 'strategyVersionIds');
        strategies.push(dto(version));
    }
    for (const source of c.selectedInputTypes) {
        if (source === 'strategy' ? !strategies.length : !frameworks.some(f => f.sourceType === source))
            invalid(`Choose a published ${source} source version.`, 'selectedInputTypes');
    }
    const allSources = [...frameworks, ...strategies.map(v => ({ ...v, sourceType: 'strategy' }))];
    const roles = [];
    for (const vid of c.roleVersionIds) {
        const role = await find(RoleVersion, org, vid, { status: 'published' });
        const aggregate = await find(Role, org, role.roleId);
        if (aggregate.archivedAt)
            invalid('Archived roles cannot be assigned to new assessments.', 'roleVersionIds');
        await roleSources(org, role, true);
        const mapped = role.criteria.filter(x => c.selectedInputTypes.includes(x.sourceType));
        if (!mapped.length)
            invalid('This role needs expectations for the selected sources.', 'roleVersionIds');
        for (const source of c.selectedInputTypes)
            if (!mapped.some(x => x.sourceType === source))
                invalid(`This role has no ${source} expectations.`, 'roleVersionIds');
        for (const mapping of mapped) {
            const sourceId = String(mapping.frameworkVersionId || mapping.strategyVersionId);
            const source = allSources.find(v => v.id === sourceId);
            if (!source)
                invalid('A role expectation references an unselected source version.', 'roleVersionIds');
            const rule = scoringConfig.normalization.find(n => n.sourceVersionId === sourceId && n.criterionId === mapping.criterionId);
            if (!rule)
                invalid('Configure one scoring conversion for every role criterion.', 'scoringConfig.normalization');
            const native = source.criteria.find(x => x.id === mapping.criterionId);
            if (rule.method === 'level_map') {
                if (mapping.evaluationTarget)
                    invalid('A numeric target needs a rating scale conversion.', 'scoringConfig.normalization');
                if (!native.levelIds.length || native.levelIds.some(l => rule.levelScores[l] === undefined) || Object.keys(rule.levelScores).some(l => !native.levelIds.includes(l)))
                    invalid('Map every native level explicitly, using this criterion only.', 'scoringConfig.normalization');
            }
            else {
                if (mapping.expectedLevelId)
                    invalid('A native-level target needs a level mapping.', 'scoringConfig.normalization');
                const scale = scoringConfig.ratingScales.find(s => s.id === rule.ratingScaleId);
                if (!mapping.evaluationTarget || mapping.evaluationTarget.scaleId !== scale?.id || mapping.evaluationTarget.value < scale.min || mapping.evaluationTarget.value > scale.max)
                    invalid('Choose an expected target within this criterion rating scale.', 'roleVersionIds');
            }
        }
        for (const source of c.selectedInputTypes)
            validateWeights(Object.fromEntries(mapped.filter(x => x.sourceType === source).map(x => [x.id, x.weight])), scoringConfig.weightMode, source + ' criterion weights');
        roles.push(dto(role));
    }
    const validPairs = new Set(allSources.flatMap(s => s.criteria.map(c => `${s.id}:${c.id}`)));
    if (scoringConfig.normalization.some(n => !validPairs.has(`${n.sourceVersionId}:${n.criterionId}`)))
        invalid('Remove normalization rules for unselected or missing criteria.', 'scoringConfig.normalization');
    return { valid: true, selectedInputTypes: [...c.selectedInputTypes], frameworks, strategies, roles, scoringConfig, rankingConfig, formula: 'sum(sourceScore × sourceWeight) / sum(sourceWeight)' };
}
async function publishCycle(ctx, cycleId, rev) { const cycle = await find(Cycle, ctx.organizationId, cycleId); require('./cyclePolicy').assertManage(ctx, cycle); await require('./cyclePolicy').assertFeature(ctx, cycle); if (cycle.status !== 'draft')
    throw new DomainError(409, 'IMMUTABLE_CYCLE', 'This cycle is already published.'); const valid = await validateCycle(ctx.organizationId, cycle); const definitionHash = hash({ ...require('./cyclePolicy').setup(cycle), period: plain(cycle).period, selectedInputTypes: valid.selectedInputTypes, roles: valid.roles.map(r => ({ versionId: r.versionId, contentHash: r.contentHash })), frameworks: valid.frameworks.map(f => ({ id: f.id, contentHash: f.contentHash })), strategies: valid.strategies.map(s => ({ id: s.id, contentHash: s.contentHash })), scoringConfig: valid.scoringConfig, rankingConfig: valid.rankingConfig }); return dto(await cas(Cycle, cycle, rev, { status: 'published', scoringConfig: valid.scoringConfig, rankingConfig: valid.rankingConfig, definitionHash, publishedAt: new Date(), publishedBy: ctx.actor }, { status: 'draft' })); }
async function getPublishedDefinition({ organizationId, cycleId, cycleRevision, roleVersionId }) { const cycle = await find(Cycle, organizationId, cycleId, { status: 'published' }); if (cycle.revision !== cycleRevision)
    throw new DomainError(409, 'REVISION_CONFLICT', 'Cycle configuration changed. Review it before starting.'); if (!cycle.roleVersionIds.includes(String(roleVersionId)))
    invalid('Choose a role included in this cycle.', 'roleVersionId'); const valid = await validateCycle(organizationId, cycle); const role = valid.roles.find(r => r.versionId === String(roleVersionId)); const sources = [...valid.frameworks, ...valid.strategies.map(s => ({ ...s, sourceType: 'strategy' }))]; const criteria = role.criteria.filter(c => valid.selectedInputTypes.includes(c.sourceType)).map(c => { const source = sources.find(s => s.id === String(c.frameworkVersionId || c.strategyVersionId)); const native = source.criteria.find(n => n.id === c.criterionId); const expected = source.levels.find(l => l.id === c.expectedLevelId); return { ...c, name: native.name, code: native.code, description: native.description, sourceVersionId: source.id, sourceName: source.name || source.title, nativeCriterionId: native.id, levelIds: native.levelIds, levels: source.levels.filter(l => native.levelIds.includes(l.id)), expectedLevel: expected || null }; }); const snapshot = { role, selectedInputTypes: valid.selectedInputTypes, frameworks: valid.frameworks, strategies: valid.strategies, criteria, scoringConfig: valid.scoringConfig, rankingConfig: valid.rankingConfig }; return { ...snapshot, definitionHash: hash(definitionContent(snapshot)), cycleId: String(cycle._id), cycleVersion: cycle.version, cycleRevision: cycle.revision }; }
async function createImport(ctx, file, purpose) { if (!['role', 'framework'].includes(purpose))
    invalid('Choose role or framework import.', 'purpose'); const safe = await files.inspectAndScan({ buffer: file.buffer, originalName: file.originalname, mimeType: file.mimetype, purpose }); let extracted; try {
    extracted = await files.extractText(file.buffer, safe.extension);
}
catch (error) {
    if (error.code !== 'UNREADABLE_FILE')
        throw error;
    extracted = { text: '', warnings: ['We could not read this document. Continue manually.'], failed: true };
} const key = await files.storePrivate(file.buffer); try {
    const name = extracted.text.split(/\r?\n/).find(s => s.trim())?.trim().slice(0, 200) || '';
    const draft = purpose === 'role' ? { name, description: extracted.text.slice(0, 10000), responsibilities: [], requirements: [], criteria: [] } : { name, sourceType: 'internal', criteria: [], levels: [], source: 'Uploaded document; human review required', licenseProvenance: '' };
    return importDTO(await Import.create({ organizationId: ctx.organizationId, purpose, originalName: String(file.originalname).replace(/[\r\n]/g, '').slice(0, 255), mimeType: safe.mimeType, size: safe.size, sha256: safe.sha256, storageKey: key, scanner: safe.scanner, extractionStatus: extracted.failed ? 'failed' : 'ready', extractedText: extracted.text, extractedDraft: draft, warnings: ['Review the draft before saving. No expectations or levels were inferred.', ...extracted.warnings], createdBy: ctx.actor }));
}
catch (e) {
    await files.deletePrivate(key);
    throw e;
} }
function importDTO(doc) { const { storageKey, ...rest } = dto(doc); return rest; }
async function getImport(org, importId) { return importDTO(await find(Import, org, importId)); }
async function importSource(org, importId) { const doc = await find(Import, org, importId); if (!doc.scanner?.provider)
    throw new DomainError(409, 'UNSCANNED_FILE', 'The source file is not available.'); return { buffer: await files.readPrivate(doc.storageKey), originalName: doc.originalName, mimeType: doc.mimeType }; }
async function confirmImport(ctx, importId, input) {
    cleanObject(input, ['reviewed', 'draft']);
    if (input.reviewed !== true)
        invalid('Confirm that you have reviewed these details.', 'reviewed');
    const doc = await find(Import, ctx.organizationId, importId);
    const confirmationHash = hash(input.draft);
    if (doc.confirmedAt) {
        if (doc.confirmationHash !== confirmationHash)
            throw new DomainError(409, 'IMPORT_ALREADY_CONFIRMED', 'This import has already created a different reviewed draft.');
        const detail = doc.purpose === 'role' ? await getRole(ctx.organizationId, doc.targetId) : await getFramework(ctx.organizationId, doc.targetId);
        return { ...detail, draftVersion: detail.versions.find(v => v.id === String(doc.targetVersionId)) };
    }
    const lease = await Import.findOneAndUpdate({ _id: doc._id, organizationId: ctx.organizationId, confirmedAt: null, $or: [{ confirmationLeaseUntil: null }, { confirmationLeaseUntil: { $lt: new Date() } }] }, { $set: { confirmationHash, confirmationLeaseUntil: new Date(Date.now() + 30000) } }, { new: true });
    if (!lease)
        throw new DomainError(409, 'IMPORT_CONFIRMING', 'This reviewed draft is being saved. Check its result before retrying.');
    try {
        // Import ID also identifies its target aggregate, making a lease retry after a process crash resumable.
        const result = doc.purpose === 'role' ? await createRole(ctx, input.draft, doc._id) : await createFramework(ctx, input.draft, doc._id);
        const target = result.draftVersion;
        await Import.updateOne({ _id: doc._id, organizationId: ctx.organizationId, confirmationHash }, { $set: { confirmedBy: ctx.actor, confirmedAt: new Date(), targetId: result.id, targetVersionId: target.id }, $unset: { confirmationLeaseUntil: 1 }, $inc: { revision: 1 } });
        return result;
    }
    catch (error) {
        await Import.updateOne({ _id: doc._id, organizationId: ctx.organizationId, confirmationHash, confirmedAt: null }, { $unset: { confirmationLeaseUntil: 1 } });
        throw error;
    }
}
module.exports = { dto, list, find, getRole, createRole, updateRole, newRoleVersion, updateRoleVersion, publishRole, archiveRole, getFramework, createFramework, updateFramework, newFrameworkVersion, updateFrameworkVersion, publishFramework, createStrategy, newStrategyVersion, updateStrategyVersion, publishStrategy, createCycle, updateCycle, validateCycle, publishCycle, getPublishedDefinition, createImport, getImport, importSource, confirmImport, roleContent, frameworkContent, cycleContent };
