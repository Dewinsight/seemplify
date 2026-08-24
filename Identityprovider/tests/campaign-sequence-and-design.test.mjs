import assert from 'node:assert/strict'
import test from 'node:test'

import {
  conditionMatchesEngagement,
  getCampaignSequenceSteps,
  recipientHasSequenceExit,
  sequenceDelayMilliseconds
} from '../src/services/campaignOperationsService.js'
import {
  compileCampaignTemplateContent,
  renderVisualEmail,
  sanitizeHtml
} from '../src/services/campaignRenderer.js'
import { getSystemCampaignTemplates } from '../src/services/campaignTemplateLibrary.js'
import { summarizeSequenceBatches } from '../src/services/campaignAnalyticsService.js'

test('sequence delays and engagement branches are deterministic', () => {
  assert.equal(sequenceDelayMilliseconds({ value: 15, unit: 'minutes' }), 900_000)
  assert.equal(sequenceDelayMilliseconds({ value: 3, unit: 'hours' }), 10_800_000)
  assert.equal(sequenceDelayMilliseconds({ value: 2, unit: 'days' }), 172_800_000)
  assert.equal(conditionMatchesEngagement('opened_previous', { opened: true }), true)
  assert.equal(conditionMatchesEngagement('not_opened_previous', { opened: true }), false)
  assert.equal(conditionMatchesEngagement('clicked_previous', { clicked: true }), true)
  assert.equal(conditionMatchesEngagement('not_clicked_previous', {}), true)
})

test('sequence steps sort by position and a single-message campaign has a safe fallback', () => {
  const sorted = getCampaignSequenceSteps({
    sequence: {
      enabled: true,
      steps: [
        { name: 'Second', position: 2, delay: { value: 2, unit: 'days' }, content: { subject: 'B' } },
        { name: 'First', position: 0, delay: { value: 4, unit: 'hours' }, content: { subject: 'A' } }
      ]
    }
  })
  assert.deepEqual(sorted.map((step) => step.name), ['First', 'Second'])
  assert.deepEqual(sorted[0].delay, { value: 0, unit: 'minutes' })

  const fallback = getCampaignSequenceSteps({ content: { subject: 'Only message' } })
  assert.equal(fallback.length, 1)
  assert.equal(fallback[0].content.subject, 'Only message')
})

test('recipient sequence exits fail closed for complaints and respect configured stops', () => {
  assert.equal(recipientHasSequenceExit({ status: 'unsubscribed' }, { stopOnUnsubscribe: true }), 'unsubscribed')
  assert.equal(recipientHasSequenceExit({ status: 'bounced' }, { stopOnBounce: true }), 'bounced')
  assert.equal(recipientHasSequenceExit({ status: 'converted' }, { stopOnConversion: true }), 'converted')
  assert.equal(recipientHasSequenceExit({ status: 'complained' }, { stopOnUnsubscribe: false }), 'complained')
  assert.equal(recipientHasSequenceExit({ status: 'unsubscribed' }, { stopOnUnsubscribe: false }), 'unsubscribed')
  assert.equal(recipientHasSequenceExit({ status: 'bounced' }, { stopOnBounce: false }), 'bounced')
})

test('the system library covers the platform and every template has visual, trial, and compliance content', () => {
  const templates = getSystemCampaignTemplates()
  const slugs = new Set(templates.map((template) => template.slug))
  assert.ok(templates.length >= 15)
  for (const expected of ['welcome-to-seemplify', 'product-payroll', 'product-recruiter', 'product-time-attendance', 'product-automations', 'product-workspace']) {
    assert.equal(slugs.has(expected), true, `missing ${expected}`)
  }

  templates.forEach((template) => {
    assert.equal(template.designMode, 'visual')
    assert.match(template.subject, /\{\{ contact\.FIRSTNAME \}\}/)
    assert.ok(String(template.previewText || '').length > 20)
    assert.ok(Array.isArray(template.design?.blocks) && template.design.blocks.length >= 5)
    assert.ok(template.design.blocks.some((block) => block.type === 'hero' && /^https:\/\//.test(block.imageUrl || '')))
    assert.ok(template.design.blocks.some((block) => block.type === 'cta' && /seven-day|7-day/i.test(`${block.title} ${block.body} ${block.ctaLabel}`)))
    assert.ok(template.design.blocks.some((block) => block.type === 'footer' && /unsubscribe/i.test(block.body || '')))
  })
})

test('visual campaigns render responsive email tables, generated imagery, preheader, and accessible motion', () => {
  const template = getSystemCampaignTemplates().find((entry) => entry.slug === 'welcome-to-seemplify')
  const campaign = {
    name: 'Welcome campaign',
    content: {
      subject: 'Welcome to Seemplify',
      previewText: 'One operating system for your people journey.',
      designMode: 'visual',
      design: template.design
    }
  }
  const rendered = renderVisualEmail(template.design, { campaign, recipient: {} })
  assert.match(rendered, /role="presentation"/)
  assert.match(rendered, /seemplify-platform-gloss\.jpg/)
  assert.match(rendered, /prefers-reduced-motion/)
  assert.match(rendered, /display:none;max-height:0/)
  assert.doesNotMatch(rendered, /display:grid/)

  const compiled = compileCampaignTemplateContent(campaign)
  assert.equal(compiled.subject, 'Welcome to Seemplify')
  assert.match(compiled.text, /Every people workflow/)
})

test('raw HTML mode strips active content before personalization', () => {
  const sanitized = sanitizeHtml('<div onclick="steal()">Safe</div><script>alert(1)</script><a href="javascript:bad()">Link</a>')
  assert.doesNotMatch(sanitized, /onclick|<script|javascript:/i)
  assert.match(sanitized, /Safe/)
})

test('visual buttons reject unsafe protocols', () => {
  const rendered = renderVisualEmail({
    blocks: [{ type: 'cta', title: 'Safe CTA', ctaLabel: 'Open', ctaUrl: 'javascript:alert(1)' }]
  }, { campaign: { content: {} }, recipient: {} })
  assert.doesNotMatch(rendered, /javascript:/i)
  assert.doesNotMatch(rendered, />Open<\/a>/)
})

test('sequence analytics separates message-level delivery and engagement', () => {
  const summary = summarizeSequenceBatches([
    { stepIndex: 1, stepName: 'Follow-up', status: 'pending', recipientCount: 40, metrics: { sent: 0 } },
    { stepIndex: 0, stepName: 'Message 1', status: 'sent', recipientCount: 40, metrics: { sent: 40, opened: 12, proxyOpens: 3, clicked: 5 } },
    { stepIndex: 0, stepName: 'Message 1', status: 'failed', recipientCount: 20, metrics: { sent: 0 } }
  ])
  assert.deepEqual(summary.map((step) => step.stepName), ['Message 1', 'Follow-up'])
  assert.equal(summary[0].batches, 2)
  assert.equal(summary[0].opened, 15)
  assert.equal(summary[0].failed, 1)
  assert.equal(summary[1].pending, 1)
})
