import type { ReactNode } from 'react';
import type {
  BrowserJourneySdk,
  BrowserJourneySdkConfig
} from '@seemplify/journey-browser-sdk';

export type JourneyClientFactory = (config: BrowserJourneySdkConfig) => BrowserJourneySdk;

export type JourneyReactFailureCode =
  | 'CLIENT_CREATE_FAILED'
  | 'CLIENT_NOT_AVAILABLE'
  | 'CLIENT_READY_FAILED'
  | 'CLIENT_CALL_FAILED'
  | 'CLIENT_FLUSH_FAILED'
  | 'CLIENT_DESTROY_FAILED';

export interface JourneyReactFailure {
  code: JourneyReactFailureCode;
}

interface JourneyProviderCommonProps {
  children?: ReactNode;
  /** Receives stable codes only. Raw errors, event bodies, identities, and keys are never exposed. */
  onFailure?: (failure: Readonly<JourneyReactFailure>) => void;
}

export interface JourneyProviderWithClientProps extends JourneyProviderCommonProps {
  /** Externally managed clients are never flushed or destroyed by this provider. */
  client: BrowserJourneySdk;
  config?: never;
  instanceKey?: never;
  clientFactory?: never;
}

export interface JourneyProviderWithConfigProps extends JourneyProviderCommonProps {
  client?: never;
  config: BrowserJourneySdkConfig;
  /**
   * Stable logical identity for the owned client. Change it when non-key config
   * changes. Providers with the same key deliberately share one client lease.
   */
  instanceKey?: string;
  /** Primarily useful for controlled wrappers and deterministic tests. */
  clientFactory?: JourneyClientFactory;
}

export interface JourneyProviderDisabledProps extends JourneyProviderCommonProps {
  client?: never;
  config?: never;
  instanceKey?: never;
  clientFactory?: never;
}

export type JourneyProviderProps =
  | JourneyProviderWithClientProps
  | JourneyProviderWithConfigProps
  | JourneyProviderDisabledProps;

export interface JourneyReactContextValue {
  client: BrowserJourneySdk | null;
  ready: boolean;
  reportFailure(failure: JourneyReactFailure): void;
}
