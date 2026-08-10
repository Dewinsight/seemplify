export type JourneyCredentialEnvironment = 'development' | 'staging' | 'production';

export type JourneyCredentialKind = 'public_write' | 'server_secret';

export interface ParsedJourneyCredential {
  kind: JourneyCredentialKind;
  environment: JourneyCredentialEnvironment;
  keyId: string;
}

const credentialPattern = /^(jpk|jsk)_(dev|stg|live)\.([A-Za-z0-9][A-Za-z0-9_:-]{0,127})\.([A-Za-z0-9_-]{32,256})$/u;

/**
 * Parses only the canonical v1 source credential shape. The secret portion is
 * deliberately never returned, which keeps callers from copying credentials
 * into diagnostics or state by accident.
 */
export function parseJourneyCredential(value: string): ParsedJourneyCredential | undefined {
  if (typeof value !== 'string' || value.length > 512) return undefined;
  const match = credentialPattern.exec(value);
  if (!match) return undefined;
  return {
    kind: match[1] === 'jpk' ? 'public_write' : 'server_secret',
    environment: match[2] === 'live' ? 'production' : match[2] === 'stg' ? 'staging' : 'development',
    keyId: match[3] as string
  };
}

export function parseJourneyPublicWriteKey(value: string) {
  const parsed = parseJourneyCredential(value);
  return parsed?.kind === 'public_write' ? parsed : undefined;
}

export function parseJourneyServerSecret(value: string) {
  const parsed = parseJourneyCredential(value);
  return parsed?.kind === 'server_secret' ? parsed : undefined;
}
