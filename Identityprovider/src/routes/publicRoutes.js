import express from 'express'
import { emailService } from '../services/emailService.js'
import DemoRequest from '../models/DemoRequest.js'
import MarketingVisit from '../models/MarketingVisit.js'
import { buildAttributionTouch, resolveRequestAttribution } from '../services/campaignAttributionService.js'
import { registerCampaignConversion, resolveVisitorTouches } from '../services/marketingConversionService.js'

const router = express.Router()

const DEMO_NOTIFICATION_EMAIL = String(
  process.env.BOOK_DEMO_NOTIFICATION_EMAIL ||
  'michael.egbo@aiinnigeria.com'
).trim().toLowerCase()

function normalizeText(value = '') {
  return String(value || '').trim()
}

function isValidEmail(value = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildDemoAdminEmailHtml(request) {
  return `
    <h2>New Seemplify Demo Request</h2>
    <p>A new user has requested a demo in Identity Provider.</p>
    <p><strong>Name:</strong> ${escapeHtml(request.name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(request.email)}</p>
    <p><strong>Company:</strong> ${escapeHtml(request.company || 'N/A')}</p>
    <p><strong>Role:</strong> ${escapeHtml(request.role || 'N/A')}</p>
    <p><strong>Phone:</strong> ${escapeHtml(request.phone || 'N/A')}</p>
    <p><strong>Source:</strong> ${escapeHtml(request.source || 'identityprovider')}</p>
    <p><strong>Message:</strong></p>
    <p>${escapeHtml(request.message || 'No additional message.')}</p>
    <hr />
    <p>Open the Seemplify admin queue to manage this booking request.</p>
  `
}

function buildDemoRequesterEmailHtml(request) {
  return `
    <h2>Hi ${escapeHtml(request.name)},</h2>
    <p>Thanks for requesting a Seemplify demo.</p>
    <p>We have received your booking request and we will get back to you soon with the next steps.</p>
    <p><strong>Company:</strong> ${escapeHtml(request.company || 'N/A')}</p>
    <p><strong>Role:</strong> ${escapeHtml(request.role || 'N/A')}</p>
    <p>If you need to add anything else before we reply, just respond to this email.</p>
    <br />
    <p>Best,</p>
    <p>The Seemplify Team</p>
  `
}

router.get('/book-demo', async (req, res) => {
  try {
    res.render('book-demo', {
      submitted: false,
      formValues: {
        name: '',
        email: '',
        company: '',
        role: '',
        phone: '',
        message: ''
      }
    })
  } catch (error) {
    console.error('Error loading book demo page:', error)
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load the demo booking page'
    })
  }
})

router.post('/api/public/book-demo', async (req, res) => {
  try {
    const name = normalizeText(req.body?.name)
    const email = normalizeText(req.body?.email).toLowerCase()
    const company = normalizeText(req.body?.company)
    const role = normalizeText(req.body?.role)
    const phone = normalizeText(req.body?.phone)
    const message = normalizeText(req.body?.message)

    if (!name || !email || !company) {
      return res.status(400).json({ error: 'Name, email, and company are required' })
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Enter a valid email address' })
    }

    const resolvedAttribution = await resolveRequestAttribution(req, req.body || {})
    const attributionTouch = buildAttributionTouch({
      sourceType: resolvedAttribution.verifiedToken ? 'campaign_click' : 'website_visit',
      source: String(req.body?.source || 'marketing-site'),
      channel: 'web',
      campaignId: resolvedAttribution.verifiedToken?.campaignId || null,
      batchId: resolvedAttribution.verifiedToken?.batchId || null,
      recipientId: resolvedAttribution.verifiedToken?.recipientId || null,
      campaignName: resolvedAttribution.verifiedToken?.campaignName || '',
      signedToken: resolvedAttribution.signedToken,
      visitorId: resolvedAttribution.visitorId,
      sessionId: resolvedAttribution.sessionId,
      email,
      landingPage: String(req.body?.landingPage || ''),
      referrer: String(req.body?.referrer || req.headers.referer || ''),
      utm: resolvedAttribution.utm,
      occurredAt: new Date()
    })
    const { firstTouch, lastTouch } = await resolveVisitorTouches({
      visitorId: resolvedAttribution.visitorId,
      fallbackTouch: attributionTouch
    })
    const conversionTouch = buildAttributionTouch({
      sourceType: 'demo_request',
      source: String(req.body?.source || 'marketing-site'),
      channel: 'web',
      campaignId: lastTouch?.campaignId || resolvedAttribution.verifiedToken?.campaignId || null,
      batchId: lastTouch?.batchId || resolvedAttribution.verifiedToken?.batchId || null,
      recipientId: lastTouch?.recipientId || resolvedAttribution.verifiedToken?.recipientId || null,
      campaignName: lastTouch?.campaignName || resolvedAttribution.verifiedToken?.campaignName || '',
      signedToken: resolvedAttribution.signedToken,
      visitorId: resolvedAttribution.visitorId,
      sessionId: resolvedAttribution.sessionId,
      email,
      landingPage: String(req.body?.landingPage || ''),
      referrer: String(req.body?.referrer || req.headers.referer || ''),
      utm: resolvedAttribution.utm,
      occurredAt: new Date()
    })

    const demoRequest = await DemoRequest.create({
      name,
      email,
      company,
      role,
      phone,
      message,
      source: 'identityprovider',
      visitorId: resolvedAttribution.visitorId,
      attribution: {
        firstTouch,
        lastTouch,
        conversionSource: resolvedAttribution.verifiedToken ? 'campaign' : 'website'
      },
      metadata: {
        ipAddress: req.ip || req.connection?.remoteAddress || '',
        userAgent: String(req.headers['user-agent'] || ''),
        referrer: String(req.headers.referer || ''),
        path: req.originalUrl,
        utm: resolvedAttribution.utm,
        landingPage: String(req.body?.landingPage || ''),
        sessionId: resolvedAttribution.sessionId
      }
    })

    const trackingResults = await Promise.allSettled([
      MarketingVisit.create({
        visitorId: resolvedAttribution.visitorId,
        sessionId: resolvedAttribution.sessionId,
        eventType: 'demo_complete',
        sourceApp: req.body?.sourceApp || 'marketing-site',
        pageUrl: String(req.body?.landingPage || ''),
        path: String(req.body?.path || ''),
        referrer: String(req.body?.referrer || req.headers.referer || ''),
        ipAddress: req.ip || req.connection?.remoteAddress || '',
        userAgent: String(req.headers['user-agent'] || ''),
        utm: resolvedAttribution.utm,
        attribution: conversionTouch,
        demoRequest: demoRequest._id,
        metadata: {
          company,
          role
        }
      }),
      registerCampaignConversion({
        conversionType: 'demo_request',
        campaignId: resolvedAttribution.verifiedToken?.campaignId || lastTouch?.campaignId || null,
        recipientId: resolvedAttribution.verifiedToken?.recipientId || lastTouch?.recipientId || null,
        email,
        visitorId: resolvedAttribution.visitorId,
        occurredAt: conversionTouch.occurredAt,
        demoRequestId: demoRequest._id
      })
    ])
    trackingResults.forEach((result) => {
      if (result.status === 'rejected') {
        console.error('Demo tracking error:', result.reason)
      }
    })

    const adminEmail = emailService.sendEmail({
      to: DEMO_NOTIFICATION_EMAIL,
      subject: `New demo request from ${company}`,
      html: buildDemoAdminEmailHtml(demoRequest)
    }).then(() => {
      demoRequest.adminNotificationSent = true
      demoRequest.adminNotificationSentAt = new Date()
      return demoRequest.save()
    }).catch((error) => {
      console.error('Failed to send demo admin notification:', error)
    })

    const requesterEmail = emailService.sendEmail({
      to: email,
      subject: 'We received your Seemplify demo request',
      html: buildDemoRequesterEmailHtml(demoRequest)
    }).then(() => {
      demoRequest.requesterConfirmationSent = true
      demoRequest.requesterConfirmationSentAt = new Date()
      return demoRequest.save()
    }).catch((error) => {
      console.error('Failed to send demo requester confirmation:', error)
    })

    await Promise.allSettled([adminEmail, requesterEmail])

    return res.status(200).json({
      success: true,
      message: 'Your demo request has been received. We will get back to you soon.',
      visitorId: resolvedAttribution.visitorId,
      sessionId: resolvedAttribution.sessionId
    })
  } catch (error) {
    console.error('Error creating demo request:', error)
    return res.status(500).json({ error: 'Failed to submit demo request' })
  }
})

export default router
