'use strict';
// Original organisation role profiles mapped to SFIA 9 references. This is a
// tailored six-skill subset, not a reproduction of the complete SFIA catalogue.
// --apply requires recorded permission covering the intended use/organisation.
const mongoose = require('mongoose');
const library = require('../services/competency/libraryService');
const { hash, validateScoring, validateRanking } = require('../contracts/competency');
const skills = [
  ['ARCH', 'Solution architecture', 4, 6, 5, 'solution-architecture', 'Present a solution decision record, alternatives, constraints, security and operability considerations, and the measured consequences of your decisions.'],
  ['PROD', 'Product management', 2, 6, 5, 'product-management', 'Explain an outcome-based roadmap decision, the user evidence behind it, the options rejected, and how delivery changed the intended product outcome.'],
  ['REQM', 'Requirements definition and management', 2, 6, 4, 'requirements-definition-and-management', 'Show how needs became testable requirements, how priorities and changes were agreed, and how acceptance evidence traces back to the original need.'],
  ['RLMT', 'Stakeholder relationship management', 4, 7, 5, 'stakeholder-relationship-management', 'Provide an engagement plan and an example of resolving competing stakeholder interests, recording commitments and checking whether agreed outcomes were achieved.'],
  ['FEAS', 'Feasibility assessment', 2, 6, 4, 'feasibility-assessment', 'Compare realistic options using assumptions, costs, risks, dependencies and expected benefits; explain which evidence changed the recommendation.'],
  ['MEAS', 'Measurement', 2, 6, 4, 'measurement', 'Define the baseline, measure, data quality checks and outcome; explain how the results informed the next decision rather than only reporting activity.'],
];
const range = (min, max) => Array.from({ length: max - min + 1 }, (_, index) => index + min);
const levelDescriptions = [
  'Completes defined basic tasks with close oversight and develops foundational skills.',
  'Assists with routine work, applies learned practices and seeks guidance for unfamiliar situations.',
  'Delivers assigned work independently within agreed methods and resolves familiar operational problems.',
  'Owns substantial work within an agreed scope, handles complexity and supports the work of others.',
  'Accepts responsibility for significant outcomes, provides domain guidance and coordinates contributions across stakeholders.',
  'Shapes policy and major programmes, influences multiple teams and takes responsibility for broad organisational outcomes.',
  'Sets organisational direction and mobilises the partnerships, resources and governance needed to deliver it.',
];
const roleProfiles = [
  { name: 'Solution Architect (SFIA 9)', codes: ['ARCH', 'REQM', 'RLMT', 'FEAS', 'MEAS'], description: 'Own solution decisions and their traceability to business outcomes, delivery constraints and operational evidence.', responsibilities: ['Document boundaries, alternatives, dependencies and architecture trade-offs.', 'Trace functional and non-functional requirements through delivery and verification.', 'Align stakeholders on decisions and unresolved risks.', 'Evaluate security, operability, cost and implementation feasibility.', 'Measure whether delivered solutions achieve their intended outcomes.'] },
  { name: 'Product Manager (SFIA 9)', codes: ['PROD', 'REQM', 'RLMT', 'FEAS', 'MEAS'], description: 'Define product outcomes, prioritise work using evidence and evaluate the value delivered across the product lifecycle.', responsibilities: ['Maintain an outcome-based product roadmap.', 'Translate validated needs into requirements and acceptance criteria.', 'Negotiate priorities, dependencies and stakeholder commitments.', 'Test assumptions, feasibility and value before major investment.', 'Use adoption, quality and outcome measures to adjust product decisions.'] },
];
function frameworkInput(licenseProvenance) {
  return { name: 'SFIA 9 — Architecture and Product role references', sourceType: 'sfia',
    source: 'SFIA Foundation, SFIA 9. Tailored role reference subset. Skill codes/native ranges checked 21 October 2026. Descriptions and evidence prompts are original summaries, not official SFIA descriptors. Consult https://sfia-online.org/en/sfia-9 and each criterion reference for the authoritative skill-specific level descriptions.',
    licenseProvenance,
    levels: range(1, 7).map(number => ({ id: `sfia-${number}`, label: `SFIA level ${number}`, order: number, description: `${levelDescriptions[number - 1]} Original summary; use the official SFIA 9 responsibility and skill-specific descriptors when assessing. https://sfia-online.org/en/sfia-9/responsibilities` })),
    criteria: skills.map(([code, name, min, max, , slug, evidence]) => ({ id: code.toLowerCase(), code, name, description: `Organisation evidence prompt: ${evidence} Official SFIA 9 skill and native level descriptions: https://sfia-online.org/en/sfia-9/skills/${slug}`, levelIds: range(min, max).map(level => `sfia-${level}`) })),
  };
}
function roleInput(profile, frameworkVersionId) {
  return { name: profile.name, description: profile.description,
    responsibilities: profile.responsibilities.map((text, index) => ({ id: `responsibility-${index + 1}`, text })),
    requirements: [{ id: 'evidence', text: 'Demonstrate work performed in the review period using attributable evidence and explain individual contribution.', required: true }, { id: 'judgement', text: 'Explain decisions, alternatives, constraints and the effect on the intended outcome.', required: true }],
    criteria: profile.codes.map((code, index) => ({ id: `${profile.codes[0].toLowerCase()}-${code.toLowerCase()}`, sourceType: 'sfia', frameworkVersionId, criterionId: code.toLowerCase(), expectedLevelId: `sfia-${skills.find(skill => skill[0] === code)[4]}`, weight: 1, required: true, evidenceRequired: true, rationaleRequired: true, responsibilityIds: [`responsibility-${index + 1}`], requirementIds: ['evidence', 'judgement'] })),
  };
}
function cycleInput(frameworkVersionId, roleVersionIds) {
  return { name: 'SFIA role competency reviews', reviewMode: 'competency', cadence: { type: 'periodic', frequency: 'quarterly' }, period: { start: '2026-07-01', end: '2026-09-30' }, selectedInputTypes: ['sfia'], frameworkVersionIds: [frameworkVersionId], strategyVersionIds: [], roleVersionIds,
    scoringConfig: { version: 1, method: 'weighted_mean', weightMode: 'relative', inputWeights: { sfia: 1 }, ratingScales: [],
      // Explicit attainment policy: native levels below the role target = 0;
      // target or above = 100. Never treat ordinal levels as interval ratings.
      normalization: skills.map(([code, , min, max, target]) => ({ sourceVersionId: frameworkVersionId, criterionId: code.toLowerCase(), method: 'level_map', levelScores: Object.fromEntries(range(min, max).map(level => [`sfia-${level}`, level >= target ? 100 : 0])) })),
      thresholds: [{ id: 'development', label: 'Development priorities identified', minInclusive: 0, maxExclusive: 80 }, { id: 'broadly_met', label: 'Role expectations broadly met', minInclusive: 80, maxInclusive: 100 }], missingPolicy: 'block_unless_authorised_exception', exceptionPolicy: 'retain_as_unscored' }, rankingConfig: { enabled: false } };
}
async function configure(organizationId, licenseProvenance, apply = false) {
  if (!mongoose.isValidObjectId(organizationId)) throw new Error('A confirmed organisation ID is required.');
  if (!licenseProvenance?.trim()) throw new Error('Record SFIA permission/provenance covering this organisation and intended application use before publication.');
  if (!apply) return { dryRun: true, organizationId, framework: frameworkInput(licenseProvenance), roles: roleProfiles.map(profile => ({ name: profile.name, expected: profile.codes.map(code => `${code} ${skills.find(skill => skill[0] === code)[4]}`) })), cycle: { name: 'SFIA role competency reviews', reviewMode: 'competency', schedule: 'quarterly', firstPeriod: '2026-07-01 to 2026-09-30' } };
  const ctx = { organizationId, organizationWide: true, actor: { userId: 'system:professional-role-configuration', name: 'Authorised professional role configuration' } };
  const Framework = require('../models/CompetencyFramework'), Version = require('../models/CompetencyFrameworkVersion'), Role = require('../models/CompetencyRole'), RoleVersion = require('../models/CompetencyRoleVersion'), Cycle = require('../models/CompetencyCycle');
  const fwInput = frameworkInput(licenseProvenance), { sourceType, ...content } = fwInput;
  const fwHash = hash({ ...library.frameworkContent(content), sourceType });
  let framework = await Framework.findOne({ organizationId, name: fwInput.name, archivedAt: null }).lean(), version;
  if (framework?.currentVersionId) { version = library.dto(await Version.findOne({ _id: framework.currentVersionId, organizationId, status: 'published' })); if (version?.contentHash !== fwHash) throw new Error('Existing framework differs; review it instead of overwriting.'); }
  else {
    if (!framework) framework = await library.createFramework(ctx, fwInput);
    const draft = await Version.findOne({ organizationId, frameworkId: framework._id || framework.id, status: 'draft' });
    if (!draft || hash({ ...library.frameworkContent(Object.fromEntries(['name', 'criteria', 'levels', 'source', 'licenseProvenance'].map(key => [key, draft[key]]))), sourceType }) !== fwHash) throw new Error('Existing framework draft differs; review it before continuing.');
    version = await library.publishFramework(ctx, String(framework._id || framework.id), String(draft._id), draft.revision);
  }
  const roleVersions = [];
  for (const profile of roleProfiles) {
    const input = roleInput(profile, version.id), expectedHash = hash(library.roleContent(input));
    let role = await Role.findOne({ organizationId, name: input.name, archivedAt: null }).lean(), published;
    if (role?.currentVersionId) { published = library.dto(await RoleVersion.findOne({ _id: role.currentVersionId, organizationId, status: 'published' })); if (published?.contentHash !== expectedHash) throw new Error('Existing role differs; review it instead of overwriting.'); }
    else {
      if (!role) role = await library.createRole(ctx, input);
      const draft = await RoleVersion.findOne({ organizationId, roleId: role._id || role.id, status: 'draft' });
      if (!draft || hash(library.roleContent(Object.fromEntries(['name', 'description', 'responsibilities', 'requirements', 'criteria'].map(key => [key, draft[key]])))) !== expectedHash) throw new Error('Existing role draft differs; review it before continuing.');
      published = await library.publishRole(ctx, String(role._id || role.id), String(draft._id), draft.revision);
    }
    roleVersions.push(published.id);
  }
  const desired = cycleInput(version.id, roleVersions);
  let cycle = await Cycle.findOne({ organizationId, name: desired.name }).lean();
  if (cycle) {
    const keys = Object.keys(library.cycleContent(desired));
    const stored = library.cycleContent(Object.fromEntries(keys.map(key => [key, cycle[key]]))), expected = library.cycleContent(desired);
    expected.scoringConfig = validateScoring(expected.scoringConfig, expected.selectedInputTypes); expected.rankingConfig = validateRanking(expected.rankingConfig);
    const changed = keys.filter(key => hash(stored[key]) !== hash(expected[key]));
    if (changed.length) throw new Error(`Existing cycle differs in ${changed.join(', ')}; review it instead of overwriting.`);
  } else cycle = await library.createCycle(ctx, desired);
  if (cycle.status !== 'published') cycle = await library.publishCycle(ctx, String(cycle._id || cycle.id), cycle.revision);
  await require('../models/OrganizationFeatureConfig').updateOne({ organizationId }, { $set: { 'features.competencyAssessments': true, updatedBy: ctx.actor.userId }, $setOnInsert: { createdBy: ctx.actor.userId } }, { upsert: true });
  await require('../services/competency/authorizationService').audit(ctx, 'professional.roles.configured', 'cycle', String(cycle._id || cycle.id), { afterHash: cycle.definitionHash });
  return { organizationId, frameworkVersionId: version.id, roleVersionIds: roleVersions, cycleId: String(cycle._id || cycle.id), published: true, employeesAssigned: 0 };
}
if (require.main === module) (async () => {
  require('dotenv').config();
  const value = name => { const index = process.argv.indexOf(name); return index < 0 ? '' : process.argv[index + 1]; };
  const apply = process.argv.includes('--apply');
  if (apply) await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  try { console.log(JSON.stringify(await configure(value('--organization'), value('--license-provenance'), apply))); }
  finally { if (apply) await mongoose.disconnect(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { configure, frameworkInput, roleInput, cycleInput, roleProfiles };
