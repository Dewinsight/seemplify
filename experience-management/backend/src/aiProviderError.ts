export class AiProviderError extends Error {
  constructor(
    message: string,
    public code = 'AI_PROVIDER_ERROR',
    public status = 500,
    public retryable = false
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export interface AiCompletionRequest {
  activity: string;
  requestId: string;
  executionRevision?: number;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  jsonSchema?: Record<string, unknown>;
  schemaName?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}
