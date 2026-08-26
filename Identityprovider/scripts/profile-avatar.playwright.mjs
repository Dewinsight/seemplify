import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import ejs from 'ejs'

const clientScript = await readFile(new URL('../src/public/js/profile-avatar.js', import.meta.url), 'utf8')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR42mP8z8AARAwMjAEAGQEE/2hX9QAAAABJRU5ErkJggg==', 'base64')
const html = `<!doctype html><html><body>
  <button id="chooseAvatar">Choose</button><input id="avatarFile" type="file" hidden>
  <div id="avatarSuccess"></div><div id="avatarError"></div>
  <div id="cropOverlay" hidden><button id="cropBackdrop"></button><section>
    <button id="closeCrop"></button><div id="cropViewport" tabindex="0" style="position:relative;width:320px;height:320px;overflow:hidden"><img id="cropImage" style="position:absolute;top:50%;left:50%"></div>
    <input id="cropZoom" type="range" min="1" max="3" value="1"><button id="resetCrop"></button><p id="cropError" hidden></p>
    <button id="cancelCrop"></button><button id="applyCrop">Apply and upload</button>
  </section></div><script>${clientScript.replaceAll('</script>', '<\\/script>')}</script>
</body></html>`

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  let uploadObserved = false
  await page.route('http://identity.test/**', async (route) => {
    if (route.request().url().endsWith('/api/profile/picture')) {
      uploadObserved = route.request().method() === 'POST'
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, picture: 'https://cdn.example/avatar.jpg' }) })
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: html })
  })
  await page.goto('http://identity.test/profile/avatar')
  await page.locator('#avatarFile').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: png })
  await page.locator('#cropOverlay').waitFor({ state: 'visible' })
  await page.locator('#cropZoom').fill('2')
  await page.locator('#cropViewport').focus()
  const before = await page.locator('#cropImage').evaluate((node) => node.style.transform)
  await page.keyboard.press('ArrowRight')
  const after = await page.locator('#cropImage').evaluate((node) => node.style.transform)
  assert.notEqual(after, before)
  await page.locator('#applyCrop').click()
  await page.waitForFunction(() => document.querySelector('#avatarSuccess')?.textContent?.includes('updated'))
  assert.equal(uploadObserved, true)

  const visualPage = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const user = { email: 'member@example.test', sub: 'sub-1', profile: { name: 'Member Example', picture: 'https://cdn.example/avatar.jpg' }, organizations: [] }
  const renderedView = await ejs.renderFile(fileURLToPath(new URL('../src/views/profile-avatar.ejs', import.meta.url)), {
    user,
    brand: { name: 'Seemplify', navLogoHtml: '<strong>Seemplify</strong>' },
    activeProfileSection: 'avatar',
    currentProfileSection: 'avatar',
    profileCompletion: { complete: true },
    profileCompletionEnforced: false,
    process
  })
  const assets = new Map(await Promise.all([
    ['main.css', '../src/public/css/main.css'],
    ['profile-dashboard.css', '../src/public/css/profile-dashboard.css'],
    ['profile-avatar.css', '../src/public/css/profile-avatar.css']
  ].map(async ([name, path]) => [name, await readFile(new URL(path, import.meta.url), 'utf8')])))
  await visualPage.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    const assetName = url.pathname.split('/').pop()
    if (assets.has(assetName)) return route.fulfill({ status: 200, contentType: 'text/css', body: assets.get(assetName) })
    if (url.pathname.endsWith('.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' })
    if (url.hostname === 'cdn.example') return route.fulfill({ status: 200, contentType: 'image/png', body: png })
    return route.fulfill({ status: 200, contentType: 'text/html', body: renderedView })
  })
  await visualPage.goto('http://visual.identity.test/profile/avatar')
  await visualPage.locator('.avatar-owner-card').waitFor({ state: 'visible' })
  const layout = await visualPage.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }))
  assert.ok(layout.width <= layout.viewport, `mobile layout overflows by ${layout.width - layout.viewport}px`)
  const chooseBox = await visualPage.locator('#chooseAvatar').boundingBox()
  assert.ok(chooseBox && chooseBox.height >= 44, `primary picture action must remain touch-sized: ${chooseBox?.height || 0}px`)
  await visualPage.close()
  console.log('Identity profile picture crop/upload browser flow passed')
} finally {
  await browser.close()
}
