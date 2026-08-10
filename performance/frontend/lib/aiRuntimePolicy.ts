import type { AIRuntimePolicy, AIRuntimePreference } from './aiAccount';

/**
 * Resolve a user's preference against what the workspace currently permits.
 * A saved preference can outlive an administrator disabling that runtime, so
 * callers must never treat the stale value as executable policy.
 */
export function normalizedEffectiveRuntime(
  policy: AIRuntimePolicy,
  preference: AIRuntimePreference
): 'local' | 'chatgpt' | null {
  const preferred = preference === 'default' ? policy.defaultRuntime : preference;

  if (preferred === 'local' && policy.localEnabled) return 'local';
  if (preferred === 'chatgpt' && policy.chatgptEnabled) return 'chatgpt';

  if (policy.localEnabled) return 'local';
  if (policy.chatgptEnabled) return 'chatgpt';
  return null;
}
