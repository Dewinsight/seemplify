import dotenv from 'dotenv'
import express from 'express'
import cookieParser from 'cookie-parser'
import session from 'express-session'
import mongoose from 'mongoose'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import authRouter from './routes/auth.js'
import setupRouter from './routes/setup.js'
import { simpleLmsRouter, simpleLmsApiRouter } from './routes/simpleLms.js'
import { optionalAuth, requireAuth } from './middleware/auth.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()

app.set('view engine', 'ejs')
app.set('views', join(__dirname, 'views'))

app.use(express.urlencoded({ extended: true }))
app.use(express.json({ limit: '4mb' }))
app.use(cookieParser())
app.use(session({
  name: 'seemplify_learning_session',
  secret: process.env.SESSION_SECRET || 'seemplify-learning-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 14
  }
}))

app.use('/css', express.static(join(__dirname, 'public/css')))
app.use('/js', express.static(join(__dirname, 'public/js')))

app.use(optionalAuth)

app.get('/', (req, res) => {
  if (req.user) {
    return res.redirect('/simple-lms')
  }
  return res.redirect('/login')
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', app: 'seemplify-learning' })
})

app.get('/plans', requireAuth, (req, res) => {
  res.render('placeholder', {
    title: 'Plans - Seemplify Learning',
    user: req.user,
    heading: 'Plan Management',
    message: 'Plan administration remains controlled from your central admin stack. LMS access here is enabled by default unless restricted by subscription data.'
  })
})

app.get('/subscription', requireAuth, (req, res) => {
  res.render('placeholder', {
    title: 'Subscription - Seemplify Learning',
    user: req.user,
    heading: 'Subscription',
    message: 'Subscription actions for Seemplify Learning are managed from your organization admin.'
  })
})

app.use(authRouter)
app.use('/setup', setupRouter)
app.use('/simple-lms', simpleLmsRouter)
app.use('/api/simple-lms', simpleLmsApiRouter)

app.use((error, _req, res, _next) => {
  console.error('Unhandled error:', error)
  res.status(500).send('Internal server error')
})

const port = Number(process.env.PORT || 5012)
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/seemplify'

mongoose.connect(mongoUri)
  .then(() => {
    console.log(`Seemplify Learning connected to MongoDB`) // eslint-disable-line no-console
    app.listen(port, () => {
      console.log(`Seemplify Learning running on port ${port}`) // eslint-disable-line no-console
    })
  })
  .catch((error) => {
    console.error('MongoDB connection failed:', error) // eslint-disable-line no-console
    process.exit(1)
  })

export default app
