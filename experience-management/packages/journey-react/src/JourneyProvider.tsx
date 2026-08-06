import {
  createContext,
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import type { BrowserJourneySdk, BrowserJourneySdkConfig } from '@seemplify/journey-browser-sdk';
import { acquireClient, defaultClientKey } from './clientRegistry.js';
import type {
  JourneyClientFactory,
  JourneyProviderProps,
  JourneyReactContextValue,
  JourneyReactFailure
} from './types.js';

const defaultContext: JourneyReactContextValue = Object.freeze({
  client: null,
  ready: false,
  reportFailure: () => undefined
});

export const JourneyReactContext = createContext<JourneyReactContextValue>(defaultContext);

interface OwnedClientState {
  key: string;
  client: BrowserJourneySdk;
}

function safeFailure(
  callback: ((failure: Readonly<JourneyReactFailure>) => void) | undefined,
  failure: JourneyReactFailure
) {
  try { callback?.(Object.freeze({ ...failure })); } catch { /* Failure reporting remains isolated. */ }
}

function providerConfig(props: JourneyProviderProps): BrowserJourneySdkConfig | undefined {
  return 'config' in props ? props.config : undefined;
}

function providerClient(props: JourneyProviderProps): BrowserJourneySdk | undefined {
  return 'client' in props ? props.client : undefined;
}

function providerFactory(props: JourneyProviderProps): JourneyClientFactory | undefined {
  return 'clientFactory' in props ? props.clientFactory : undefined;
}

function providerInstanceKey(props: JourneyProviderProps, config: BrowserJourneySdkConfig | undefined) {
  if (!config) return undefined;
  return ('instanceKey' in props && props.instanceKey) || defaultClientKey(config);
}

export function JourneyProvider(props: JourneyProviderProps) {
  const externalClient = providerClient(props);
  const config = providerConfig(props);
  const instanceKey = providerInstanceKey(props, config);
  const configRef = useRef(config);
  const factoryRef = useRef(providerFactory(props));
  const failureRef = useRef(props.onFailure);
  configRef.current = config;
  factoryRef.current = providerFactory(props);
  failureRef.current = props.onFailure;

  const [owned, setOwned] = useState<OwnedClientState | null>(null);
  const reportFailure = useCallback((failure: JourneyReactFailure) => {
    safeFailure(failureRef.current, failure);
  }, []);

  useEffect(() => {
    if (externalClient || !instanceKey || !configRef.current) return undefined;
    let lease;
    try {
      lease = acquireClient(instanceKey, configRef.current, factoryRef.current, (failure) => reportFailure(failure));
    } catch {
      reportFailure({ code: 'CLIENT_CREATE_FAILED' });
      return undefined;
    }
    setOwned({ key: instanceKey, client: lease.client });
    return () => { lease.release(); };
  }, [externalClient, instanceKey, reportFailure]);

  const activeClient = externalClient ?? (owned && owned.key === instanceKey ? owned.client : null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    setReady(false);
    if (!activeClient) return () => { active = false; };
    let readiness: Promise<void>;
    try { readiness = Promise.resolve(activeClient.ready); }
    catch {
      reportFailure({ code: 'CLIENT_READY_FAILED' });
      return () => { active = false; };
    }
    void readiness.then(
      () => { if (active) setReady(true); },
      () => { if (active) reportFailure({ code: 'CLIENT_READY_FAILED' }); }
    );
    return () => { active = false; };
  }, [activeClient, reportFailure]);

  const value = useMemo<JourneyReactContextValue>(() => ({
    client: activeClient,
    ready,
    reportFailure
  }), [activeClient, ready, reportFailure]);

  return createElement(JourneyReactContext.Provider, { value }, props.children);
}
