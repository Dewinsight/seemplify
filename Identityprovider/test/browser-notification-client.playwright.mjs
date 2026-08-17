import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { chromium } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
const client = await readFile(join(here, '..', 'src', 'public', 'js', 'seemplify-browser-realtime.js'), 'utf8')
let delivered = false
let origin = ''

const server = createServer((req, res) => {
  if (req.url === '/js/seemplify-browser-realtime.js?v=1') {
    res.writeHead(200, { 'content-type': 'application/javascript' })
    return res.end(client)
  }
  if (req.url === '/api/browser-notifications/configuration') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ enabled: true, workspaceOrigin: origin, pollIntervalMs: 50 }))
  }
  if (req.url?.startsWith('/api/browser-notifications/events')) {
    const events = delivered ? [] : [{
      version: 1,
      eventId: 'call:cross-app:ringing',
      kind: 'direct_call',
      callId: 'cross-app-call',
      title: 'Obiageli is calling',
      body: 'Incoming Workspace call from Payroll',
      deepLink: '/messaging?acceptedCall=cross-app-call',
      occurredAt: new Date().toISOString()
    }]
    delivered = true
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ events, serverTime: new Date().toISOString() }))
  }
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(`<!doctype html><html><body><main><h1>Payroll Management</h1><p>Payroll remains active while Workspace is closed.</p></main><script src="/js/seemplify-browser-realtime.js?v=1" defer></script></body></html>`)
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Browser notification fixture could not bind.')
origin = `http://127.0.0.1:${address.port}`

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.goto(`${origin}/payroll`)
  assert.equal(await page.getByRole('heading', { name: 'Payroll Management' }).isVisible(), true)
  const callCard = page.locator('#seemplify-realtime-host').locator('[role="dialog"]')
  await callCard.waitFor({ state: 'visible', timeout: 10_000 })
  assert.match(await callCard.innerText(), /Obiageli is calling/)
  const popupPromise = page.waitForEvent('popup')
  await callCard.getByRole('button', { name: 'Open call' }).click()
  const popup = await popupPromise
  await popup.waitForLoadState('domcontentloaded')
  const target = new URL(popup.url())
  assert.equal(target.pathname, '/messaging')
  assert.equal(target.searchParams.get('callId'), 'cross-app-call')
  assert.equal(target.searchParams.get('callAction'), 'accept')
  console.log('Cross-app browser notification acceptance: PASS')
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
