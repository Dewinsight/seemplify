import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import type { BrowserJourneySdk } from '@seemplify/journey-browser-sdk';
import { JourneyProvider } from '../src/index.js';

test('server rendering is inert and never creates an owned browser client', () => {
  let creations = 0;
  const html = renderToString(
    <JourneyProvider
      config={{
        writeKey: 'jpk_dev.react_ssr_01.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        endpoint: 'https://react.example.test',
        environment: 'development'
      }}
      instanceKey="ssr"
      clientFactory={() => {
        creations += 1;
        throw new Error('a client must not be constructed during SSR');
      }}
    >
      <span>SSR remains available</span>
    </JourneyProvider>
  );
  assert.equal(html, '<span>SSR remains available</span>');
  assert.equal(creations, 0);
});

test('server rendering can expose an externally managed client without invoking browser globals', () => {
  const external = {
    ready: Promise.resolve(),
    enabled: true
  } as BrowserJourneySdk;
  const html = renderToString(<JourneyProvider client={external}><span>External SSR</span></JourneyProvider>);
  assert.equal(html, '<span>External SSR</span>');
});
