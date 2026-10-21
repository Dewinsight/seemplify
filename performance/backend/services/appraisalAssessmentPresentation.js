'use strict';

// Presentation data comes only from the evidence collector's authorized sources.
// It never scores a person, changes a rating, or queries a broader data scope.
const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const percent = value => { const number = numeric(value); return number !== null && number >= 0 && number <= 100 ? number : null; };
const read = source => { try { return JSON.parse(source.text); } catch { return {}; } };

function build(sources, ratingScale = {}) {
  const min = numeric(ratingScale.min) ?? 1, max = numeric(ratingScale.max) ?? 5;
  const rating = value => { const number = numeric(value); return number !== null && number >= min && number <= max ? number : null; };
  const selfSource = sources.find(source => source.category === 'employee_assessment');
  const reviewerSource = sources.find(source => source.category === 'manager_review');
  const self = selfSource ? read(selfSource) : {}, reviewer = reviewerSource ? read(reviewerSource) : {};
  const criteria = new Map();
  for (const [side, data, field, source] of [['employee', self, 'selfRating', selfSource], ['reviewer', reviewer, 'managerRating', reviewerSource]]) {
    for (const entry of data.competencyRatings || []) {
      const key = entry.competencyId || entry.competencyName;
      if (!key) continue;
      const row = criteria.get(key) || { title: entry.competencyName || 'Competency', employee: null, reviewer: null, refs: [] };
      row[side] = rating(entry[field]);
      if (source?.ref && !row.refs.includes(source.ref)) row.refs.push(source.ref);
      criteria.set(key, row);
    }
  }
  const goals = sources.filter(source => ['personal_okrs', 'aligned_okrs'].includes(source.category)).map(source => {
    const data = read(source), frozen = source.state === 'frozen_scoring_evidence';
    return { title: source.title, ref: source.ref, scope: source.category === 'personal_okrs' ? 'individual' : data.type || 'team',
      basis: frozen ? 'appraisal_snapshot' : 'live_context', progress: frozen ? data.achievement?.rated === true ? percent(data.achievement.score) : null : percent(data.progress),
      status: frozen ? data.achievement?.rated ? 'rated' : 'unrated' : data.status || 'not_recorded' };
  });
  return { scale: { min, max }, ratings: {
    employee: { value: rating(self.overallSelfRating), state: selfSource?.state || 'not_available', ref: selfSource?.ref },
    reviewer: { value: rating(reviewer.overallManagerRating), state: reviewerSource?.state || 'not_available', ref: reviewerSource?.ref }
  }, competencies: [...criteria.values()], goals };
}

const previewKeys = ['text', 'transcript', 'message', 'answer', 'agreedNotes', 'aiMeetingNotes', 'achievements', 'challenges', 'learnings', 'strengths',
  'areasForImprovement', 'developmentAreas', 'selfComments', 'managerComments', 'description', 'title', 'prompt', 'summary'];
function previews(sources) {
  return sources.map(source => {
    const data = read(source), parts = [];
    const visit = value => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!value || typeof value !== 'object') return;
      for (const key of previewKeys) {
        const entry = value[key];
        if (typeof entry === 'string' && entry.trim()) parts.push(entry.trim());
        else if (key === 'answer' && (typeof entry === 'number' || typeof entry === 'boolean')) parts.push(String(entry));
      }
      for (const entry of Object.values(value)) if (entry && typeof entry === 'object') visit(entry);
    };
    visit(data);
    const text = [...new Set(parts)].join('\n\n');
    return { ref: source.ref, text: text.slice(0, 1600), truncated: text.length > 1600 };
  });
}
module.exports = { build, previews };
