import type { JourneyEventContext, JsonObject, JsonValue } from '@seemplify/journey-event-protocol';
import type { PrivacyOptions } from './types.js';

const builtInDeniedNames = [
  'authorization', 'cookie', 'set-cookie', 'password', 'passcode', 'secret', 'token',
  'access_token', 'refresh_token', 'api_key', 'apikey', 'card_number', 'cardnumber',
  'credit_card', 'creditcard', 'cvv', 'cvc', 'security_code', 'ssn'
];

function normaliseName(value: string) {
  return value.trim().toLocaleLowerCase('en-US');
}

function sanitiseValue(value: unknown, denied: ReadonlySet<string>): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    return value.map((entry) => sanitiseValue(entry, denied)).filter((entry): entry is JsonValue => entry !== undefined);
  }
  if (typeof value !== 'object') return undefined;
  const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const [key, entry] of Object.entries(value)) {
    if (denied.has(normaliseName(key))) continue;
    const safe = sanitiseValue(entry, denied);
    if (safe !== undefined) result[key] = safe;
  }
  return result;
}

export function sanitiseObject(input: JsonObject | undefined, privacy: PrivacyOptions | undefined): JsonObject | undefined {
  if (!input) return undefined;
  const denied = new Set([...builtInDeniedNames, ...(privacy?.denyPropertyNames ?? [])].map(normaliseName));
  const safe = sanitiseValue(input, denied);
  return safe && typeof safe === 'object' && !Array.isArray(safe) ? safe : undefined;
}

function minimiseUrl(raw: string | undefined, allowedParameters: readonly string[] = []) {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    url.username = '';
    url.password = '';
    const allowed = new Set(allowedParameters);
    for (const key of [...url.searchParams.keys()]) {
      if (!allowed.has(key)) url.searchParams.delete(key);
    }
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

export function sanitiseContext(input: JourneyEventContext | undefined, privacy: PrivacyOptions | undefined) {
  const safe = sanitiseObject(input, privacy) as JourneyEventContext | undefined;
  if (!safe) return undefined;
  if (safe.page) {
    const page = safe.page;
    const url = minimiseUrl(typeof page.url === 'string' ? page.url : undefined, privacy?.allowUrlQueryParameters);
    const referrer = minimiseUrl(
      typeof page.referrer === 'string' ? page.referrer : undefined,
      privacy?.allowUrlQueryParameters
    );
    safe.page = {
      ...(page as JsonObject),
      ...(url ? { url } : {}),
      ...(referrer ? { referrer } : {})
    };
    if (!url) delete safe.page.url;
    if (!referrer) delete safe.page.referrer;
  }
  return Object.keys(safe).length ? safe : undefined;
}
