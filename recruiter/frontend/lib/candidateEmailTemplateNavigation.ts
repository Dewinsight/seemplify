import type { CandidateEmailTemplateType } from '@/lib/candidateEmailTemplatePresets';

export const CANDIDATE_EMAIL_TEMPLATE_EVENT = 'openEmailSettings';

export interface CandidateEmailTemplateEventDetail {
  templateType: CandidateEmailTemplateType;
}

export const openCandidateEmailTemplate = (templateType: CandidateEmailTemplateType) => {
  window.dispatchEvent(
    new CustomEvent<CandidateEmailTemplateEventDetail>(CANDIDATE_EMAIL_TEMPLATE_EVENT, {
      detail: { templateType },
    })
  );
};
