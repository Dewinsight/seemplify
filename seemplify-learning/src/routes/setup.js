import express from 'express'
import { requireAuth } from '../middleware/auth.js'

const router = express.Router()

router.get('/', requireAuth, async (_req, res) => {
  return res.redirect('/simple-lms?info=Workspace+setup+is+no+longer+required.')
})

router.post('*', requireAuth, async (_req, res) => {
  return res.redirect('/simple-lms?error=Organization+setup+has+been+removed+from+Seemplify+Learning.')
})

export default router
