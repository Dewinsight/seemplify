import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserJourneySdk } from '@seemplify/journey-browser-sdk';
import {
  JourneyProvider,
  useJourneyClient,
  useJourneyReady,
  useJourneyTrack
} from '@seemplify/journey-react';

interface LiveBrowserInput {
  endpoint: string;
  writeKey: string;
  eventId: string;
  occurredAt: string;
}

function config(input: LiveBrowserInput) {
  return {
    writeKey: input.writeKey,
    endpoint: input.endpoint,
    environment: 'production' as const,
    consent: {
      analytics: 'granted' as const,
      source: 'live_conformance',
      updatedAt: input.occurredAt
    },
    storage: false as const,
    automaticContext: false as const,
    batch: { maxEvents: 20, flushIntervalMs: 600_000 },
    retry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100, jitterRatio: 0 }
  };
}

async function runBrowser(input: LiveBrowserInput) {
  const client = createBrowserJourneySdk(config(input));
  await client.ready;
  const enqueued = await client.track('live_conformance_event', { channel: 'browser' }, {
    eventId: input.eventId,
    occurredAt: input.occurredAt,
    anonymousId: 'live-browser-subject'
  });
  const flushed = await client.flush();
  const status = client.status();
  await client.destroy();
  return { enqueued, flushed, status };
}

interface ReactProbeProps {
  eventId: string;
  occurredAt: string;
  complete(value: unknown): void;
}

function ReactProbe({ eventId, occurredAt, complete }: ReactProbeProps) {
  const ready = useJourneyReady();
  const client = useJourneyClient();
  const track = useJourneyTrack();
  const started = useRef(false);
  useEffect(() => {
    if (!ready || !client || started.current) return;
    started.current = true;
    void (async () => {
      const enqueued = await track('live_conformance_event', { channel: 'react' }, {
        eventId,
        occurredAt,
        anonymousId: 'live-react-subject'
      });
      const flushed = await client.flush();
      complete({ enqueued, flushed, status: client.status() });
    })();
  }, [client, complete, eventId, occurredAt, ready, track]);
  return null;
}

async function runReact(input: LiveBrowserInput) {
  const client = createBrowserJourneySdk(config(input));
  await client.ready;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const result = await new Promise<unknown>((resolve) => {
    root.render(React.createElement(
      JourneyProvider,
      { client },
      React.createElement(ReactProbe, {
        eventId: input.eventId,
        occurredAt: input.occurredAt,
        complete: resolve
      })
    ));
  });
  root.unmount();
  host.remove();
  await client.destroy();
  return result;
}

Object.assign(window, {
  seemplifyLiveIngestGate: Object.freeze({ runBrowser, runReact })
});

