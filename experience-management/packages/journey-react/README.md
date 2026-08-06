# Seemplify Journey React

`@seemplify/journey-react` provides an SSR-safe React provider and typed hooks
over `@seemplify/journey-browser-sdk`. It contains no separate event protocol or
transport implementation.

## Delivery status

This is an isolated Phase 5A integration package. **No durable production
ingestion service exists in this repository yet.** The package does not create
sources, issue keys, instrument the Seemplify application, persist server data,
or make the protocol mock production-safe.

## Owned client

Pass a Browser SDK configuration when the provider should own the client:

```tsx
import { JourneyProvider } from '@seemplify/journey-react';

export function ApplicationProviders({ children }: { children: React.ReactNode }) {
  return (
    <JourneyProvider
      config={{
        writeKey: 'jpk_dev.replace_me.00000000000000000000000000000000',
        endpoint: 'https://ingest.example.com',
        environment: 'development',
        consent: {
          analytics: 'granted',
          source: 'your_cmp',
          updatedAt: new Date().toISOString()
        }
      }}
      instanceKey="journey-test-source"
      onFailure={({ code }) => {
        // Stable operational code only. Do not include event bodies or keys.
        reportOperationalCode(code);
      }}
    >
      {children}
    </JourneyProvider>
  );
}
```

The owned client is created in an effect, never during render. Server output and
the first hydration render therefore have the same no-client state. React
Strict Mode's development effect replay leases the same client: it does not
construct duplicate Browser SDK clients or attach duplicate lifecycle
listeners. Providers using the same `instanceKey` share that lease. The final
owner performs a bounded flush and destroys the client.

If `instanceKey` is omitted, the provider derives one from endpoint, public
write key, environment, and storage key. Supply an explicit key and change it
when callbacks, runtime adapters, privacy settings, queue policy, or other
configuration changes. Reusing a key deliberately reuses the existing client.

## Externally managed client

Pass `client` when another composition root owns lifecycle:

```tsx
<JourneyProvider client={existingBrowserClient}>
  <Application />
</JourneyProvider>
```

An external client is available on the first render and is never flushed,
reset, or destroyed by this provider.

## Hooks

```tsx
import {
  useJourneyClient,
  useJourneyConsent,
  useJourneyPage,
  useJourneyReady,
  useJourneyTrack
} from '@seemplify/journey-react';
```

- `useJourneyClient()` returns the active client or `null` during SSR, before
  owned-client hydration, or outside a provider.
- `useJourneyReady()` reports whether the client's asynchronous initialisation
  has completed.
- `useJourneyTrack()` returns the Browser SDK's typed `track` signature.
- `useJourneyPage()` returns the typed, imperative `page` signature.
- `useJourneyConsent()` returns the typed `consent` signature.

The action hooks are stable while the client is unchanged. Missing clients and
client exceptions resolve to a disabled result rather than throwing through the
host component:

```ts
{ status: 'disabled', code: 'CLIENT_NOT_AVAILABLE' }
{ status: 'disabled', code: 'CLIENT_CALL_FAILED' }
```

`onFailure` receives stable codes only:

- `CLIENT_CREATE_FAILED`
- `CLIENT_READY_FAILED`
- `CLIENT_CALL_FAILED`
- `CLIENT_FLUSH_FAILED`
- `CLIENT_DESTROY_FAILED`

Raw errors, event bodies, identities, URLs, and keys are not logged or passed to
the callback.

## Page tracking

Page collection remains explicit. This package does not subscribe to a router
or infer navigation automatically:

```tsx
function PageObservation({ name }: { name: string }) {
  const page = useJourneyPage();

  React.useEffect(() => {
    void page(name);
  }, [name, page]);

  return null;
}
```

This preserves the Browser SDK's manual-only privacy default. The caller is
responsible for deciding which routes and properties are appropriate to
collect.

## SSR and host safety

- Importing the package has no browser-global side effects.
- An owned Browser SDK client is not constructed during server rendering.
- Provider children render even if client creation or readiness fails.
- Hooks remain callable outside a provider and fail closed.
- Strict Mode effect replay does not duplicate client/listener ownership.
- Cleanup attempts client destruction even if the final flush fails.
- The package renders no visual components and imposes no styles.

## Example and verification

See [`examples/provider.tsx`](./examples/provider.tsx).

```sh
npm run typecheck --workspace @seemplify/journey-react
npm run test --workspace @seemplify/journey-react
npm run build --workspace @seemplify/journey-react
```

The focused suite covers SSR, Strict Mode leasing, shared owners, externally
managed clients, stable hooks, consent/track/page forwarding, missing-provider
behaviour, factory/readiness/call failure isolation, instance changes, and
flush/destroy cleanup.

See the repository-wide
[support matrix](https://github.com/michaelegbo/seemplify/blob/main/experience-management/packages/SDK-SUPPORT.md)
and [release/deprecation process](https://github.com/michaelegbo/seemplify/blob/main/experience-management/packages/SDK-RELEASE.md).
The declared React peer range is not a public compatibility promise until every
listed version has a green automated matrix.
