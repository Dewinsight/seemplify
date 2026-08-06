import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { StrictMode, useEffect, type ReactNode } from 'react';
import {
  act,
  create,
  type ReactTestRenderer
} from 'react-test-renderer';
import type {
  BrowserJourneySdk,
  BrowserJourneySdkConfig,
  ConsentInput,
  EnqueueResult,
  EventOptions
} from '@seemplify/journey-browser-sdk';
import {
  JourneyProvider,
  useJourneyClient,
  useJourneyConsent,
  useJourneyPage,
  useJourneyReady,
  useJourneyTrack
} from '../src/index.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config: BrowserJourneySdkConfig = {
  writeKey: 'jpk_dev.react_key_01.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  endpoint: 'https://react.example.test',
  environment: 'development'
};

interface MockClient extends BrowserJourneySdk {
  calls: {
    track: unknown[][];
    page: unknown[][];
    consent: unknown[][];
    flush: number;
    destroy: number;
  };
}

function queued(code = 'QUEUED'): EnqueueResult {
  return { status: 'queued', code, eventId: '00000000-0000-4000-8000-000000000001' };
}

function mockClient(overrides: Partial<BrowserJourneySdk> = {}): MockClient {
  const calls: MockClient['calls'] = { track: [], page: [], consent: [], flush: 0, destroy: 0 };
  const client: MockClient = {
    calls,
    ready: Promise.resolve(),
    enabled: true,
    track: async (...arguments_) => { calls.track.push(arguments_); return queued('TRACKED'); },
    identify: async () => queued(),
    alias: async () => queued(),
    group: async () => queued(),
    page: async (...arguments_) => { calls.page.push(arguments_); return queued('PAGED'); },
    screen: async () => queued(),
    consent: async (...arguments_) => { calls.consent.push(arguments_); return queued('CONSENTED'); },
    flush: async () => {
      calls.flush += 1;
      return { status: 'empty', accepted: 0, dropped: 0, retained: 0 };
    },
    reset: async () => undefined,
    destroy: async () => { calls.destroy += 1; },
    status: () => ({ enabled: true, queued: 0, buffered: 0, online: true }),
    ...overrides
  };
  return client;
}

async function settle() {
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

interface ProbeState {
  client: BrowserJourneySdk | null;
  ready: boolean;
  track: BrowserJourneySdk['track'];
  page: BrowserJourneySdk['page'];
  consent: BrowserJourneySdk['consent'];
}

function Probe({ capture }: { capture: (value: ProbeState) => void }) {
  const client = useJourneyClient();
  const ready = useJourneyReady();
  const track = useJourneyTrack();
  const page = useJourneyPage();
  const consent = useJourneyConsent();
  useEffect(() => { capture({ client, ready, track, page, consent }); }, [capture, client, ready, track, page, consent]);
  return null;
}

async function unmount(renderer: ReactTestRenderer) {
  await act(async () => {
    renderer.unmount();
    await settle();
  });
}

test('React Strict Mode leases one owned client and tears it down once', async () => {
  let creations = 0;
  const client = mockClient();
  let latest: ProbeState | undefined;
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <StrictMode>
        <JourneyProvider config={config} instanceKey="strict-one" clientFactory={() => { creations += 1; return client; }}>
          <Probe capture={(value) => { latest = value; }} />
        </JourneyProvider>
      </StrictMode>
    );
    await settle();
  });
  assert.equal(creations, 1);
  assert.equal(latest?.client, client);
  assert.equal(latest?.ready, true);

  await unmount(renderer);
  assert.equal(client.calls.flush, 1);
  assert.equal(client.calls.destroy, 1);
});

test('providers with one instance key share a lease until the last owner leaves', async () => {
  let creations = 0;
  const client = mockClient();
  function Tree({ second }: { second: boolean }) {
    const provider = (suffix: string) => (
      <JourneyProvider key={suffix} config={config} instanceKey="shared" clientFactory={() => { creations += 1; return client; }}>
        <Probe capture={() => undefined} />
      </JourneyProvider>
    );
    return <>{provider('first')}{second ? provider('second') : null}</>;
  }
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Tree second />);
    await settle();
  });
  assert.equal(creations, 1);
  await act(async () => {
    renderer.update(<Tree second={false} />);
    await settle();
  });
  assert.equal(client.calls.destroy, 0);
  await unmount(renderer);
  assert.equal(client.calls.flush, 1);
  assert.equal(client.calls.destroy, 1);
});

test('external clients are immediately available and never owned by the provider', async () => {
  const client = mockClient();
  let latest: ProbeState | undefined;
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <JourneyProvider client={client}>
        <Probe capture={(value) => { latest = value; }} />
      </JourneyProvider>
    );
    await settle();
  });
  assert.equal(latest?.client, client);
  assert.equal(latest?.ready, true);

  const trackResult = await latest!.track('survey_published', { source: 'studio' }, { eventId: 'track-id' });
  const pageResult = await latest!.page('settings', { tab: 'journeys' }, { eventId: 'page-id' });
  const consent: ConsentInput = { analytics: 'granted', source: 'cmp' };
  const consentResult = await latest!.consent(consent, { eventId: 'consent-id' });
  assert.equal(trackResult.code, 'TRACKED');
  assert.equal(pageResult.code, 'PAGED');
  assert.equal(consentResult.code, 'CONSENTED');
  assert.deepEqual(client.calls.track[0], ['survey_published', { source: 'studio' }, { eventId: 'track-id' }]);
  assert.deepEqual(client.calls.page[0], ['settings', { tab: 'journeys' }, { eventId: 'page-id' }]);
  assert.deepEqual(client.calls.consent[0], [consent, { eventId: 'consent-id' }]);

  await unmount(renderer);
  assert.equal(client.calls.flush, 0);
  assert.equal(client.calls.destroy, 0);
});

test('hooks outside a provider fail closed without breaking their host component', async () => {
  let latest: ProbeState | undefined;
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Probe capture={(value) => { latest = value; }} />);
    await settle();
  });
  assert.equal(latest?.client, null);
  assert.equal(latest?.ready, false);
  assert.deepEqual(await latest!.track('safe_without_provider'), { status: 'disabled', code: 'CLIENT_NOT_AVAILABLE' });
  assert.deepEqual(await latest!.page('safe_without_provider'), { status: 'disabled', code: 'CLIENT_NOT_AVAILABLE' });
  assert.deepEqual(await latest!.consent({ analytics: 'denied', source: 'cmp' }), {
    status: 'disabled', code: 'CLIENT_NOT_AVAILABLE'
  });
  await unmount(renderer);
});

test('hook adapters contain client rejections and report stable failure codes only', async () => {
  const failures: string[] = [];
  const client = mockClient({
    track: async (_event: string, _properties?: Record<string, never>, _options?: EventOptions) => {
      throw new Error('sensitive transport detail');
    }
  });
  let latest: ProbeState | undefined;
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <JourneyProvider client={client} onFailure={(failure) => failures.push(failure.code)}>
        <Probe capture={(value) => { latest = value; }} />
      </JourneyProvider>
    );
    await settle();
  });
  assert.deepEqual(await latest!.track('contained_failure'), { status: 'disabled', code: 'CLIENT_CALL_FAILED' });
  assert.deepEqual(failures, ['CLIENT_CALL_FAILED']);
  await unmount(renderer);
});

test('owned factory and readiness failures leave children mounted', async () => {
  const factoryFailures: string[] = [];
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <JourneyProvider
        config={config}
        instanceKey="factory-failure"
        clientFactory={() => { throw new Error('do not expose'); }}
        onFailure={(failure) => factoryFailures.push(failure.code)}
      >
        <span>Host remains mounted</span>
      </JourneyProvider>
    );
    await settle();
  });
  assert.equal(renderer.root.findByType('span').children.join(''), 'Host remains mounted');
  assert.equal(factoryFailures.includes('CLIENT_CREATE_FAILED'), true);
  await unmount(renderer);

  let rejectReady!: (reason?: unknown) => void;
  const ready = new Promise<void>((_resolve, reject) => { rejectReady = reject; });
  const readinessFailures: string[] = [];
  const unready = mockClient({ ready });
  await act(async () => {
    renderer = create(
      <JourneyProvider client={unready} onFailure={(failure) => readinessFailures.push(failure.code)}>
        <Probe capture={() => undefined} />
      </JourneyProvider>
    );
    await settle();
  });
  await act(async () => {
    rejectReady(new Error('private readiness failure'));
    await settle();
  });
  assert.deepEqual(readinessFailures, ['CLIENT_READY_FAILED']);
  await unmount(renderer);
});

test('changing an owned instance key releases the old client and creates the new lease', async () => {
  const clients = [mockClient(), mockClient()];
  let creations = 0;
  const factory = () => clients[creations++]!;
  function Tree({ instanceKey }: { instanceKey: string }) {
    return <JourneyProvider config={config} instanceKey={instanceKey} clientFactory={factory}><Probe capture={() => undefined} /></JourneyProvider>;
  }
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Tree instanceKey="source-a" />);
    await settle();
  });
  await act(async () => {
    renderer.update(<Tree instanceKey="source-b" />);
    await settle();
  });
  assert.equal(creations, 2);
  assert.equal(clients[0]?.calls.flush, 1);
  assert.equal(clients[0]?.calls.destroy, 1);
  await unmount(renderer);
  assert.equal(clients[1]?.calls.flush, 1);
  assert.equal(clients[1]?.calls.destroy, 1);
});

test('owned teardown attempts destroy even when its final flush fails', async () => {
  const failures: string[] = [];
  const client = mockClient({
    flush: async () => {
      client.calls.flush += 1;
      throw new Error('private flush failure');
    }
  });
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <JourneyProvider
        config={config}
        instanceKey="flush-failure"
        clientFactory={() => client}
        onFailure={(failure) => failures.push(failure.code)}
      />
    );
    await settle();
  });
  await unmount(renderer);
  assert.equal(client.calls.flush, 1);
  assert.equal(client.calls.destroy, 1);
  assert.deepEqual(failures, ['CLIENT_FLUSH_FAILED']);
});

test('hook callback identities remain stable while the active client is unchanged', async () => {
  const client = mockClient();
  const captures: ProbeState[] = [];
  const capture = (value: ProbeState) => { captures.push(value); };
  function Tree({ children }: { children?: ReactNode }) {
    return <JourneyProvider client={client}><Probe capture={capture} />{children}</JourneyProvider>;
  }
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Tree />);
    await settle();
  });
  const first = captures.at(-1)!;
  await act(async () => {
    renderer.update(<Tree><span>unrelated render</span></Tree>);
    await settle();
  });
  const second = captures.at(-1)!;
  assert.equal(second.track, first.track);
  assert.equal(second.page, first.page);
  assert.equal(second.consent, first.consent);
  await unmount(renderer);
});
