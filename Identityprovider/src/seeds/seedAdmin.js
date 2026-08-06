import mongoose from 'mongoose'
import dotenv from 'dotenv'
import bcrypt from 'bcryptjs'
import { Account } from '../models/Account.js'

dotenv.config()

/**
 * Seed Initial Super Admin
 *
 * Run with: node src/seeds/seedAdmin.js
 */

const ADMIN_EMAIL = 'michael.egbo@aiinnigeria.com'
const ADMIN_PASSWORD = 'Digital_1'
const ADMIN_NAME = 'Michael Egbo'

async function seedAdmin() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/identity-provider'
    console.log('Connecting to MongoDB...')
    await mongoose.connect(mongoUri)
    console.log('Connected to MongoDB')

    // Check if user exists
    let account = await Account.findOne({ email: ADMIN_EMAIL.toLowerCase() })

    if (account) {
      console.log(`User ${ADMIN_EMAIL} already exists. Updating to super admin...`)

      // Update existing user to be super admin
      account.isSystemAdmin = true
      account.isSuperAdmin = true

      // Update password
      account.passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12)
      account.lastPasswordChange = new Date()

      await account.save()
      console.log(`✅ Updated ${ADMIN_EMAIL} to Super Admin with new password`)
    } else {
      console.log(`Creating new super admin account for ${ADMIN_EMAIL}...`)

      // Create new account
      const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12)
      const sub = `local|${Date.now()}`

      account = new Account({
        sub,
        email: ADMIN_EMAIL.toLowerCase(),
        passwordHash,
        emailVerified: true,
        profile: {
          name: ADMIN_NAME,
          preferred_username: ADMIN_EMAIL.split('@')[0]
        },
        isSystemAdmin: true,
        isSuperAdmin: true,
        authProvider: 'local'
      })

      await account.save()
      console.log(`✅ Created new Super Admin: ${ADMIN_EMAIL}`)
    }

    console.log('\n===================================')
    console.log('Admin Account Details:')
    console.log('===================================')
    console.log(`Email: ${ADMIN_EMAIL}`)
    console.log(`Password: ${ADMIN_PASSWORD}`)
    console.log(`Role: Super Admin`)
    console.log(`Admin Panel: /admin`)
    console.log('===================================\n')

  } catch (error) {
    console.error('Error seeding admin:', error)
    process.exit(1)
  } finally {
    await mongoose.connection.close()
    console.log('Database connection closed.')
    process.exit(0)
  }
}

seedAdmin()
