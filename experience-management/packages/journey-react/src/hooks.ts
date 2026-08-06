import { useCallback, useContext } from 'react';
import type {
  BrowserJourneySdk,
  EnqueueResult
} from '@seemplify/journey-browser-sdk';
import { JourneyReactContext } from './JourneyProvider.js';

function unavailable(): EnqueueResult {
  return { status: 'disabled', code: 'CLIENT_NOT_AVAILABLE' };
}

async function safeCall(
  call: (() => Promise<EnqueueResult>) | undefined,
  reportFailure: (failure: { code: 'CLIENT_CALL_FAILED' }) => void
) {
  if (!call) return unavailable();
  try { return await call(); }
  catch {
    reportFailure({ code: 'CLIENT_CALL_FAILED' });
    return { status: 'disabled', code: 'CLIENT_CALL_FAILED' } satisfies EnqueueResult;
  }
}

/** Returns null during SSR, before owned-client hydration, or outside a provider. */
export function useJourneyClient(): BrowserJourneySdk | null {
  return useContext(JourneyReactContext).client;
}

export function useJourneyReady() {
  return useContext(JourneyReactContext).ready;
}

export function useJourneyTrack(): BrowserJourneySdk['track'] {
  const { client, reportFailure } = useContext(JourneyReactContext);
  return useCallback<BrowserJourneySdk['track']>((...arguments_) =>
    safeCall(client ? () => client.track(...arguments_) : undefined, reportFailure),
  [client, reportFailure]);
}

export function useJourneyPage(): BrowserJourneySdk['page'] {
  const { client, reportFailure } = useContext(JourneyReactContext);
  return useCallback<BrowserJourneySdk['page']>((...arguments_) =>
    safeCall(client ? () => client.page(...arguments_) : undefined, reportFailure),
  [client, reportFailure]);
}

export function useJourneyConsent(): BrowserJourneySdk['consent'] {
  const { client, reportFailure } = useContext(JourneyReactContext);
  return useCallback<BrowserJourneySdk['consent']>((...arguments_) =>
    safeCall(client ? () => client.consent(...arguments_) : undefined, reportFailure),
  [client, reportFailure]);
}
