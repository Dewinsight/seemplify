import mongoose from 'mongoose'
import dotenv from 'dotenv'
import Plan from '../models/Plan.js'

dotenv.config()

/**
 * Seed Default Subscription Plans
 *
 * Run with: node src/seeds/seedPlans.js
 */

const defaultPlans = [
  {
    name: 'Starter',
    slug: 'starter',
    description: 'Perfect for small teams getting started with digital HR management.',
    pricing: {
      monthly: 500000, // 5,000 NGN in kobo
      yearly: 5000000, // 50,000 NGN in kobo (2 months free)
      yearlyDiscount: 17,
      currency: 'NGN'
    },
    limits: {
      maxMembers: 10,
      maxTeams: 3,
      maxStorage: 5 // 5 GB
    },
    features: {
      recruiter: true,
      leaveManagement: false,
      payrollManagement: false,
      performanceManagement: false,
      outlineDocs: false,
      aiChat: false,
      lms: false
    },
    isActive: true,
    isPublic: true,
    isFeatured: false,
    displayOrder: 1,
    color: '#3b82f6'
  },
  {
    name: 'Professional',
    slug: 'professional',
    description: 'Ideal for growing teams that need comprehensive HR tools.',
    pricing: {
      monthly: 1500000, // 15,000 NGN in kobo
      yearly: 15000000, // 150,000 NGN in kobo (2 months free)
      yearlyDiscount: 17,
      currency: 'NGN'
    },
    limits: {
      maxMembers: 50,
      maxTeams: 10,
      maxStorage: 25 // 25 GB
    },
    features: {
      recruiter: true,
      leaveManagement: true,
      payrollManagement: true,
      performanceManagement: true,
      outlineDocs: false,
      aiChat: false,
      lms: false
    },
    isActive: true,
    isPublic: true,
    isFeatured: true,
    displayOrder: 2,
    badgeText: 'Most Popular',
    color: '#8b5cf6'
  },
  {
    name: 'Enterprise',
    slug: 'enterprise',
    description: 'Full-featured solution for large organizations with advanced needs.',
    pricing: {
      monthly: 5000000, // 50,000 NGN in kobo
      yearly: 50000000, // 500,000 NGN in kobo (2 months free)
      yearlyDiscount: 17,
      currency: 'NGN'
    },
    limits: {
      maxMembers: null, // Unlimited
      maxTeams: null, // Unlimited
      maxStorage: 100 // 100 GB
    },
    features: {
      recruiter: true,
      leaveManagement: true,
      payrollManagement: true,
      performanceManagement: true,
      outlineDocs: true,
      aiChat: true,
      lms: true
    },
    isActive: true,
    isPublic: true,
    isFeatured: false,
    displayOrder: 3,
    badgeText: 'Best Value',
    color: '#ec4899'
  },
  {
    name: 'Trial',
    slug: 'trial',
    description: 'Free 14-day trial with full Professional features.',
    pricing: {
      monthly: 0,
      yearly: 0,
      yearlyDiscount: 0,
      currency: 'NGN'
    },
    limits: {
      maxMembers: 20,
      maxTeams: 5,
      maxStorage: 10 // 10 GB
    },
    features: {
      recruiter: true,
      leaveManagement: true,
      payrollManagement: true,
      performanceManagement: true,
      outlineDocs: false,
      aiChat: false,
      lms: false
    },
    isActive: true,
    isPublic: false, // Not visible to regular users, only for admin assignment
    isFeatured: false,
    isTrial: true,
    trialDays: 14,
    displayOrder: 0,
    color: '#22c55e'
  }
]

async function seedPlans() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/identity-provider'
    console.log('Connecting to MongoDB...')
    await mongoose.connect(mongoUri)
    console.log('Connected to MongoDB')

    console.log('Checking existing plans...')
    const existingPlans = await Plan.find()

    if (existingPlans.length > 0) {
      console.log(`Found ${existingPlans.length} existing plans:`)
      existingPlans.forEach(p => console.log(`  - ${p.name} (${p.slug})`))

      const readline = await import('readline')
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      })

      const answer = await new Promise(resolve => {
        rl.question('Do you want to reset and reseed all plans? (yes/no): ', resolve)
      })
      rl.close()

      if (answer.toLowerCase() !== 'yes') {
        console.log('Aborting. Existing plans preserved.')
        process.exit(0)
      }

      console.log('Deleting existing plans...')
      await Plan.deleteMany({})
    }

    console.log('Creating default plans...')

    for (const planData of defaultPlans) {
      const plan = new Plan(planData)
      await plan.save()
      console.log(`  ✅ Created: ${plan.name} (${plan.slug})`)
    }

    console.log(`\n✅ Successfully seeded ${defaultPlans.length} plans!`)

    // Display summary
    const plans = await Plan.find().sort({ displayOrder: 1 })
    console.log('\nPlan Summary:')
    console.log('─'.repeat(80))
    plans.forEach(p => {
      const features = Object.entries(p.features.toObject())
        .filter(([, enabled]) => enabled)
        .map(([key]) => key)
        .join(', ')

      console.log(`${p.name}:`)
      console.log(`  Price: ${p.formattedMonthlyPrice}/mo | ${p.formattedYearlyPrice}/yr`)
      console.log(`  Limits: ${p.limits.maxMembers || '∞'} members, ${p.limits.maxTeams || '∞'} teams`)
      console.log(`  Features: ${features || 'None'}`)
      console.log(`  Status: ${p.isActive ? 'Active' : 'Inactive'} | ${p.isPublic ? 'Public' : 'Private'}`)
      console.log('')
    })

  } catch (error) {
    console.error('Error seeding plans:', error)
    process.exit(1)
  } finally {
    await mongoose.connection.close()
    console.log('Database connection closed.')
    process.exit(0)
  }
}

seedPlans()
