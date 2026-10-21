'use strict';

const Assessment = require('../models/CompetencyAssessment');
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const final = appraisal => ['completed', 'employee_acknowledged'].includes(appraisal.status);

// A final appraisal must keep the role result used by its reviewer, even if the
// assessment is subsequently reopened. Older appraisals resolve by publication
// cutoff, never by today's currentResultNumber or mutable draft findings.
function resolve(appraisal, assessment) {
  if (!assessment || String(assessment.organizationId) !== String(appraisal.organizationId)
    || String(assessment.appraisalId) !== String(appraisal._id)
    || String(assessment.participant?.userId) !== String(appraisal.employee?.userId)) return null;
  const reference = appraisal.competencyResultReference;
  if (final(appraisal) && reference?.assessmentId) {
    if (reference.assessmentId !== String(assessment._id)) return null;
    return assessment.results?.find(result => result.number === reference.number && result.reportHash === reference.reportHash) || null;
  }
  if (final(appraisal)) {
    const cutoff = Date.parse(appraisal.finalRating?.finalizedAt);
    if (!Number.isFinite(cutoff)) return null;
    return (assessment.results || []).filter(result => {
      const publishedAt = Date.parse(result.dates?.finalisedAt || result.finalClassification?.finalisedAt);
      return Number.isFinite(publishedAt) && publishedAt <= cutoff;
    }).sort((a, b) => b.number - a.number)[0] || null;
  }
  return assessment.status === 'published' ? assessment.results?.find(result => result.number === assessment.currentResultNumber) || null : null;
}

function summary(assessment, result) {
  const definition = assessment.definitionSnapshot;
  return {
    state: 'published', assessmentId: String(assessment._id), resultVersion: result.number, reportHash: result.reportHash,
    cycleId: assessment.cycleId, cycleVersion: assessment.cycleVersion, occurrenceKey: assessment.occurrenceKey,
    period: definition.period, role: definition.role, publishedAt: result.dates?.finalisedAt,
    overallScore: finite(result.score?.overallScore), classification: result.finalClassification?.label || '',
    coverage: { assessed: result.score?.coverage?.assessed ?? 0, selected: definition.criteria.length },
    sources: (result.score?.sourceScores || []).map(source => ({ type: source.sourceType, score: finite(source.score), weight: finite(source.effectiveWeight) })),
    criteria: definition.criteria.map(criterion => {
      const finding = result.findings?.find(item => item.criterionId === criterion.id);
      const measured = result.score?.criterionScores?.find(item => item.criterionId === criterion.id);
      const native = level => typeof level === 'string' ? level : level?.label;
      return { id: criterion.id, name: criterion.name, sourceType: criterion.sourceType, sourceName: criterion.sourceName,
        sourceVersionId: criterion.sourceVersionId, status: finding?.status || 'not_started',
        expected: native(criterion.expectedLevel) || criterion.levels?.find(level => level.id === criterion.expectedLevelId)?.label
          || (finite(criterion.evaluationTarget?.value) !== null ? String(criterion.evaluationTarget.value) : null),
        observed: finding?.status === 'assessed' ? criterion.levels?.find(level => level.id === finding.observedLevelId)?.label
          || (finite(finding.rating) !== null ? String(finding.rating) : null) : null,
        score: finite(measured?.score), weight: finite(measured?.effectiveWeight), rationale: finding?.rationale || '' };
    })
  };
}

async function forViewer(req, appraisal) {
  const assessment = await Assessment.findOne({ organizationId: String(appraisal.organizationId), appraisalId: String(appraisal._id), 'participant.userId': String(appraisal.employee.userId) }).lean();
  if (!assessment) return appraisal.cycleConfigurationSnapshot?.roleDefinition ? { state: 'unavailable' } : null;
  const auth = require('./competency/authorizationService');
  let ctx;
  try { ctx = await auth.context(req); } catch (error) { if (error instanceof require('../contracts/competency').DomainError) return { state: 'unavailable' }; throw error; }
  if (!auth.canAccessAssessment(ctx, assessment, 'report.view')) return { state: 'unavailable' };
  const result = resolve(appraisal, assessment);
  return result ? summary(assessment, result) : { state: 'unavailable' };
}

module.exports = { resolve, summary, forViewer };
