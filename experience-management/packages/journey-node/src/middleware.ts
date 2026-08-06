import { journeyEventLimits } from '@seemplify/journey-event-protocol';
import { sanitiseContext } from './privacy.js';
import type {
  EventOptions,
  JourneyRequestContextMiddleware,
  JourneyRequestContextMiddlewareConfig,
  JourneyResolvedRequestContext,
  NodeSdkDiagnostic,
  PrivacyOptions,
  VerifiedJourneyIdentity
} from './types.js';

/**
 * The verified-identity marker set lives on a versioned global rather than in
 * module scope. A host graph can load both the ESM and the CommonJS build of
 * this package at once; with per-module state an identity minted by one copy
 * would be unknown to the other, so the middleware would silently reject it and
 * drop `userId` from every event. The set is created on first use so importing
 * this module still has no evaluation-time side effect.
 */
const verifiedIdentityKey = Symbol.for('@seemplify/journey-node.verifiedIdentities.v1');

function verifiedIdentities(): WeakSet<object> {
  const scope = globalThis as unknown as Record<symbol, WeakSet<object> | undefined>;
  let registry = scope[verifiedIdentityKey];
  if (!registry) {
    registry = new WeakSet<object>();
    scope[verifiedIdentityKey] = registry;
  }
  return registry;
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= journeyEventLimits.identifierChars;
}

function safeDiagnostic(
  callback: ((diagnostic: Readonly<NodeSdkDiagnostic>) => void) | undefined,
  code: string
) {
  try { callback?.(Object.freeze({ code })); } catch { /* Diagnostics cannot break request handling. */ }
}

/**
 * Marks an identity that the host application has already authenticated. This
 * helper validates shape and provenance intent; it does not verify a session,
 * token, signature, email address, or other credential by itself.
 */
export function createVerifiedJourneyIdentity(
  userId: string,
  verificationMethod: string
): VerifiedJourneyIdentity | undefined {
  if (!isBoundedIdentifier(userId)
    || typeof verificationMethod !== 'string'
    || verificationMethod.length === 0
    || verificationMethod.length > 128) return undefined;
  const identity = Object.freeze({ userId, verificationMethod }) as unknown as VerifiedJourneyIdentity;
  verifiedIdentities().add(identity);
  return identity;
}

function eventOptions(
  resolved: JourneyResolvedRequestContext,
  privacy: PrivacyOptions | undefined,
  onDiagnostic: ((diagnostic: Readonly<NodeSdkDiagnostic>) => void) | undefined
): EventOptions | undefined {
  const result: EventOptions = {};
  if (resolved.identity !== undefined) {
    if (typeof resolved.identity === 'object' && verifiedIdentities().has(resolved.identity)) {
      result.userId = resolved.identity.userId;
    } else {
      safeDiagnostic(onDiagnostic, 'REQUEST_IDENTITY_REJECTED');
    }
  }
  if (isBoundedIdentifier(resolved.anonymousId)) result.anonymousId = resolved.anonymousId;
  else if (resolved.anonymousId !== undefined) safeDiagnostic(onDiagnostic, 'REQUEST_ANONYMOUS_ID_REJECTED');
  if (isBoundedIdentifier(resolved.accountId)) result.accountId = resolved.accountId;
  else if (resolved.accountId !== undefined) safeDiagnostic(onDiagnostic, 'REQUEST_ACCOUNT_ID_REJECTED');
  if (isBoundedIdentifier(resolved.sessionId)) result.sessionId = resolved.sessionId;
  else if (resolved.sessionId !== undefined) safeDiagnostic(onDiagnostic, 'REQUEST_SESSION_ID_REJECTED');
  const context = sanitiseContext(resolved.context, privacy);
  if (context && Object.keys(context).length > 0) result.context = context;
  return Object.keys(result).length > 0 ? Object.freeze(result) : undefined;
}

/**
 * Creates a framework-neutral Connect/Express-shaped middleware. Resolved
 * context is held in a WeakMap instead of being attached to or serialised with
 * the request object. Resolver failures fail closed for telemetry and continue
 * the host request without exposing exception details.
 */
export function createJourneyRequestContextMiddleware<Request extends object>(
  config: JourneyRequestContextMiddlewareConfig<Request>
): JourneyRequestContextMiddleware<Request> {
  const contexts = new WeakMap<Request, Readonly<EventOptions>>();
  const middleware = ((request: Request, _response: unknown, next: (error?: unknown) => void) => {
    void Promise.resolve()
      .then(() => config.resolve(request))
      .then((resolved) => {
        if (resolved) {
          const options = eventOptions(resolved, config.privacy, config.onDiagnostic);
          if (options) contexts.set(request, options);
        }
      })
      .catch(() => { safeDiagnostic(config.onDiagnostic, 'REQUEST_CONTEXT_RESOLUTION_FAILED'); })
      .finally(() => {
        try { next(); }
        catch { safeDiagnostic(config.onDiagnostic, 'REQUEST_MIDDLEWARE_NEXT_FAILED'); }
      });
  }) as JourneyRequestContextMiddleware<Request>;
  middleware.eventOptions = (request) => contexts.get(request);
  middleware.clear = (request) => { contexts.delete(request); };
  return middleware;
}
