export type AssessmentSource = { id: string; ref?: string; category: string; title: string; state: string; characters?: number; includedCharacters?: number };
export type SourcePreview = { ref: string; text: string; truncated: boolean };
export type AssessmentAnalytics = {
  scale: { min: number; max: number };
  ratings: Record<'employee' | 'reviewer', { value: number | null; state: string; ref?: string }>;
  competencies: Array<{ title: string; employee: number | null; reviewer: number | null; refs: string[] }>;
  goals: Array<{ title: string; ref: string; scope: string; basis: string; progress: number | null; status: string }>;
};
export type AnalysisSection = { key: string; title: string; body: string };
export const categoryNames: Record<string, string> = {
  review: 'Review context', employee_assessment: 'Employee assessment', manager_review: 'Reviewer assessment', review_answers: 'Review questions',
  ai_conversation: 'AI discussions', documents: 'Supporting documents', meetings: 'Meetings and notes', personal_okrs: 'Individual OKRs',
  aligned_okrs: 'Team and company OKRs', cv: 'CV', role_assessment: 'Role assessment', role_evidence: 'Role evidence',
};
export const stateName = (state: string) => ({ transcript_ready: 'Transcript ready', transcript_missing: 'Transcript missing', live_context: 'Live context',
  frozen_scoring_evidence: 'Appraisal snapshot', conversation: 'Discussion', not_available: 'Not available' }[state] || state.replaceAll('_', ' '));
const headings = [
  ['summary', 'Current assessment', ['current assessment and confidence', 'current assessment narrative', 'current assessment', 'executive summary']],
  ['role', 'CV and role fit', ['cv and role-fit evidence', 'cv and role fit evidence', 'cv and role-fit', 'cv and role fit']],
  ['outcomes', 'Outcomes and individual OKRs', ['outcomes and individual okrs']],
  ['alignment', 'Team and company alignment', ['team and organizational alignment', 'team and organisational alignment']],
  ['reflection', 'Employee reflections and answers', ['employee ai discussion and configured assessment answers']],
  ['reviewer', 'Reviewer perspective', ['manager assessment and differences in perspective']],
  ['meetings', 'Meetings and commitments', ['meetings, transcripts, decisions and commitments', 'meetings, transcripts, decisions, and commitments']],
  ['competencies', 'Strengths and development', ['competencies, strengths and development needs', 'competencies, strengths, and development needs']],
  ['gaps', 'Contradictions and evidence gaps', ['evidence contradictions and gaps']],
  ['questions', 'Follow-up questions', ['focused follow-up questions']],
  ['actions', 'Development actions', ['prioritized development actions with evidence, owner only if stated, and measurable success checks', 'prioritized development actions', 'prioritised development actions', 'development actions']],
  ['changes', 'What has changed', ['what changed since the previous evidence review']],
] as const;
export function analysisSections(content: string): AnalysisSection[] {
  const sections: AnalysisSection[] = [];
  let current: AnalysisSection = { key: 'summary', title: 'Current assessment', body: '' };
  for (const line of content.replaceAll('\r\n', '\n').split('\n')) {
    const plain = line.trim().replace(/^#{1,6}\s+/, '').replace(/^\*\*(.*?)\*\*$/, '$1').replace(/^\d+[.)]\s+/, '').replace(/[:\s]+$/, '');
    const normalized = plain.toLowerCase().replaceAll('–', '-').replaceAll('‑', '-');
    const known = headings.find(([, , aliases]) => (aliases as readonly string[]).includes(normalized));
    const markdown = /^#{1,6}\s+\S/.test(line.trim()) && plain.length < 100;
    if (known || markdown) {
      if (current.body.trim()) sections.push({ ...current, body: current.body.trim() });
      current = { key: known?.[0] || `section-${sections.length}`, title: known?.[1] || plain, body: '' };
    } else current.body += `${line}\n`;
  }
  if (current.body.trim()) sections.push({ ...current, body: current.body.trim() });
  return sections;
}
export function citedText(text: string) {
  const refs: string[] = [];
  const clean = text.replace(/\[([A-Z]+\d+(?:[\s,;]+[A-Z]+\d+)*)\]/g, (_, values: string) => {
    for (const ref of values.match(/[A-Z]+\d+/g) || []) if (!refs.includes(ref)) refs.push(ref);
    return '';
  }).replace(/ +([.,;:!?])/g, '$1').replace(/ {2,}/g, ' ').trim();
  return { text: clean, refs };
}
export function coverageGroups(sources: AssessmentSource[]) {
  return [
    { title: 'Assessments and answers', categories: ['employee_assessment', 'manager_review', 'review_answers'] },
    { title: 'Goals and alignment', categories: ['personal_okrs', 'aligned_okrs'] },
    { title: 'Meetings and notes', categories: ['meetings'] },
    { title: 'CV and documents', categories: ['cv', 'documents', 'role_evidence'] },
    { title: 'AI discussions', categories: ['ai_conversation'] },
    { title: 'Review and role context', categories: ['review', 'role_assessment'] },
  ].map(group => {
    const items = sources.filter(source => group.categories.includes(source.category));
    const drafts = items.filter(source => source.state === 'draft').length;
    const pending = items.filter(source => ['pending', 'processing', 'failed', 'transcript_missing'].includes(source.state)).length;
    return { ...group, count: items.length, available: items.length - drafts - pending, drafts, pending };
  });
}
