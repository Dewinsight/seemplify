import mongoose from 'mongoose'
import dotenv from 'dotenv'
import bcrypt from 'bcryptjs'
import { Account } from '../models/Account.js'

dotenv.config()

/**
 * Simple Admin Seeding Script
 * More robust error handling and multiple connection attempts
 */

const ADMIN_EMAIL = 'michael.egbo@aiinnigeria.com'
const ADMIN_PASSWORD = 'Digital_1'
const ADMIN_NAME = 'Michael Egbo'

async function seedAdmin() {
  let mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/identity-provider'

  console.log('='.repeat(60))
  console.log('ADMIN SEEDING SCRIPT')
  console.log('='.repeat(60))
  console.log(`MongoDB URI: ${mongoUri}`)
  console.log(`Admin Email: ${ADMIN_EMAIL}`)
  console.log('='.repeat(60))

  try {
    console.log('\n⏳ Connecting to MongoDB...')
    await mongoose.connect(mongoUri)
    console.log('✅ Connected to MongoDB')

    console.log('\n🔍 Looking for admin account...')

    let account = await Account.findOne({ email: ADMIN_EMAIL.toLowerCase() })

    if (account) {
      console.log(`✓ Found existing account: ${ADMIN_EMAIL}`)
      console.log('   Current status:')
      console.log(`   - System Admin: ${account.isSystemAdmin}`)
      console.log(`   - Super Admin: ${account.isSuperAdmin}`)
      console.log(`   - Email Verified: ${account.emailVerified}`)
      console.log(`   - Auth Provider: ${account.authProvider}`)
      
      console.log('\n🔄 Updating admin permissions...')
      account.isSystemAdmin = true
      account.isSuperAdmin = true
      account.passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12)
      account.lastPasswordChange = new Date()
      account.emailVerified = true
      
      await account.save()
      console.log('✅ Account updated successfully!')
      
    } else {
      console.log(`⚠️  Account not found: ${ADMIN_EMAIL}`)
      console.log('🔧 Creating new admin account...')
      
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
      console.log('✅ New admin account created!')
    }

    console.log('\n' + '='.repeat(60))
    console.log('ADMIN CREDENTIALS')
    console.log('='.repeat(60))
    console.log(`📧 Email:    ${ADMIN_EMAIL}`)
    console.log(`🔑 Password:  ${ADMIN_PASSWORD}`)
    console.log(`👤 Name:      ${ADMIN_NAME}`)
    console.log(`⭐ Role:      Super Admin`)
    console.log(`🔗 Admin URL: http://localhost:4000/admin`)
    console.log('='.repeat(60))
    console.log('\n✨ Ready to use! Visit http://localhost:4000/admin/login')
    console.log('='.repeat(60) + '\n')

  } catch (error) {
    console.error('\n❌ ERROR SEEDING ADMIN:')
    console.error(error)
    
    console.log('\n💡 Troubleshooting Tips:')
    console.log('1. Check your .env file has correct MONGO_URI')
    console.log('2. Ensure MongoDB is running')
    console.log('3. Verify MongoDB connection string format')
    console.log('4. Check MongoDB user has proper permissions')
    
    process.exit(1)
  } finally {
    try {
      await mongoose.connection.close()
      console.log('✓ Database connection closed')
    } catch (err) {
      console.error('Error closing connection:', err)
    }
    process.exit(0)
  }
}

seedAdmin()
