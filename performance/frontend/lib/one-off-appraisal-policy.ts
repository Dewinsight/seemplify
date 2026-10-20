import type { CycleDesign } from '@/components/appraisals/CycleDesignBuilder';

/** Derive a new review's explicit goal policy without modifying its reusable template. */
export function oneOffAppraisalPolicy(design: CycleDesign, requireApprovedGoals = false) {
  if (requireApprovedGoals) return { settings: { requireOkrAlignment: true }, workflowDefinition: design };
  const sections = design.sections.filter(section => section.type !== 'goals');
  const scored = sections.filter(section => section.scored);
  const total = scored.reduce((sum, section) => sum + section.weight, 0);
  if (!scored.length || scored.some(section => !Number.isFinite(section.weight) || section.weight < 0) || !Number.isFinite(total) || total <= 0) {
    throw new Error('Choose a template with positively weighted non-goal assessment sections, or include approved goals.');
  }
  const weighted = sections.map(section => section.scored ? { ...section, weight: section.weight * 100 / total } : section);
  return {
    settings: { requireOkrAlignment: false },
    workflowDefinition: {
      ...design,
      sections: weighted,
      stages: { ...design.stages, goalSetting: { enabled: false } },
      scoring: { goalsWeight: 0, competenciesWeight: weighted.find(section => section.type === 'competencies')?.weight || 0 },
    },
  };
}
