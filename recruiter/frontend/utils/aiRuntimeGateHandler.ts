// AI runtime gate: turns machine-readable runtime failures into a global
// "choose your AI runtime" dialog instead of a dead-end error toast.
//
// The backend answers with these codes when an AI action cannot run because of
// runtime availability rather than a fault in the request itself. The fetch
// layer (apiRequest) sniffs failed responses and hands the code to a handler
// registered by the globally mounted AiRuntimeGateDialog.

/** The user can fix these themselves: connect or re-consent their ChatGPT account. */
export const AI_GATE_ACTION_CODES = new Set([
  'AI_RUNTIME_ACCOUNT_REQUIRED',
  'CHATGPT_NOT_CONNECTED',
  'CHATGPT_SUBJECT_UNRESOLVED',
  'CODEX_DATA_SHARING_ACKNOWLEDGEMENT_REQUIRED'
]);

/** The local runtime is off or unreachable; ChatGPT may be the way forward. */
export const AI_GATE_RUNTIME_CODES = new Set([
  'AI_RUNTIME_LOCAL_DISABLED',
  'AI_RUNTIME_CHATGPT_DISABLED',
  'AI_RUNTIMES_DISABLED',
  'AI_LOCAL_UNAVAILABLE',
  'AI_LOCAL_NOT_CONFIGURED',
  'LOCAL_LLM_DISABLED',
  'LOCAL_LLM_PAUSED'
]);

export interface AiRuntimeGateError {
  code: string;
  message: string;
}

type GateHandler = (gate: AiRuntimeGateError) => void;

let gateHandler: GateHandler | null = null;

export function setAiRuntimeGateHandler(handler: GateHandler | null) {
  gateHandler = handler;
}

export function isAiRuntimeGateCode(code: unknown): code is string {
  return typeof code === 'string'
    && (AI_GATE_ACTION_CODES.has(code) || AI_GATE_RUNTIME_CODES.has(code));
}

/** Reads a failed response body (already parsed) for a runtime-gate code. */
export function extractAiRuntimeGateError(body: any): AiRuntimeGateError | null {
  const code = body?.code;
  if (!isAiRuntimeGateCode(code)) return null;
  return {
    code,
    message: body?.msg || body?.message || body?.error || 'The AI runtime is unavailable.'
  };
}

export function handleAiRuntimeGateError(gate: AiRuntimeGateError) {
  if (gateHandler) gateHandler(gate);
  else console.warn('AI runtime gate fired with no mounted dialog:', gate.code);
}

/**
 * Convenience for responses outside apiRequest (e.g. the assistant SSE
 * stream): inspects a failed Response without consuming its body.
 */
export async function inspectResponseForAiRuntimeGate(response: Response) {
  if (response.ok) return;
  try {
    const body = await response.clone().json();
    const gate = extractAiRuntimeGateError(body);
    if (gate) handleAiRuntimeGateError(gate);
  } catch {
    // Not JSON — nothing to gate on.
  }
}
