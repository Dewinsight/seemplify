export interface QuotaGroupOption {
  id: string;
  label: string;
  enabled?: boolean;
}

interface QuotaGroupDraft {
  label: string;
  confirmed: boolean;
}

interface CredentialDraft {
  label: string;
  apiKey: string;
  quotaGroup: string;
  projectLabel: string;
  priority: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; field: string };

const GROQ_API_KEY_PATTERN = /gsk_[a-z0-9_-]{12,}/i;

export function containsGroqApiKey(value: unknown): boolean {
  return GROQ_API_KEY_PATTERN.test(String(value || ''));
}

export function normalizeQuotaGroupId(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function validateQuotaGroupDraft(
  draft: QuotaGroupDraft,
  existingGroups: QuotaGroupOption[]
): ValidationResult<{ label: string; id: string; independentQuotaConfirmed: true }> {
  const label = draft.label.trim();
  if (containsGroqApiKey(label)) {
    return {
      ok: false,
      field: 'label',
      message: 'This looks like an API key. Add it as a credential instead of a quota group.'
    };
  }
  if (!label || label.length > 100) {
    return { ok: false, field: 'label', message: 'Enter a label of 100 characters or fewer.' };
  }
  if (!draft.confirmed) {
    return {
      ok: false,
      field: 'confirmed',
      message: 'Confirm that this is a genuinely independent Groq quota scope.'
    };
  }

  const id = normalizeQuotaGroupId(label);
  if (!id || id.length > 64) {
    return { ok: false, field: 'label', message: 'Use a shorter label with letters or numbers.' };
  }
  if (existingGroups.some((group) => normalizeQuotaGroupId(group.id) === id)) {
    return {
      ok: false,
      field: 'label',
      message: `Quota group "${id}" already exists. Choose it from the credential dropdown.`
    };
  }

  return { ok: true, value: { label, id, independentQuotaConfirmed: true } };
}

export function validateCredentialDraft(
  draft: CredentialDraft,
  existingGroups: QuotaGroupOption[],
  rotating = false
): ValidationResult<{
  label: string;
  apiKey: string;
  quotaGroup: string;
  projectLabel: string;
  priority: number;
}> {
  const label = draft.label.trim();
  const apiKey = draft.apiKey.trim();
  const projectLabel = draft.projectLabel.trim();
  const priority = Number(draft.priority);

  if (!rotating && containsGroqApiKey(label)) {
    return { ok: false, field: 'label', message: 'Keep the API key in the API key field, not the label.' };
  }
  if (!rotating && (!label || label.length > 100)) {
    return { ok: false, field: 'label', message: 'Enter a credential label of 100 characters or fewer.' };
  }
  if (containsGroqApiKey(projectLabel)) {
    return { ok: false, field: 'projectLabel', message: 'Keep the API key in the API key field, not the project label.' };
  }
  if (!apiKey.startsWith('gsk_') || apiKey.length < 20) {
    return { ok: false, field: 'apiKey', message: 'Enter a valid Groq API key.' };
  }
  if (!rotating && !existingGroups.some((group) => group.id === draft.quotaGroup && group.enabled !== false)) {
    return { ok: false, field: 'quotaGroup', message: 'Choose an available quota group.' };
  }
  if (!rotating && (!Number.isInteger(priority) || priority < 1 || priority > 10000)) {
    return { ok: false, field: 'priority', message: 'Priority must be an integer from 1 to 10000.' };
  }

  return {
    ok: true,
    value: {
      label,
      apiKey,
      quotaGroup: draft.quotaGroup,
      projectLabel,
      priority
    }
  };
}
