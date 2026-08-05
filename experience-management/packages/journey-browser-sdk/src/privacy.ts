import type { JourneyEventContext, JsonObject, JsonValue } from '@seemplify/journey-event-protocol';
import type { AutomaticContextOptions, BrowserJourneyRuntime, PrivacyOptions } from './types.js';

const builtInDeniedNames = [
  'authorization', 'cookie', 'set-cookie', 'password', 'passcode', 'secret', 'token',
  'access_token', 'refresh_token', 'api_key', 'apikey', 'card_number', 'cardnumber',
  'credit_card', 'creditcard', 'cvv', 'cvc', 'security_code', 'ssn'
];

function normaliseName(value: string) {
  return value.trim().toLocaleLowerCase('en-US');
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).every(isJsonValue);
}

function sanitiseValue(value: unknown, denied: ReadonlySet<string>): JsonValue | undefined {
  if (!isJsonValue(value)) return undefined;
  if (Array.isArray(value)) {
    return value.map((entry) => sanitiseValue(entry, denied)).filter((entry): entry is JsonValue => entry !== undefined);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const [key, entry] of Object.entries(value)) {
      if (denied.has(normaliseName(key))) continue;
      const safe = sanitiseValue(entry, denied);
      if (safe !== undefined) result[key] = safe;
    }
    return result;
  }
  return value;
}

export function sanitiseObject(input: JsonObject | undefined, privacy: PrivacyOptions | undefined): JsonObject | undefined {
  if (!input) return undefined;
  const denied = new Set([...builtInDeniedNames, ...(privacy?.denyPropertyNames ?? [])].map(normaliseName));
  const safe = sanitiseValue(input, denied);
  return safe && typeof safe === 'object' && !Array.isArray(safe) ? safe : undefined;
}

export function minimiseUrl(raw: string | undefined, allowedParameters: readonly string[] = []) {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
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

function detectDevice(userAgent: string | undefined): 'desktop' | 'mobile' | 'tablet' | 'other' | undefined {
  if (!userAgent) return undefined;
  if (/ipad|tablet/i.test(userAgent)) return 'tablet';
  if (/mobile|iphone|android/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

export function automaticContext(
  options: false | AutomaticContextOptions | undefined,
  runtime: BrowserJourneyRuntime,
  privacy: PrivacyOptions | undefined
): JourneyEventContext | undefined {
  if (!options) return undefined;
  const context: JourneyEventContext = {};
  if (options.locale && runtime.navigator?.language) context.locale = runtime.navigator.language.slice(0, 64);
  if (options.timezone) {
    try { context.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone.slice(0, 64); }
    catch { /* An unavailable Intl implementation is non-fatal. */ }
  }
  if (options.page) {
    const url = minimiseUrl(runtime.location?.href, privacy?.allowUrlQueryParameters);
    const referrer = minimiseUrl(runtime.document?.referrer, privacy?.allowUrlQueryParameters);
    if (url || referrer || (options.pageTitle && runtime.document?.title)) {
      context.page = {
        ...(url ? { url } : {}),
        ...(referrer ? { referrer } : {}),
        ...(options.pageTitle && runtime.document?.title ? { title: runtime.document.title.slice(0, 256) } : {})
      };
    }
  }
  if (options.device) {
    const type = detectDevice(runtime.navigator?.userAgent);
    if (type) context.device = { type };
  }
  return Object.keys(context).length ? context : undefined;
}

export function sanitiseContext(
  manual: JourneyEventContext | undefined,
  automatic: JourneyEventContext | undefined,
  privacy: PrivacyOptions | undefined
): JourneyEventContext | undefined {
  const combined = { ...(automatic ?? {}), ...(manual ?? {}) } as JourneyEventContext;
  const safe = sanitiseObject(combined, privacy) as JourneyEventContext | undefined;
  if (!safe) return undefined;
  if (safe.page) {
    const page = safe.page;
    const url = minimiseUrl(typeof page.url === 'string' ? page.url : undefined, privacy?.allowUrlQueryParameters);
    const referrer = minimiseUrl(typeof page.referrer === 'string' ? page.referrer : undefined, privacy?.allowUrlQueryParameters);
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
