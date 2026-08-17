import express from 'express'

import {
  listRelayEvents,
  publishRelayEvent,
  removeRelaySubscription,
  upsertRelaySubscription,
  verifyRelayRequest
} from '../services/browserNotificationRelayService.js'

const safeError = (res, error) => res.status(Number(error?.status) || 500).json({
  error: Number(error?.status) ? error.message : 'Browser notification delivery failed.'
})

export const createInternalBrowserNotificationRouter = () => {
  const router = express.Router()
  router.use(async (req, res, next) => {
    try {
      await verifyRelayRequest(req)
      next()
    } catch (error) {
      safeError(res, error)
    }
  })
  router.post('/v1/browser/subscriptions', async (req, res) => {
    try {
      const result = await upsertRelaySubscription(req.body)
      res.status(201).json({ ok: true, ...result })
    } catch (error) { safeError(res, error) }
  })
  router.delete('/v1/browser/subscriptions/:deviceId', async (req, res) => {
    try {
      await removeRelaySubscription(req.body?.identity, req.params.deviceId)
      res.status(204).send()
    } catch (error) { safeError(res, error) }
  })
  router.post('/v1/events', async (req, res) => {
    try {
      const result = await publishRelayEvent(req.body)
      res.status(result.duplicate ? 200 : 202).json({ ok: true, ...result })
    } catch (error) { safeError(res, error) }
  })
  return router
}

export const createBrowserNotificationClientRouter = ({ resolveAccount }) => {
  const router = express.Router()
  router.use(async (req, res, next) => {
    try {
      const account = await resolveAccount(req)
      if (!account?.sub) return res.status(401).json({ error: 'Authentication required.' })
      req.browserNotificationAccount = account
      next()
    } catch {
      res.status(401).json({ error: 'Authentication required.' })
    }
  })
  router.get('/configuration', (req, res) => res.json({
    enabled: true,
    workspaceOrigin: process.env.WORKSPACE_PUBLIC_URL || 'https://workspace.seemplifyai.com',
    pollIntervalMs: 5000
  }))
  router.get('/events', async (req, res) => {
    const events = await listRelayEvents(req.browserNotificationAccount.sub, req.query.after, req.query.limit)
    res.json({ events, serverTime: new Date().toISOString() })
  })
  return router
}
