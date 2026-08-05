import { createBrowserJourneySdk, type BrowserJourneySdk, type BrowserJourneySdkConfig } from '@seemplify/journey-browser-sdk';
import type { JourneyClientFactory, JourneyReactFailure } from './types.js';

interface ClientLeaseEntry {
  client: BrowserJourneySdk;
  references: number;
  disposalGeneration: number;
}

export interface ClientLease {
  client: BrowserJourneySdk;
  release(): void;
}

type LeaseRegistry = Map<string, ClientLeaseEntry>;

/**
 * Reference-counted leases live on a versioned global rather than in module
 * scope. A host graph can legitimately load both the ESM and the CommonJS build
 * of this package at once; with per-module state each copy would keep its own
 * registry, so one configuration would produce two live clients that duplicate
 * delivery and cannot observe each other's disposal. The registry is created on
 * first use so importing this module still has no evaluation-time side effect.
 */
const leaseRegistryKey = Symbol.for('@seemplify/journey-react.clientLeases.v1');

function leaseRegistry(): LeaseRegistry {
  const scope = globalThis as unknown as Record<symbol, LeaseRegistry | undefined>;
  let registry = scope[leaseRegistryKey];
  if (!registry) {
    registry = new Map<string, ClientLeaseEntry>();
    scope[leaseRegistryKey] = registry;
  }
  return registry;
}

function scheduleMicrotask(callback: () => void) {
  if (typeof queueMicrotask === 'function') queueMicrotask(callback);
  else void Promise.resolve().then(callback);
}

function safeNotify(callback: ((failure: Readonly<JourneyReactFailure>) => void) | undefined, code: JourneyReactFailure['code']) {
  try { callback?.(Object.freeze({ code })); } catch { /* Host callbacks cannot break lifecycle cleanup. */ }
}

async function dispose(
  key: string,
  entry: ClientLeaseEntry,
  generation: number,
  onFailure: ((failure: Readonly<JourneyReactFailure>) => void) | undefined
) {
  const leases = leaseRegistry();
  if (leases.get(key) !== entry || entry.references !== 0 || entry.disposalGeneration !== generation) return;
  leases.delete(key);
  try { await entry.client.flush(); }
  catch { safeNotify(onFailure, 'CLIENT_FLUSH_FAILED'); }
  try { await entry.client.destroy(); }
  catch { safeNotify(onFailure, 'CLIENT_DESTROY_FAILED'); }
}

export function defaultClientKey(config: BrowserJourneySdkConfig) {
  return [config.endpoint, config.writeKey, config.environment ?? '', config.storageKey ?? ''].join('\u0000');
}

export function acquireClient(
  key: string,
  config: BrowserJourneySdkConfig,
  factory: JourneyClientFactory = createBrowserJourneySdk,
  onFailure?: (failure: Readonly<JourneyReactFailure>) => void
): ClientLease {
  const leases = leaseRegistry();
  let entry = leases.get(key);
  if (!entry) {
    entry = { client: factory(config), references: 0, disposalGeneration: 0 };
    leases.set(key, entry);
  }
  entry.references += 1;
  entry.disposalGeneration += 1;
  let released = false;
  return {
    client: entry.client,
    release: () => {
      if (released) return;
      released = true;
      entry!.references = Math.max(0, entry!.references - 1);
      const generation = ++entry!.disposalGeneration;
      scheduleMicrotask(() => { void dispose(key, entry!, generation, onFailure); });
    }
  };
}
