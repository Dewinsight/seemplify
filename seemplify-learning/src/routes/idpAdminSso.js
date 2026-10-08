import crypto from 'node:crypto'
import express from 'express'
import mongoose from 'mongoose'
import { provisionIdpLearningAdmin } from '../services/idpLearningSyncService.js'
import { verifyLearningAdminSsoToken } from '../services/learningAdminSsoToken.js'

const launchSchema = new mongoose.Schema({
  _id: String,
  expiresAt: { type: Date, expires: 0 }
}, { versionKey: false })
const AdminLaunch = mongoose.models.LearningAdminLaunch || mongoose.model('LearningAdminLaunch', launchSchema)

async function consumeLaunch(claims) {
  // Mongo's unique primary key makes consumption atomic across all instances.
  await AdminLaunch.init()
  await AdminLaunch.create({
    _id: crypto.createHash('sha256').update(claims.jti).digest('hex'),
    expiresAt: new Date(claims.exp * 1000)
  })
}

export function createLearningAdminSsoHandler({
  verify = verifyLearningAdminSsoToken, consume = consumeLaunch, provision = provisionIdpLearningAdmin
} = {}) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store')
    res.set('Referrer-Policy', 'no-referrer')
    try {
      const claims = verify(req.query.token)
      await consume(claims)
      const account = await provision(claims)
      await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()))
      req.session.accountId = String(account.sub)
      req.session.idpIdentity = { sub: claims.sub, email: account.email, linkedAt: Date.now() }
      await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()))
      return res.redirect('/admin')
    } catch (error) {
      console.warn('Learning administrator handoff failed:', error?.code === 11000 ? 'launch already used' : 'verification or session failed')
      return res.status(403).send('Learning administrator access could not be verified. Return to Seemplify Admin and try again.')
    }
  }
}

const router = express.Router()
router.get('/auth/idp-admin', createLearningAdminSsoHandler())
export default router
