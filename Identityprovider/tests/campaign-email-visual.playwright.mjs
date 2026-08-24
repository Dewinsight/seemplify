import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

import { renderVisualEmail } from '../src/services/campaignRenderer.js'
import { getSystemCampaignTemplate } from '../src/services/campaignTemplateLibrary.js'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const identityRoot = path.resolve(testDirectory, '..')
const repositoryRoot = path.resolve(identityRoot, '..')
const screenshotDirectory = process.env.CAMPAIGN_EMAIL_QA_DIR || testDirectory

const imageRoutes = new Map([
  ['https://auth.seemplifyai.com/images/seemplifylogo.png', path.join(identityRoot, 'src', 'public', 'images', 'seemplifylogo.png')],
  ['https://auth.seemplifyai.com/images/campaigns/seemplify-platform-gloss.jpg', path.join(identityRoot, 'src', 'public', 'images', 'campaigns', 'seemplify-platform-gloss.jpg')],
  ['https://auth.seemplifyai.com/images/campaigns/payroll-gloss.jpg', path.join(identityRoot, 'src', 'public', 'images', 'campaigns', 'payroll-gloss.jpg')],
  ['https://auth.seemplifyai.com/images/campaigns/people-journey-gloss.jpg', path.join(identityRoot, 'src', 'public', 'images', 'campaigns', 'people-journey-gloss.jpg')],
  ['https://seemplifyai.com/images/product-showcases/payroll.png', path.join(repositoryRoot, 'marketing-site', 'public', 'images', 'product-showcases', 'payroll.png')]
])

const browser = await chromium.launch({ headless: true })
try {
  for (const slug of ['welcome-to-seemplify', 'product-payroll']) {
    const template = getSystemCampaignTemplate(slug)
    assert.ok(template, `Missing ${slug}`)
    const page = await browser.newPage({ viewport: { width: 820, height: 1000 }, deviceScaleFactor: 1 })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('https://**/*', async (route) => {
      const localPath = imageRoutes.get(route.request().url())
      if (!localPath) return route.abort()
      const body = await readFile(localPath)
      await route.fulfill({
        status: 200,
        contentType: localPath.endsWith('.png') ? 'image/png' : 'image/jpeg',
        body
      })
    })

    const campaign = {
      name: template.name,
      content: {
        subject: template.subject,
        previewText: template.previewText,
        design: template.design
      }
    }
    await page.setContent(renderVisualEmail(template.design, { campaign, recipient: {} }), { waitUntil: 'networkidle' })
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' })
    const shellWidth = await page.locator('.seemplify-shell').evaluate((element) => element.getBoundingClientRect().width)
    assert.ok(shellWidth <= 640)
    assert.equal(await page.locator('img').evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)), true)
    assert.deepEqual(errors, [])
    const screenshotPath = path.join(screenshotDirectory, `${slug}-email-qa.png`)
    await page.screenshot({ path: screenshotPath, fullPage: true })
    console.log(`${slug} email visual QA passed. Screenshot: ${screenshotPath}`)
    await page.close()
  }
} finally {
  await browser.close()
}
