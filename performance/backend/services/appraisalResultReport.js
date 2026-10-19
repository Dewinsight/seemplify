const FINAL_STATUSES = new Set(['completed', 'employee_acknowledged']);

function publishedAnswers(appraisal, frozen) {
  const sections = frozen.workflowDefinition?.sections || [];
  return (appraisal.customResponses || []).filter((response) => response.submittedAt).flatMap((response) => {
    const section = sections.find((entry) => entry.id === response.sectionId);
    const question = section?.questions?.find((entry) => entry.id === response.questionId);
    if (!question) return [];
    const value = response.value;
    const answer = Array.isArray(value) ? value.filter((entry) => ['string', 'number', 'boolean'].includes(typeof entry)).join('; ')
      : ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : '';
    return [{ section: section.title, question: question.prompt, respondent: response.respondentRole, answer }];
  });
}

function resultReport(appraisal, cycle) {
  const frozen = appraisal.cycleConfigurationSnapshot || {};
  const published = FINAL_STATUSES.has(appraisal.status);
  const overall = appraisal.finalRating?.overall;
  const managerSubmitted = Boolean(appraisal.managerReview?.submittedAt);
  const submission = (appraisal.auditLog || []).filter(event => event.action === 'manager_review_submitted').at(-1);
  const feedbackAuthor = submission?.performedBy?.userId ? { userId: submission.performedBy.userId, name: submission.performedBy.name || 'Not recorded' } : null;
  return {
    id: String(appraisal._id),
    employee: { name: appraisal.employee?.name || '', jobTitle: appraisal.employee?.jobTitle || '', department: appraisal.employee?.department || '' },
    manager: { name: appraisal.manager?.name || '' },
    cycle: { name: frozen.cycleName || cycle?.name || 'Appraisal', periodStart: frozen.periodStart || cycle?.periodStart, periodEnd: frozen.periodEnd || cycle?.periodEnd },
    status: appraisal.status,
    published,
    finalRating: published ? { overall: typeof overall === 'number' && Number.isFinite(overall) ? overall : null, ratingLabel: appraisal.finalRating?.ratingLabel || '', justification: appraisal.finalRating?.justification || '', finalizedAt: appraisal.finalRating?.finalizedAt || null } : null,
    ratingScale: frozen.ratingScale || cycle?.ratingScale || { min: 1, max: 5 },
    employeeReflection: appraisal.selfAssessment?.submittedAt ? appraisal.selfAssessment.overallSummary : null,
    managerSummary: published && managerSubmitted ? appraisal.managerReview?.overallSummary : null,
    managerFeedback: published && managerSubmitted ? {
      author: feedbackAuthor,
      submittedAt: appraisal.managerReview.submittedAt,
      overallRating: Number.isFinite(appraisal.managerReview.overallManagerRating) ? appraisal.managerReview.overallManagerRating : null,
      goals: (appraisal.managerReview.okrAssessment || []).map(goal => ({ id: goal.okrId ? String(goal.okrId) : null, title: goal.okrTitle || 'Goal', comments: goal.managerComments || '', verifiedCompletion: goal.managerVerifiedCompletion ?? null, qualityRating: goal.qualityRating ?? null }))
    } : null,
    discussion: published ? appraisal.discussion?.notes : null,
    acknowledgedAt: appraisal.discussion?.employeeAcknowledgedAt || null,
    competencies: published && managerSubmitted ? (appraisal.managerReview?.competencyRatings || []).map((rating) => ({
      name: rating.competencyName || rating.competencyId || 'Competency',
      managerRating: Number.isFinite(rating.managerRating) ? rating.managerRating : null,
      managerComments: rating.managerComments || '',
      selfRating: appraisal.selfAssessment?.competencyRatings?.find((self) => self.competencyId === rating.competencyId)?.selfRating ?? null
    })) : [],
    answers: published ? publishedAnswers(appraisal, frozen) : [],
    goals: published ? (appraisal.goalSnapshots || []).map((goal) => ({ title: goal.definition?.title || 'Goal', score: goal.achievement?.rated && Number.isFinite(goal.achievement.score) ? goal.achievement.score : null })) : [],
  };
}

module.exports = { resultReport };
