import assert from 'node:assert/strict'
import { once } from 'node:events'
import express from 'express'
import { chromium } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const app = express()
app.set('view engine', 'ejs')
app.set('views', path.join(root, 'src', 'views'))
app.use('/css', express.static(path.join(root, 'src', 'public', 'css')))
app.use('/js', express.static(path.join(root, 'src', 'public', 'js')))
app.get('/admin/calls', (_req, res) => res.render('admin/calls', {
  brand: { name: 'Seemplify', navLogoHtml: '<span>Seemplify</span>' },
  admin: { name: 'Platform Admin', isSuperAdmin: true },
  adminStats: { pendingRequests: 0, pendingDemoRequests: 0 },
  callsError: '', notice: '', noticeType: 'success',
  dashboard: {
    generatedAt: new Date().toISOString(),
    totals: { activeCalls: 2, participants: 7, guestParticipants: 2 },
    resources: {
      host: { cpuCores: 8, loadAverage1m: 2, cpuLoadPercent: 25, totalMemoryBytes: 16e9, usedMemoryBytes: 8e9, memoryUsedPercent: 50, processRssBytes: 700e6 },
      mediaWorkers: { total: 4, busy: 2, utilizationPercent: 50 },
      mediaGraph: { rooms: 2, producers: 9, consumers: 14 }
    },
    calls: [{ id: 'call-1', title: 'Product review', organizationName: 'Dew Insight', participantCount: 7, participants: [{ displayName: 'Ada', participantType: 'member' }, { displayName: 'Guest reviewer', participantType: 'guest' }], mode: 'mediasoup', kind: 'instant', access: 'invited', allowGuests: true, startedAt: new Date().toISOString() }]
  }
}))

const server = app.listen(0, '127.0.0.1')
await once(server, 'listening')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(`http://127.0.0.1:${server.address().port}/admin/calls`)
  await page.getByRole('heading', { name: 'Live Calls' }).waitFor()
  assert.equal(await page.getByText('Product review').isVisible(), true)
  assert.equal(await page.getByRole('button', { name: 'End all calls' }).isVisible(), true)
  assert.equal(await page.getByRole('button', { name: 'End call', exact: true }).isVisible(), true)
  await page.setViewportSize({ width: 390, height: 844 })
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    offenders: Array.from(document.querySelectorAll('*')).map((element) => {
      const rect = element.getBoundingClientRect()
      return { tag: element.tagName, className: element.className, right: rect.right, width: rect.width }
    }).filter((entry) => entry.right > document.documentElement.clientWidth + 1).slice(0, 8)
  }))
  assert.equal(overflow.scrollWidth <= overflow.clientWidth, true, JSON.stringify(overflow))
  const targets = await page.locator('.admin-content button, .admin-content a').evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect()
    return { width: rect.width, height: rect.height, visible: rect.width > 0 && rect.height > 0 }
  }).filter((entry) => entry.visible))
  assert.equal(targets.every((target) => target.height >= 32), true)
  console.log('WORKSPACE_CALL_ADMIN_UI_OK')
} finally {
  await browser.close()
  server.close()
}
