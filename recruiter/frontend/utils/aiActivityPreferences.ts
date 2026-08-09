import type {
  AiAccountModel,
  AiActivityOverride,
  AiActivityPreference,
  AiReasoningEffort
} from '@/services/aiAccountService'

export const INHERIT_AI_SETTING = '__inherit__'

export const REASONING_OPTIONS: ReadonlyArray<{
  value: AiReasoningEffort
  label: string
}> = [
  { value: 'none', label: 'None' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'max', label: 'Maximum' },
  { value: 'ultra', label: 'Ultra' }
]

const reasoningValues = new Set<AiReasoningEffort>(
  REASONING_OPTIONS.map(({ value }) => value)
)

export function supportedReasoningEfforts(model?: AiAccountModel | null): AiReasoningEffort[] {
  const candidates = Array.isArray(model?.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts
    : []
  const normalized = candidates
    .map((candidate) => typeof candidate === 'string' ? candidate : candidate?.reasoningEffort)
    .filter((candidate): candidate is AiReasoningEffort => reasoningValues.has(candidate as AiReasoningEffort))
  return normalized.length > 0 ? Array.from(new Set(normalized)) : REASONING_OPTIONS.map(({ value }) => value)
}

export function hasAiActivityOverride(override?: AiActivityOverride | null) {
  return Boolean(override?.codexModel || override?.reasoningEffort)
}

export function groupAiActivities(activities: AiActivityPreference[]) {
  const groups = new Map<string, { app: string; group: string; activities: AiActivityPreference[] }>()
  activities.forEach((activity) => {
    const app = activity.app || 'recruiter'
    const group = activity.group || 'Other'
    const key = `${app}:${group}`
    const current = groups.get(key)
    groups.set(key, {
      app,
      group,
      activities: [...(current?.activities || []), activity]
    })
  })
  return Array.from(groups.values())
}

export function activityMatchesQuery(activity: AiActivityPreference, query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return [activity.label, activity.activity, activity.group]
    .some((value) => String(value || '').toLowerCase().includes(normalized))
}
