import crypto from 'crypto'
import dotenv from 'dotenv'
import bcrypt from 'bcrypt'
import mongoose from 'mongoose'
import { Account } from '../src/models/Account.js'

dotenv.config()

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI
const email = String(process.env.STANBIC_LEARNER_EMAIL || 'stanbic.learner.review@seemplify.test')
  .trim()
  .toLowerCase()
const password = String(process.env.STANBIC_LEARNER_PASSWORD || 'StanbicLearner#2026')
const name = String(process.env.STANBIC_LEARNER_NAME || 'Stanbic Learner Review').trim()

if (!mongoUri) {
  console.error('Missing MONGODB_URI / MONGO_URI')
  process.exit(1)
}

try {
  await mongoose.connect(mongoUri)

  const passwordHash = await bcrypt.hash(password, 12)
  const account = await Account.findOneAndUpdate(
    { email },
    {
      $set: {
        email,
        passwordHash,
        emailVerified: true,
        learningRole: 'learner',
        'profile.name': name,
        'profile.preferred_username': 'stanbic.learner.review',
        'learningProfile.registrationIntent': 'learn',
        'learningProfile.intentSource': 'stanbic-review',
        'learningProfile.instructorOnboardingCompleted': false
      },
      $setOnInsert: {
        sub: `stanbic-learner-${crypto.randomUUID()}`
      }
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    }
  )

  console.log('Stanbic learner review credential is ready.')
  console.log(`Email: ${account.email}`)
  console.log(`Password: ${password}`)
  console.log('Role: learner')
} catch (error) {
  console.error('Failed to create Stanbic learner review credential:', error)
  process.exitCode = 1
} finally {
  await mongoose.disconnect().catch(() => {})
}
