import { createCampaignAttributionToken, isSeemplifyOwnedUrl, withCampaignTrackingParams } from './campaignAttributionService.js'

const DEFAULT_THEME = Object.freeze({
  background: '#0f0e13',
  surface: '#fffdfa',
  surfaceSoft: '#f5f2ec',
  accent: '#7047eb',
  accentSecondary: '#a982ff',
  heading: '#191816',
  text: '#4f4b45',
  muted: '#716b63',
  footer: '#18161f'
})

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
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function safeColor(value, fallback) {
  const candidate = String(value || '').trim()
  return /^(#[0-9a-f]{3,8}|rgba?\([0-9.,\s%]+\)|[a-z]{3,20})$/i.test(candidate) ? candidate : fallback
}

function safeImageUrl(value = '') {
  const candidate = String(value || '').trim()
  return /^https:\/\/[a-z0-9.-]+(?:\/[^\s"'<>]*)?$/i.test(candidate) ? candidate : ''
}

function safeLinkUrl(value = '') {
  const candidate = String(value || '').trim()
  return /^(https:\/\/|mailto:)[^\s"'<>]+$/i.test(candidate) ? candidate : ''
}

export function sanitizeHtml(rawHtml = '') {
  let html = String(rawHtml || '')
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '')
  html = html.replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
  html = html.replace(/<object[\s\S]*?<\/object>/gi, '')
  html = html.replace(/<embed[^>]*>/gi, '')
  html = html.replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
  html = html.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
  html = html.replace(/javascript:/gi, '')
  return html
}

export function normalizeDesign(input = {}) {
  const theme = input?.theme || {}
  const blocks = Array.isArray(input?.blocks) ? input.blocks : []
  return {
    version: Number(input?.version || 2),
    motion: input?.motion === 'none' ? 'none' : 'subtle',
    theme: {
      background: safeColor(theme.background, DEFAULT_THEME.background),
      surface: safeColor(theme.surface, DEFAULT_THEME.surface),
      surfaceSoft: safeColor(theme.surfaceSoft, DEFAULT_THEME.surfaceSoft),
      accent: safeColor(theme.accent, DEFAULT_THEME.accent),
      accentSecondary: safeColor(theme.accentSecondary, DEFAULT_THEME.accentSecondary),
      heading: safeColor(theme.heading, DEFAULT_THEME.heading),
      text: safeColor(theme.text, DEFAULT_THEME.text),
      muted: safeColor(theme.muted, DEFAULT_THEME.muted),
      footer: safeColor(theme.footer, DEFAULT_THEME.footer)
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
    CUSTOM_OPENING: recipient.personalization?.customOpening || 'Bring the work around your people into one connected place, with clearer handoffs and less repeated admin.',
    CUSTOM_BENEFITS: recipient.personalization?.customBenefits || 'Start with the workflows your team needs today, then keep the same identity, context, and controls as you grow.',
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
      if (recipientAttributes[key] !== undefined && recipientAttributes[key] !== '') return String(recipientAttributes[key] ?? '')
      return preserveUnknown ? `{{ contact.${key} }}` : ''
    }
    if (campaignAttributes[key] !== undefined && campaignAttributes[key] !== '') return String(campaignAttributes[key] ?? '')
    return preserveUnknown ? `{{ campaign.${key} }}` : ''
  })
}

function renderButton({ label, url, variant = 'primary', theme, context }) {
  const finalLabel = escapeHtml(personalizeText(label, context))
  const finalUrl = escapeHtml(safeLinkUrl(personalizeText(url, context)))
  if (!finalLabel || !finalUrl) return ''
  const background = variant === 'hero' ? '#f7f5fa' : theme.footer
  const color = variant === 'hero' ? '#0f0e13' : '#ffffff'
  const border = variant === 'secondary' ? '1px solid #5d5765' : `1px solid ${background}`
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="display:inline-table;margin:0 10px 10px 0;vertical-align:top;">
      <tr>
        <td bgcolor="${background}" style="border:${border};border-radius:8px;text-align:center;">
          <a href="${finalUrl}" style="display:inline-block;padding:13px 20px;color:${color};font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;line-height:18px;text-decoration:none;">${finalLabel}</a>
        </td>
      </tr>
    </table>
  `
}

function renderHeading(title, theme, level = 2) {
  if (!title) return ''
  const fontSize = level === 1 ? '36px' : '24px'
  const lineHeight = level === 1 ? '42px' : '31px'
  return `<h${level} style="margin:0 0 12px;color:${theme.heading};font-family:Arial,Helvetica,sans-serif;font-size:${fontSize};font-weight:700;letter-spacing:-0.02em;line-height:${lineHeight};">${title}</h${level}>`
}

function renderBody(body, theme, extra = '') {
  if (!body) return ''
  return `<div style="margin:0;color:${theme.text};font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:26px;${extra}">${body}</div>`
}

function renderBlock(block = {}, theme, context) {
  const title = escapeHtml(personalizeText(block.title || '', context))
  const body = sanitizeHtml(personalizeText(block.body || '', context)).replace(/\n/g, '<br>')

  if (block.type === 'hero') {
    const eyebrow = escapeHtml(personalizeText(block.eyebrow || '', context))
    const imageUrl = safeImageUrl(personalizeText(block.imageUrl || '', context))
    const imageAlt = escapeHtml(personalizeText(block.imageAlt || 'Seemplify', context))
    const primary = block.ctaLabel && block.ctaUrl
      ? renderButton({ label: block.ctaLabel, url: block.ctaUrl, variant: 'hero', theme, context })
      : ''
    const secondary = block.secondaryLabel && block.secondaryUrl
      ? renderButton({ label: block.secondaryLabel, url: block.secondaryUrl, variant: 'secondary', theme, context })
      : ''
    return `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;border-spacing:0;background:${theme.footer};border-radius:12px;overflow:hidden;">
        ${imageUrl ? `<tr><td style="padding:0;"><img src="${imageUrl}" width="640" alt="${imageAlt}" style="display:block;width:100%;max-width:640px;height:auto;border:0;" /></td></tr>` : ''}
        <tr>
          <td class="seemplify-sheen" style="padding:36px 38px;background:${theme.footer};">
            ${eyebrow ? `<div style="margin:0 0 12px;color:${theme.accentSecondary};font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.12em;line-height:18px;text-transform:uppercase;">${eyebrow}</div>` : ''}
            ${title ? `<h1 style="margin:0 0 14px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:36px;font-weight:700;letter-spacing:-0.025em;line-height:42px;">${title}</h1>` : ''}
            ${body ? `<div style="margin:0 0 22px;color:#d8d3df;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:26px;">${body}</div>` : ''}
            ${primary || secondary ? `<div style="font-size:0;">${primary}${secondary}</div>` : ''}
          </td>
        </tr>
      </table>
    `
  }

  if (block.type === 'image') {
    const imageUrl = safeImageUrl(personalizeText(block.imageUrl || '', context))
    if (!imageUrl) return ''
    const imageAlt = escapeHtml(personalizeText(block.imageAlt || '', context))
    const caption = escapeHtml(personalizeText(block.caption || '', context))
    return `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr><td><img src="${imageUrl}" width="640" alt="${imageAlt}" style="display:block;width:100%;max-width:640px;height:auto;border:0;border-radius:10px;" /></td></tr>
        ${caption ? `<tr><td style="padding:10px 4px 0;color:${theme.muted};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;">${caption}</td></tr>` : ''}
      </table>
    `
  }

  if (block.type === 'features') {
    const items = Array.isArray(block.items) ? block.items : []
    const rows = items.map((item) => {
      const itemText = sanitizeHtml(personalizeText(item, context))
      return `
        <tr>
          <td width="28" valign="top" style="padding:4px 0 12px;">
            <div style="width:20px;height:20px;border-radius:6px;background:${theme.surfaceSoft};color:${theme.accent};font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;line-height:20px;text-align:center;">✓</div>
          </td>
          <td valign="top" style="padding:2px 0 12px;color:${theme.text};font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;">${itemText}</td>
        </tr>
      `
    }).join('')
    return `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${theme.surface};border:1px solid #e1ddd5;border-radius:10px;">
        <tr><td style="padding:30px 32px;">${renderHeading(title, theme)}${renderBody(body, theme, 'margin-bottom:18px;')}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${rows}</table></td></tr>
      </table>
    `
  }

  if (block.type === 'quote') {
    const attribution = escapeHtml(personalizeText(block.attribution || '', context))
    return `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${theme.footer};border-radius:10px;">
        <tr><td style="padding:30px 32px;border-left:4px solid ${theme.accentSecondary};">
          <div style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:21px;font-weight:600;line-height:31px;">“${body}”</div>
          ${attribution ? `<div style="margin-top:14px;color:#bdb6c8;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;">${attribution}</div>` : ''}
        </td></tr>
      </table>
    `
  }

  if (block.type === 'cta') {
    const button = block.ctaLabel && block.ctaUrl
      ? renderButton({ label: block.ctaLabel, url: block.ctaUrl, variant: 'primary', theme, context })
      : ''
    return `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${theme.surfaceSoft};border:1px solid #ddd7eb;border-radius:10px;">
        <tr><td style="padding:30px 32px;">${renderHeading(title, theme)}${renderBody(body, theme, 'margin-bottom:20px;')}${button}</td></tr>
      </table>
    `
  }

  if (block.type === 'footer') {
    return `<div style="padding:6px 10px 0;color:${theme.muted};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;text-align:center;">${body}</div>`
  }

  if (block.type === 'divider') {
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-top:1px solid #ddd8cf;font-size:1px;line-height:1px;">&nbsp;</td></tr></table>`
  }

  if (block.type === 'spacer') {
    const height = Math.min(Math.max(Number(block.height || 24), 8), 80)
    return `<div style="height:${height}px;font-size:1px;line-height:${height}px;">&nbsp;</div>`
  }

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${theme.surface};border:1px solid #e1ddd5;border-radius:10px;">
      <tr><td style="padding:28px 32px;">${renderHeading(title, theme)}${renderBody(body, theme)}</td></tr>
    </table>
  `
}

export function renderVisualEmail(designInput = {}, context = {}) {
  const design = normalizeDesign(designInput)
  const rows = design.blocks.map((block) => {
    const rendered = renderBlock(block, design.theme, context)
    return rendered ? `<tr><td style="padding:0 0 18px;">${rendered}</td></tr>` : ''
  }).join('')
  const previewText = escapeHtml(personalizeText(context?.campaign?.content?.previewText || '', context))
  const motionStyle = design.motion === 'subtle'
    ? `@media screen and (prefers-reduced-motion: no-preference) { .seemplify-sheen { background-image: linear-gradient(110deg, ${design.theme.footer} 0%, ${design.theme.footer} 38%, #2f2840 50%, ${design.theme.footer} 62%, ${design.theme.footer} 100%) !important; background-size: 240% 100% !important; animation: seem-shine 8s ease-in-out infinite !important; } } @keyframes seem-shine { 0%, 68%, 100% { background-position: 100% 0; } 82% { background-position: 0 0; } }`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="x-apple-disable-message-reformatting">
    <title>${escapeHtml(context?.campaign?.content?.subject || 'Seemplify')}</title>
    <style>
      body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
      table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
      img { -ms-interpolation-mode:bicubic; }
      ${motionStyle}
      @media screen and (max-width:680px) {
        .seemplify-shell { width:100% !important; }
        .seemplify-pad { padding-left:18px !important; padding-right:18px !important; }
        h1 { font-size:30px !important; line-height:36px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:${design.theme.background};">
    ${previewText ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${previewText}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>` : ''}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${design.theme.background}" style="background:${design.theme.background};">
      <tr>
        <td align="center" class="seemplify-pad" style="padding:26px 18px 44px;">
          <table role="presentation" width="640" class="seemplify-shell" cellspacing="0" cellpadding="0" border="0" style="width:640px;max-width:640px;">
            <tr>
              <td style="padding:0 4px 18px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td align="left">
                      <img src="https://auth.seemplifyai.com/images/seemplifylogo.png" width="142" alt="Seemplify" style="display:block;width:142px;max-width:142px;height:auto;border:0;" />
                    </td>
                    <td align="right" style="color:#bbb5c2;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;">
                      People operations, connected.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            ${rows}
            <tr>
              <td style="padding:10px 8px 0;color:#a59eac;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:18px;text-align:center;">
                Seemplify · Run simple, run smart
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

export function renderTextEmail({ design, htmlContent, textContent }, context = {}) {
  if (textContent) return personalizeText(textContent, context)
  if (htmlContent) return stripHtml(personalizeText(htmlContent, context))
  return stripHtml(renderVisualEmail(design, context))
}

function buildTrackedUrl(url, { campaign, recipient }) {
  const personalizedUrl = personalizeText(url, { campaign, recipient })
  if (!personalizedUrl) return personalizedUrl
  if (!isSeemplifyOwnedUrl(personalizedUrl) && !campaign?.tracking?.allowExternalLinkDecoration) return personalizedUrl

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
  while ((match = hrefRegex.exec(html)) !== null) replacements.push({ original: match[0], url: match[2] })

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
  let html = designMode === 'html'
    ? personalizeText(sanitizeHtml(campaign?.content?.htmlContent || ''), context)
    : renderVisualEmail(campaign?.content?.design || {}, context)
  html = await instrumentEmailLinks(html, { campaign, recipient })
  const text = renderTextEmail({
    design: campaign?.content?.design,
    htmlContent: html,
    textContent: campaign?.content?.textContent
  }, context)
  return { subject, previewText, html, text }
}

export function compileCampaignTemplateContent(campaign) {
  const context = { campaign, recipient: {}, preserveUnknown: true }
  const designMode = campaign?.content?.designMode || 'visual'
  const subject = personalizeText(campaign?.content?.subject || '', context)
  const previewText = personalizeText(campaign?.content?.previewText || '', context)
  const html = designMode === 'html'
    ? personalizeText(sanitizeHtml(campaign?.content?.htmlContent || ''), context)
    : renderVisualEmail(campaign?.content?.design || {}, context)
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
