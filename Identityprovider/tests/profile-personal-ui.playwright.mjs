import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

import { chromium } from '@playwright/test'
import ejs from 'ejs'

import { getProfileCompletion } from '../src/utils/profileCompletion.js'
import { validatePersonalProfile } from '../src/utils/personalProfileValidation.js'

const root = new URL('..', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, value => value.slice(1))
const publicRoot = join(root, 'src', 'public')
const user = { email: 'profile-test@example.com', profile: { name: 'Profile Test', personalInfo: {} } }

function renderProfilePage() {
  const profileCompletion = getProfileCompletion(user)
  return ejs.renderFile(join(root, 'src', 'views', 'profile-personal.ejs'), {
    user,
    profileCompletion,
    profileSetupMode: true,
    activeProfileSection: 'personal',
    currentProfileSection: 'personal',
    profileCompletionEnforced: false,
    activePage: 'profile',
    brand: { name: 'Seemplify' },
    pendingOnboardingCount: 0,
    pendingOnboardingAssignments: [],
    notificationSummary: {},
    currentOrganization: null,
    organizations: [],
    isAdmin: false
  })
}

async function renderProfileWizardPage() {
  const wizard = await ejs.renderFile(join(root, 'src', 'views', 'partials', 'profile-completion-wizard.ejs'), {
    profileCompletion: getProfileCompletion(user),
    profileCompletionEnforced: true,
    currentProfileSection: ''
  })
  return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/css/main.css"><style>${await readFile(join(publicRoot, 'css', 'idp-theme.css'), 'utf8')}</style></head><body class="idp-workspace-page"><main><h1>Identity home</h1></main>${wizard}</body></html>`
}

function mimeType(pathname) {
  return ({ '.css': 'text/css', '.js': 'text/javascript' })[extname(pathname)] || 'application/octet-stream'
}

async function readRequestBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  if (request.method === 'GET' && url.pathname === '/profile/personal') {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    return response.end(await renderProfilePage())
  }
  if (request.method === 'GET' && url.pathname === '/dashboard') {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    return response.end(await renderProfileWizardPage())
  }
  if (request.method === 'GET' && url.pathname === '/api/invitations/pending') {
    response.setHeader('content-type', 'application/json')
    return response.end('[]')
  }
  if (request.method === 'GET' && url.pathname === '/') {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    return response.end('<!doctype html><html><body><h1>Identity home</h1></body></html>')
  }
  if (request.method === 'PUT' && url.pathname === '/api/profile/personal') {
    const validation = validatePersonalProfile(await readRequestBody(request))
    response.setHeader('content-type', 'application/json')
    if (!validation.valid) {
      response.statusCode = 422
      return response.end(JSON.stringify({ error: 'Check the fields and try again.', fieldErrors: validation.fieldErrors }))
    }
    user.profile.personalInfo = validation.value
    const completion = getProfileCompletion(user)
    return response.end(JSON.stringify({ success: true, profileCompletion: completion }))
  }
  if (request.method === 'GET' && (url.pathname.startsWith('/css/') || url.pathname.startsWith('/js/'))) {
    const relativePath = normalize(url.pathname).replace(/^[/\\]+/, '')
    const filePath = join(publicRoot, relativePath)
    if (!filePath.startsWith(publicRoot)) {
      response.statusCode = 403
      return response.end('Forbidden')
    }
    try {
      response.setHeader('content-type', mimeType(filePath))
      return response.end(await readFile(filePath))
    } catch {
      response.statusCode = 404
      return response.end('Not found')
    }
  }
  response.statusCode = 404
  response.end('Not found')
})

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
const baseUrl = `http://127.0.0.1:${address.port}`

if (process.argv.includes('--serve')) {
  console.log(`Profile UI preview: ${baseUrl}/profile/personal?wizard=1`)
  await new Promise(resolve => process.once('SIGINT', resolve))
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  process.exit(0)
}

const browser = await chromium.launch({ headless: true })

try {
  const wizardPage = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await wizardPage.goto(`${baseUrl}/dashboard`)
  assert.equal(await wizardPage.getByRole('dialog', { name: 'Complete your employee profile' }).isVisible(), true)
  assert.match(await wizardPage.getByRole('dialog').innerText(), /0 of 1 required sections completed/i)
  assert.equal(await wizardPage.getByRole('button', { name: 'Close wizard' }).count(), 0)
  await wizardPage.getByRole('button', { name: 'Complete Setup' }).click()
  await wizardPage.waitForURL(`${baseUrl}/profile/personal?wizard=1`)
  await wizardPage.close()

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`${baseUrl}/profile/personal?wizard=1`)
  assert.equal(await page.locator('#alertError').isVisible(), false)
  assert.equal(await page.locator('#alertSuccess').isVisible(), false)

  await page.getByRole('button', { name: 'Save and continue' }).click()
  await page.getByRole('alert').waitFor()
  assert.match(await page.getByRole('alert').innerText(), /fields need attention/i)
  assert.equal(await page.locator('#dateOfBirth').getAttribute('aria-invalid'), 'true')
  assert.equal(await page.locator('#emergencyContactSection').getAttribute('aria-invalid'), 'true')
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'dateOfBirth')

  await page.getByLabel('Date of birth').fill('1990-04-20')
  await page.getByLabel('Date of birth').dispatchEvent('change')
  assert.match(await page.locator('#profileChecklistCount').innerText(), /1 of 4 ready/i)
  assert.equal(await page.locator('.profile-requirement.is-complete').count(), 1)
  await page.getByLabel('Street address').fill('12 Example Street')
  await page.getByLabel('City').fill('London')
  await page.getByLabel('Postal or ZIP code').fill('SW1A 1AA')
  await page.getByLabel('Country').fill('United Kingdom')
  await page.getByLabel('Mobile phone').fill('+44 7700 900123')
  assert.match(await page.locator('#profileChecklistCount').innerText(), /3 of 4 ready/i)

  await page.getByRole('button', { name: 'Add contact' }).click()
  assert.equal(await page.locator('#contactName').getAttribute('aria-invalid'), 'true')
  await page.getByLabel('Full name').fill('Jane Example')
  assert.equal(await page.locator('#contactName').getAttribute('aria-invalid'), 'false')
  await page.getByLabel('Relationship').fill('Friend')
  assert.equal(await page.locator('#contactRelationship').getAttribute('aria-invalid'), 'false')
  await page.getByLabel('Phone number', { exact: true }).fill('+44 7700 900456')
  assert.equal(await page.locator('#contactPhone').getAttribute('aria-invalid'), 'false')
  await page.getByRole('button', { name: 'Save and continue' }).click()
  assert.match(await page.getByRole('alert').innerText(), /select “add contact” to add these contact details/i)
  assert.equal(await page.locator('#emergencyContactSection').getAttribute('aria-invalid'), 'true')
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'emergencyContactSection')
  await page.getByRole('button', { name: 'Add contact' }).click()
  assert.match(await page.locator('#profileChecklistCount').innerText(), /4 of 4 ready/i)
  assert.equal(await page.locator('.profile-requirement.is-complete').count(), 4)

  await page.route('**/api/profile/personal', route => route.fulfill({
    status: 422,
    contentType: 'application/json',
    body: JSON.stringify({ fieldErrors: { zipCode: 'Enter the postcode used for your employee record.' } })
  }))
  await page.getByRole('button', { name: 'Save and continue' }).click()
  await page.locator('#alertErrorMessage').filter({ hasText: /postcode used for your employee record/i }).waitFor()
  assert.match(await page.getByRole('alert').innerText(), /1 field needs attention.*postcode used for your employee record/i)
  assert.equal(await page.locator('#zipCode').getAttribute('aria-invalid'), 'true')
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'zipCode')
  await page.unroute('**/api/profile/personal')

  await page.route('**/api/profile/personal', route => route.fulfill({ status: 503, contentType: 'text/html', body: 'Temporarily unavailable' }))
  await page.getByRole('button', { name: 'Save and continue' }).click()
  await page.locator('#alertErrorMessage').filter({ hasText: /could not save your profile/i }).waitFor()
  assert.match(await page.getByRole('alert').innerText(), /could not save your profile.*entries are still on this page/i)
  assert.equal(await page.getByLabel('Street address').inputValue(), '12 Example Street')
  assert.equal(await page.getByRole('button', { name: 'Save and continue' }).isEnabled(), true)
  await page.unroute('**/api/profile/personal')

  await page.route('**/api/profile/personal', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }))
  await page.getByRole('button', { name: 'Save and continue' }).click()
  await page.locator('#alertErrorMessage').filter({ hasText: /session expired/i }).waitFor()
  assert.match(await page.getByRole('alert').innerText(), /session expired/i)
  assert.equal(await page.getByRole('link', { name: 'Sign in again' }).getAttribute('href'), '/login')
  await page.unroute('**/api/profile/personal')

  await page.getByRole('button', { name: 'Save and continue' }).click()
  await page.waitForURL(`${baseUrl}/`)
  assert.equal(await page.getByRole('heading', { name: 'Identity home' }).isVisible(), true)

  await page.goto(`${baseUrl}/profile/personal`)
  assert.match(await page.locator('#profileChecklistCount').innerText(), /4 of 4 ready/i)
  assert.match(await page.locator('.profile-nav-status').innerText(), /complete/i)
  assert.equal(await page.getByLabel('Street address').inputValue(), '12 Example Street')
  assert.equal(await page.locator('.profile-requirement.is-complete').count(), 4)

  user.profile.personalInfo = {}
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await mobile.goto(`${baseUrl}/profile/personal?wizard=1`)
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  assert.equal(await mobile.locator('.profile-setup-checklist__items').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 1)
  await mobile.getByRole('button', { name: 'Save and continue' }).click()
  assert.equal(await mobile.locator('#emergencyContactSection').getAttribute('aria-invalid'), 'true')
  await mobile.close()
  await page.close()
  console.log('Profile onboarding UI checks passed on desktop and mobile.')
} finally {
  await browser.close()
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}
