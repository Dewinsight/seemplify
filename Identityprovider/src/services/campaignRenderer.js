import { createCampaignAttributionToken, isSeemplifyOwnedUrl, withCampaignTrackingParams } from './campaignAttributionService.js'

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function stripHtml(value = '') {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function sanitizeHtml(rawHtml = '') {
  let html = String(rawHtml || '')
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '')
  html = html.replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
  html = html.replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
  html = html.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
  html = html.replace(/javascript:/gi, '')
  return html
}

export function normalizeDesign(input = {}) {
  const theme = input?.theme || {}
  const blocks = Array.isArray(input?.blocks) ? input.blocks : []
  return {
    version: Number(input?.version || 1),
    theme: {
      background: theme.background || '#f6f0ff',
      surface: theme.surface || '#ffffff',
      accent: theme.accent || '#6d28d9',
      accentSecondary: theme.accentSecondary || '#a855f7',
      heading: theme.heading || '#1f1637',
      text: theme.text || '#3f3656',
      muted: theme.muted || '#6d6485',
      footer: theme.footer || '#221934'
    },
    blocks
  }
}

function getRecipientAttributes(recipient = {}) {
  return {
    FIRSTNAME: recipient.firstName || '',
    LASTNAME: recipient.lastName || '',
    EMAIL: recipient.email || '',
    ROLE: recipient.role || '',
    JOBTITLE: recipient.jobTitle || '',
    JOBLEVEL: recipient.jobLevel || '',
    DEPARTMENT: recipient.department || '',
    COMPANYNAME: recipient.companyName || '',
    INDUSTRY: recipient.industry || '',
    HEADCOUNT: recipient.headcount || '',
    LOCATION: recipient.location || '',
    COMPANYDESCRIPTION: recipient.companyDescription || '',
    CUSTOM_OPENING: recipient.personalization?.customOpening || '',
    CUSTOM_BENEFITS: recipient.personalization?.customBenefits || '',
    FREE_TRIAL_URL: recipient.personalization?.freeTrialUrl || 'https://auth.seemplifyai.com/signup'
  }
}

function getCampaignAttributes(campaign = {}) {
  return {
    NAME: campaign.name || '',
    SUBJECT: campaign?.content?.subject || '',
    PREVIEW_TEXT: campaign?.content?.previewText || '',
    UTM_CAMPAIGN: campaign?.tracking?.utmCampaign || campaign.slug || ''
  }
}

export function personalizeText(template = '', { recipient = {}, campaign = {}, preserveUnknown = false } = {}) {
  const recipientAttributes = getRecipientAttributes(recipient)
  const campaignAttributes = getCampaignAttributes(campaign)

  return String(template || '').replace(/\{\{\s*(contact|campaign)\.([A-Z0-9_]+)\s*\}\}/g, (_, scope, key) => {
    if (scope === 'contact') {
      if (recipientAttributes[key] !== undefined && recipientAttributes[key] !== '') {
        return String(recipientAttributes[key] ?? '')
      }
      return preserveUnknown ? `{{ contact.${key} }}` : ''
    }
    if (campaignAttributes[key] !== undefined && campaignAttributes[key] !== '') {
      return String(campaignAttributes[key] ?? '')
    }
    return preserveUnknown ? `{{ campaign.${key} }}` : ''
  })
}

function renderButton({ label, url, variant = 'primary', theme, context }) {
  const finalLabel = escapeHtml(personalizeText(label, context))
  const finalUrl = escapeHtml(personalizeText(url, context))
  const styles = variant === 'secondary'
    ? `display:inline-block;padding:12px 20px;border-radius:999px;border:1px solid ${theme.accent};color:${theme.accent};text-decoration:none;font-weight:600;margin-right:10px;`
    : `display:inline-block;padding:12px 20px;border-radius:999px;background:linear-gradient(135deg, ${theme.accent}, ${theme.accentSecondary});color:#ffffff;text-decoration:none;font-weight:700;margin-right:10px;`
  return `<a href="${finalUrl}" style="${styles}">${finalLabel}</a>`
}

function renderBlock(block = {}, theme, context) {
  const title = escapeHtml(personalizeText(block.title || '', context))
  const body = sanitizeHtml(personalizeText(block.body || '', context)).replace(/\n/g, '<br>')

  if (block.type === 'hero') {
    const eyebrow = escapeHtml(personalizeText(block.eyebrow || '', context))
    const button = block.ctaLabel && block.ctaUrl
      ? renderButton({ label: block.ctaLabel, url: block.ctaUrl, variant: 'primary', theme, context })
      : ''
    const secondary = block.secondaryLabel && block.secondaryUrl
      ? renderButton({ label: block.secondaryLabel, url: block.secondaryUrl, variant: 'secondary', theme, context })
      : ''
    return `
      <section style="padding:32px;border-radius:28px;background:linear-gradient(160deg, ${theme.accent} 0%, ${theme.footer} 100%);color:#ffffff;">
        ${eyebrow ? `<div style="font-size:12px;letter-spacing:0.28em;text-transform:uppercase;color:rgba(255,255,255,0.7);">${eyebrow}</div>` : ''}
        ${title ? `<h1 style="margin:14px 0 14px;font-size:34px;line-height:1.08;font-weight:700;">${title}</h1>` : ''}
        ${body ? `<p style="margin:0 0 22px;font-size:16px;line-height:1.7;color:rgba(255,255,255,0.82);">${body}</p>` : ''}
        ${button || secondary ? `<div>${button}${secondary}</div>` : ''}
      </section>
    `
  }

  if (block.type === 'features') {
    const items = Array.isArray(block.items) ? block.items : []
    return `
      <section style="padding:26px 28px;border-radius:24px;background:${theme.surface};border:1px solid rgba(31,22,55,0.08);">
        ${title ? `<h2 style="margin:0 0 10px;font-size:24px;color:${theme.heading};">${title}</h2>` : ''}
        ${body ? `<p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:${theme.text};">${body}</p>` : ''}
        ${items.length > 0 ? `<ul style="padding:0;margin:0;list-style:none;">${items.map((item) => {
            const itemText = sanitizeHtml(personalizeText(item, context))
            return `<li style="display:flex;gap:12px;margin:0 0 12px;"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:999px;background:rgba(20,184,166,0.14);color:${theme.accentSecondary};font-size:14px;font-weight:700;">✓</span><span style="color:${theme.text};line-height:1.6;">${itemText}</span></li>`
          }).join('')}</ul>` : ''}
      </section>
    `
  }

  if (block.type === 'cta') {
    const button = block.ctaLabel && block.ctaUrl
      ? renderButton({ label: block.ctaLabel, url: block.ctaUrl, variant: 'primary', theme, context })
      : ''
    return `
      <section style="padding:28px;border-radius:24px;background:rgba(109,40,217,0.06);border:1px solid rgba(109,40,217,0.14);text-align:left;">
        ${title ? `<h2 style="margin:0 0 10px;font-size:24px;color:${theme.heading};">${title}</h2>` : ''}
        ${body ? `<p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:${theme.text};">${body}</p>` : ''}
        ${button}
      </section>
    `
  }

  if (block.type === 'footer') {
    return `<footer style="padding-top:10px;font-size:12px;line-height:1.8;color:${theme.muted};">${body}</footer>`
  }

  if (block.type === 'divider') {
    return `<div style="height:1px;background:rgba(31,22,55,0.08);"></div>`
  }

  return `
    <section style="padding:24px 28px;border-radius:24px;background:${theme.surface};border:1px solid rgba(31,22,55,0.08);">
      ${title ? `<h2 style="margin:0 0 10px;font-size:24px;color:${theme.heading};">${title}</h2>` : ''}
      ${body ? `<p style="margin:0;font-size:15px;line-height:1.7;color:${theme.text};">${body}</p>` : ''}
    </section>
  `
}

export function renderVisualEmail(designInput = {}, context = {}) {
  const design = normalizeDesign(designInput)
  const sections = design.blocks.map((block) => renderBlock(block, design.theme, context)).join('<div style="height:18px;"></div>')
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin:0;padding:0;background:${design.theme.background};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="max-width:680px;margin:0 auto;padding:28px 18px 48px;">
          <div style="padding:16px 8px 18px;text-align:center;color:${design.theme.heading};font-weight:700;font-size:26px;">
            Seemplify
          </div>
          <div style="display:grid;gap:18px;">
            ${sections}
          </div>
        </div>
      </body>
    </html>
  `
}

export function renderTextEmail({ design, htmlContent, textContent }, context = {}) {
  if (textContent) {
    return personalizeText(textContent, context)
  }

  if (htmlContent) {
    return stripHtml(personalizeText(htmlContent, context))
  }

  return stripHtml(renderVisualEmail(design, context))
}

function buildTrackedUrl(url, { campaign, recipient }) {
  const personalizedUrl = personalizeText(url, { campaign, recipient })
  if (!personalizedUrl) return personalizedUrl

  if (!isSeemplifyOwnedUrl(personalizedUrl) && !campaign?.tracking?.allowExternalLinkDecoration) {
    return personalizedUrl
  }

  return createCampaignAttributionToken({
    campaignId: campaign?._id?.toString?.(),
    batchId: recipient?.batch?.toString?.() || recipient?.batch?._id?.toString?.(),
    recipientId: recipient?._id?.toString?.(),
    email: recipient?.email,
    campaignName: campaign?.name
  }).then((token) => withCampaignTrackingParams(personalizedUrl, {
    token,
    utmSource: campaign?.tracking?.utmSource || 'seemplify',
    utmMedium: campaign?.tracking?.utmMedium || 'email',
    utmCampaign: campaign?.tracking?.utmCampaign || campaign?.slug || campaign?.name || 'seemplify-campaign'
  }))
}

async function instrumentEmailLinks(html = '', { campaign, recipient }) {
  const hrefRegex = /href=(['"])(.*?)\1/gi
  const replacements = []
  let match

  while ((match = hrefRegex.exec(html)) !== null) {
    replacements.push({
      original: match[0],
      url: match[2]
    })
  }

  let result = html
  for (const replacement of replacements) {
    const nextUrl = await buildTrackedUrl(replacement.url, { campaign, recipient })
    if (!nextUrl || nextUrl === replacement.url) continue
    result = result.replace(replacement.original, `href="${nextUrl}"`)
  }

  return result
}

export async function compileCampaignContent({ campaign, recipient }) {
  const context = { campaign, recipient }
  const designMode = campaign?.content?.designMode || 'visual'
  const subject = personalizeText(campaign?.content?.subject || '', context)
  const previewText = personalizeText(campaign?.content?.previewText || '', context)

  let html = ''
  if (designMode === 'html') {
    html = personalizeText(sanitizeHtml(campaign?.content?.htmlContent || ''), context)
  } else {
    html = renderVisualEmail(campaign?.content?.design || {}, context)
  }

  html = await instrumentEmailLinks(html, { campaign, recipient })
  const text = renderTextEmail({
    design: campaign?.content?.design,
    htmlContent: html,
    textContent: campaign?.content?.textContent
  }, context)

  return {
    subject,
    previewText,
    html,
    text
  }
}

export function compileCampaignTemplateContent(campaign) {
  const context = { campaign, recipient: {}, preserveUnknown: true }
  const designMode = campaign?.content?.designMode || 'visual'
  const subject = personalizeText(campaign?.content?.subject || '', context)
  const previewText = personalizeText(campaign?.content?.previewText || '', context)

  let html = ''
  if (designMode === 'html') {
    html = personalizeText(sanitizeHtml(campaign?.content?.htmlContent || ''), context)
  } else {
    html = renderVisualEmail(campaign?.content?.design || {}, context)
  }

  return {
    subject,
    previewText,
    html,
    text: renderTextEmail({
      design: campaign?.content?.design,
      htmlContent: html,
      textContent: campaign?.content?.textContent
    }, context)
  }
}
