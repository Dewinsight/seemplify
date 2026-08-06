import type { JourneyEventContext, JsonObject, JsonValue } from '@seemplify/journey-event-protocol';
import type {
  AutomaticContextOptions,
  MobileContextMetadata,
  PrivacyOptions
} from './types.js';

const builtInDeniedNames = [
  'authorization', 'cookie', 'set-cookie', 'password', 'passcode', 'secret', 'token',
  'access_token', 'refresh_token', 'api_key', 'apikey', 'card_number', 'cardnumber',
  'credit_card', 'creditcard', 'cvv', 'cvc', 'security_code', 'ssn', 'advertising_id',
  'advertisingid', 'device_id', 'deviceid', 'idfa', 'gaid', 'imei', 'mac_address'
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

function safeDecode(value: string) {
  try { return decodeURIComponent(value.replaceAll('+', ' ')); }
  catch { return value; }
}

function minimiseUrl(raw: string | undefined, allowedParameters: readonly string[] = []) {
  if (!raw || !/^https?:\/\//iu.test(raw)) return undefined;
  let value = raw.split('#', 1)[0] ?? '';
  const queryIndex = value.indexOf('?');
  const base = queryIndex >= 0 ? value.slice(0, queryIndex) : value;
  const schemeEnd = base.indexOf('://') + 3;
  const pathStart = base.indexOf('/', schemeEnd);
  const authorityEnd = pathStart >= 0 ? pathStart : base.length;
  const authority = base.slice(schemeEnd, authorityEnd);
  const at = authority.lastIndexOf('@');
  value = `${base.slice(0, schemeEnd)}${at >= 0 ? authority.slice(at + 1) : authority}${base.slice(authorityEnd)}`;
  if (queryIndex < 0 || allowedParameters.length === 0) return value;
  const allowed = new Set(allowedParameters);
  const query = raw.slice(queryIndex + 1).split('#', 1)[0] ?? '';
  const retained = query.split('&').filter(Boolean).filter((pair) => {
    const key = safeDecode(pair.split('=', 1)[0] ?? '');
    return allowed.has(key);
  });
  return retained.length ? `${value}?${retained.join('&')}` : value;
}

function bounded(value: string | undefined, maximum: number) {
  return value ? value.slice(0, maximum) : undefined;
}

export function automaticContext(
  options: false | AutomaticContextOptions | undefined,
  metadata: MobileContextMetadata | undefined
): JourneyEventContext | undefined {
  if (!options || !metadata) return undefined;
  const context: JourneyEventContext = {};
  const locale = options.locale ? bounded(metadata.locale, 64) : undefined;
  const timezone = options.timezone ? bounded(metadata.timezone, 64) : undefined;
  if (locale) context.locale = locale;
  if (timezone) context.timezone = timezone;
  if (options.app && metadata.app) {
    context.app = {
      ...(bounded(metadata.app.name, 128) ? { name: bounded(metadata.app.name, 128)! } : {}),
      ...(bounded(metadata.app.version, 64) ? { version: bounded(metadata.app.version, 64)! } : {}),
      ...(bounded(metadata.app.build, 64) ? { build: bounded(metadata.app.build, 64)! } : {})
    };
  }
  if (options.device && metadata.device) {
    context.device = {
      ...(metadata.device.type ? { type: metadata.device.type } : {}),
      ...(bounded(metadata.device.operatingSystem, 64)
        ? { operatingSystem: bounded(metadata.device.operatingSystem, 64)! } : {}),
      ...(bounded(metadata.device.operatingSystemVersion, 64)
        ? { operatingSystemVersion: bounded(metadata.device.operatingSystemVersion, 64)! } : {}),
      ...(bounded(metadata.device.model, 128) ? { model: bounded(metadata.device.model, 128)! } : {})
    };
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
