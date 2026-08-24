import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'
import ejs from 'ejs'

import { CAMPAIGN_AUDIENCE_FIELDS } from '../src/services/campaignAudienceService.js'
import { getSystemCampaignTemplates } from '../src/services/campaignTemplateLibrary.js'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const identityRoot = path.resolve(testDirectory, '..')
const repositoryRoot = path.resolve(identityRoot, '..')
const viewPath = path.join(identityRoot, 'src', 'views', 'admin', 'campaigns.ejs')
const consoleScriptPath = path.join(identityRoot, 'src', 'public', 'js', 'admin-campaign-console.js')
const adminCssPath = path.join(identityRoot, 'src', 'public', 'css', 'admin.css')
const screenshotPath = process.env.CAMPAIGN_BUILDER_QA_SCREENSHOT || path.join(testDirectory, 'campaign-builder-qa.png')
const audienceScreenshotPath = process.env.CAMPAIGN_AUDIENCE_QA_SCREENSHOT || ''

const templates = getSystemCampaignTemplates().map((template, index) => ({
  ...template,
  _id: `template-${index + 1}`,
  content: {
    subject: template.subject,
    previewText: template.previewText,
    designMode: template.designMode,
    design: template.design,
    htmlContent: template.htmlContent || '',
    textContent: template.textContent || ''
  }
}))

let html = await ejs.renderFile(viewPath, {
  workspaceTitle: 'Create Campaign',
  workspaceDescription: 'Build, sequence, test, and launch Seemplify campaigns.',
  campaigns: [],
  audiences: [{ _id: 'audience-1', name: 'Existing audience', contactCount: 12 }],
  templates,
  senderHealth: [{ email: 'campaigns@seemplifyai.com', readinessBand: 'green', readinessReasons: ['Ready'] }],
  audienceFields: CAMPAIGN_AUDIENCE_FIELDS,
  selectedCampaign: null,
  workspaceMode: 'create',
  brand: { navLogoHtml: '<strong>seemplify.</strong>' },
  admin: { name: 'QA Admin', isSuperAdmin: true },
  adminStats: { pendingRequests: 0, pendingDemoRequests: 0 }
})

html = html
  .replace(/<script src="\/js\/theme\.js[^>]*><\/script>/i, '')
  .replace(/<script src="\/js\/admin-campaign-console\.js"><\/script>/i, '')
  .replace(/<link rel="stylesheet" href="\/css\/admin\.css">/i, '')
  .replaceAll('src="/images/seemplifylogo.png"', 'src="https://auth.seemplifyai.com/images/seemplifylogo.png"')
html = html.replace('<head>', '<head><base href="https://auth.seemplifyai.com/">')
html = html.replace('</head>', `<style>${await readFile(adminCssPath, 'utf8')}</style></head>`)

function localImagePath(url) {
  const authPrefix = 'https://auth.seemplifyai.com/images/'
  const marketingPrefix = 'https://seemplifyai.com/images/'
  if (url.startsWith(authPrefix)) {
    return path.join(identityRoot, 'src', 'public', 'images', ...url.slice(authPrefix.length).split('/'))
  }
  if (url.startsWith(marketingPrefix)) {
    return path.join(repositoryRoot, 'marketing-site', 'public', 'images', ...url.slice(marketingPrefix.length).split('/'))
  }
  return ''
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 1 })
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))
await page.route('https://**/*', async (route) => {
  const fixturePath = localImagePath(route.request().url())
  if (!fixturePath) {
    await route.abort()
    return
  }
  await route.fulfill({
    body: await readFile(fixturePath),
    contentType: fixturePath.endsWith('.png') ? 'image/png' : fixturePath.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
  })
})

try {
  await page.setContent(html, { waitUntil: 'domcontentloaded' })
  await page.evaluate(({ audienceFields }) => {
    const existingAudience = {
      _id: 'audience-1',
      name: 'Existing audience',
      contactCount: 12,
      sourceType: 'csv'
    }
    const customerAudience = {
      _id: 'audience-customers',
      name: 'Current customers',
      contactCount: 2,
      sourceType: 'customers'
    }
    const importedAudience = {
      _id: 'audience-imported',
      name: 'Payroll contacts',
      contactCount: 2,
      sourceType: 'csv'
    }
    const audiences = [existingAudience]
    window.fetch = async (input, init = {}) => {
      const url = String(input)
      const method = String(init.method || 'GET').toUpperCase()
      if (url.endsWith('/api/admin/campaigns') && method === 'POST') {
        const body = JSON.parse(String(init.body || '{}'))
        window.__savedCampaignPayload = body
        const campaign = {
          _id: 'campaign-qa',
          name: body.name,
          audience: body.audienceId,
          sender: { name: body.senderName, email: body.senderEmail, readinessBand: 'green' },
          content: {
            subject: body.subject,
            previewText: body.previewText,
            replyTo: body.replyTo,
            designMode: body.designMode,
            design: body.design,
            htmlContent: body.htmlContent,
            textContent: body.textContent,
            template: { templateId: body.templateId }
          },
          sequence: body.sequence,
          pacing: { batchSize: body.batchSize, intervalMinutes: body.intervalMinutes },
          tracking: {
            utmSource: body.utmSource,
            utmMedium: body.utmMedium,
            utmCampaign: body.utmCampaign,
            allowExternalLinkDecoration: body.allowExternalLinkDecoration
          },
          testSendEmails: body.testSendEmails,
          status: 'draft'
        }
        return new Response(JSON.stringify({ message: 'Campaign saved.', campaign }), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/api/admin/campaigns') && method === 'GET') {
        return new Response(JSON.stringify({ campaigns: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/api/admin/campaign-senders/health')) {
        return new Response(JSON.stringify({ senders: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/campaign-customers')) {
        return new Response(JSON.stringify({ contacts: [
          { accountId: 'account-1', email: 'alex@example.test', firstName: 'Alex', lastName: 'Morgan', role: 'owner', companyName: 'Northstar', planName: 'Growth' },
          { accountId: 'account-2', email: 'sam@example.test', firstName: 'Sam', lastName: 'Okafor', role: 'hr_manager', companyName: 'Brightworks', subscriptionStatus: 'active' }
        ] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/campaign-audiences/from-customers') && method === 'POST') {
        if (!audiences.some((audience) => audience._id === customerAudience._id)) audiences.push(customerAudience)
        return new Response(JSON.stringify({ message: 'Customer audience created.', audience: customerAudience }), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/campaign-audiences/preview') && method === 'POST') {
        return new Response(JSON.stringify({
          fields: audienceFields,
          preview: {
            sourceType: 'csv',
            sourceFileName: 'payroll-contacts.csv',
            sheetNames: [],
            selectedSheetName: '',
            headers: ['Email', 'First Name', 'Company'],
            sampleRows: [
              ['ada@example.test', 'Ada', 'Analytical Engine'],
              ['grace@example.test', 'Grace', 'Compiler Works']
            ],
            totalRows: 2,
            columnMap: { email: 'Email', firstName: 'First Name', companyName: 'Company' },
            errors: []
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/campaign-audiences/import') && method === 'POST') {
        if (!audiences.some((audience) => audience._id === importedAudience._id)) audiences.push(importedAudience)
        return new Response(JSON.stringify({ message: 'Audience imported successfully.', audience: importedAudience }), { status: 201, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/api/admin/campaign-audiences')) {
        return new Response(JSON.stringify({ audiences }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
  }, { audienceFields: CAMPAIGN_AUDIENCE_FIELDS })
  await page.addScriptTag({ path: consoleScriptPath })

  assert.equal(await page.locator('[data-workspace-step-target]').count(), 5)
  assert.equal(await page.locator('#templateList .campaign-template-card').count(), templates.length)
  assert.equal(await page.locator('#templateList .campaign-template-card-preview').count(), templates.length)
  assert.equal(await page.locator('.campaign-preview-brand img[alt="Seemplify"]').count(), 1)
  await page.locator('#templateSearchInput').fill('Payroll')
  assert.equal(await page.locator('#templateList .campaign-template-card').count(), 1)
  await page.locator('#templateList [data-apply-template]').click()
  assert.equal(await page.locator('[data-workspace-step-target="content"]').evaluate((element) => element.classList.contains('is-active')), true)
  assert.match(await page.locator('#visualPreview').textContent(), /Run payroll with calm/i)
  await page.locator('#templateSearchInput').fill('')
  await page.locator('[data-workspace-step-target="sequence"]').click()
  await page.locator('#addSequenceStepBtn').click()
  assert.equal(await page.locator('#sequenceStepList .campaign-sequence-card').count(), 2)
  assert.match(await page.locator('#sequenceStepSummary').textContent(), /2 messages/)

  await page.locator('#designSequenceStepBtn').click()
  const imageBlocksBeforeAdd = await page.locator('#visualPreview [data-type="image"]').count()
  await page.locator('[data-add-block="image"]').click()
  assert.equal(await page.locator('#visualPreview [data-type="image"]').count(), imageBlocksBeforeAdd + 1)
  await page.locator('#mobilePreviewBtn').click()
  assert.equal(await page.locator('#campaignPreviewCanvas').evaluate((element) => element.classList.contains('is-mobile')), true)

  await page.locator('#htmlModeBtn').click()
  const htmlSource = await page.locator('#htmlEditor').inputValue()
  assert.match(htmlSource, /role="presentation"/)
  assert.doesNotMatch(htmlSource, /display:grid/)
  await page.locator('#htmlPreview').fill('<h2>Edited directly in the live preview</h2>')
  assert.match(await page.locator('#htmlEditor').inputValue(), /Edited directly in the live preview/)

  await page.locator('[data-workspace-step-target="audience"]').click()
  await page.setViewportSize({ width: 1180, height: 900 })
  await page.locator('#audienceWorkspaceSelect').waitFor({ state: 'visible' })
  assert.equal(await page.locator('#audienceWorkspaceMount #audienceUploadForm').count(), 1)
  assert.equal(await page.locator('#audienceWorkspaceMount #customerContactList').count(), 1)
  assert.equal(await page.locator('#audienceWorkspaceMount #audienceList').count(), 1)
  assert.equal(await page.locator('#audienceFile').isVisible(), true)
  const audienceFileBox = await page.locator('#audienceFile').boundingBox()
  const nextStepBox = await page.locator('#campaignStepNextBtn').boundingBox()
  assert.ok(audienceFileBox && nextStepBox && audienceFileBox.y < nextStepBox.y, 'file upload should appear inside the Audience step before its Next button')
  await page.setViewportSize({ width: 1536, height: 1024 })
  await page.locator('#audienceWorkspaceSelect').selectOption('audience-1')
  assert.equal(await page.locator('#campaignAudience').inputValue(), 'audience-1')
  assert.match(await page.locator('#audienceWorkspaceStatus').textContent(), /attached to this campaign/i)

  await page.locator('.campaign-customer-row').first().waitFor({ state: 'visible' })
  assert.equal(await page.locator('.campaign-customer-row').count(), 2)
  await page.locator('#selectVisibleCustomersBtn').click()
  assert.match(await page.locator('#customerSelectionCount').textContent(), /2 selected/)
  await page.locator('#customerAudienceName').fill('Current customers')
  await page.locator('#customerConsentConfirmed').check()
  await page.locator('#createCustomerAudienceBtn').click()
  await page.locator('#customerAudienceStatus.success').waitFor({ state: 'visible' })
  assert.equal(await page.locator('#campaignAudience').inputValue(), 'audience-customers')
  assert.equal(await page.locator('#audienceWorkspaceSelect').inputValue(), 'audience-customers')

  await page.locator('#audienceFile').setInputFiles({
    name: 'payroll-contacts.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Email,First Name,Company\nada@example.test,Ada,Analytical Engine\ngrace@example.test,Grace,Compiler Works\n')
  })
  assert.equal(await page.locator('#audienceName').inputValue(), 'payroll-contacts')
  await page.locator('#audiencePreviewBtn').click()
  await page.locator('#audienceMappingPanel').waitFor({ state: 'visible' })
  assert.equal(await page.locator('[data-audience-map="email"]').inputValue(), 'Email')
  assert.match(await page.locator('#audiencePreviewMeta').textContent(), /2/)
  await page.locator('#audienceConsentConfirmed').check()
  assert.equal(await page.locator('#audienceImportBtn').isEnabled(), true)
  await page.locator('#audienceImportBtn').click()
  await page.waitForFunction(() => document.querySelector('#campaignAudience')?.value === 'audience-imported')
  await page.locator('#audienceImportStatus.success').waitFor({ state: 'visible' })
  assert.equal(await page.locator('#campaignAudience').inputValue(), 'audience-imported')
  assert.equal(await page.locator('#audienceWorkspaceSelect').inputValue(), 'audience-imported')
  if (audienceScreenshotPath) await page.screenshot({ path: audienceScreenshotPath, fullPage: true })

  page.on('dialog', (dialog) => dialog.dismiss())
  await page.locator('#campaignName').evaluate((element) => {
    element.value = 'QA customer sequence'
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.locator('#senderEmail').evaluate((element) => {
    element.value = 'campaigns@seemplifyai.com'
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.locator('#saveCampaignBtn').click()
  await page.waitForFunction(() => window.__savedCampaignPayload?.sequence?.steps?.length === 2)
  const savedPayload = await page.evaluate(() => window.__savedCampaignPayload)
  assert.equal(savedPayload.sequence.enabled, true)
  assert.equal(savedPayload.sequence.steps[1].content.htmlContent.includes('Edited directly in the live preview'), true)
  assert.equal(savedPayload.audienceId, 'audience-imported')

  await page.locator('[data-workspace-step-target="content"]').click()
  await page.locator('#visualModeBtn').click()
  await page.screenshot({ path: screenshotPath, fullPage: true })
  assert.deepEqual(pageErrors, [])
  console.log(`Campaign builder UI QA passed. Screenshot: ${screenshotPath}`)
} finally {
  await browser.close()
}
