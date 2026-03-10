import mongoose from 'mongoose'
import {
  LEARNING_ROLES,
  ORGANIZATION_MEMBER_ROLES,
  REGISTRATION_INTENTS,
  resolveLearningRole as resolveLearningRoleFromAccount
} from '../utils/learningRoles.js'

const organizationMembershipSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization'
  },
  role: {
    type: String,
    enum: ORGANIZATION_MEMBER_ROLES,
    default: 'staff'
  },
  appAccess: {
    mode: {
      type: String,
      enum: ['all', 'selected'],
      default: 'all'
    },
    appIds: {
      type: [String],
      default: []
    }
  },
  joinedAt: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { _id: false })

const teamMembershipSchema = new mongoose.Schema({
  team: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinTeam'
  },
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization'
  },
  role: {
    type: String,
    enum: ['member', 'line_manager', 'team_lead'],
    default: 'member'
  },
  joinedAt: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { _id: false })

const AccountSchema = new mongoose.Schema({
  sub: { type: String, unique: true, index: true, required: true },
  email: { type: String, unique: true, lowercase: true, trim: true, required: true },
  passwordHash: { type: String, required: true },
  emailVerified: { type: Boolean, default: true },
  profile: {
    name: { type: String, trim: true },
    preferred_username: { type: String, trim: true }
  },
  learningRole: {
    type: String,
    enum: LEARNING_ROLES,
    default: 'learner',
    index: true
  },
  learningProfile: {
    registrationIntent: {
      type: String,
      enum: REGISTRATION_INTENTS,
      default: 'learn'
    },
    intentSource: {
      type: String,
      trim: true,
      maxlength: 120,
      default: 'direct'
    },
    instructorActivatedAt: Date,
    instructorOnboardingCompleted: {
      type: Boolean,
      default: false
    },
    firstCourseCreatedAt: Date,
    firstCourse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AiinSimpleLmsCourse',
      default: null
    }
  },
  payoutProfile: {
    accountName: {
      type: String,
      trim: true,
      maxlength: 200,
      default: ''
    },
    accountNumber: {
      type: String,
      trim: true,
      maxlength: 64,
      default: ''
    },
    bankName: {
      type: String,
      trim: true,
      maxlength: 200,
      default: ''
    },
    bankCode: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ''
    },
    swiftCode: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ''
    },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 3,
      default: 'NGN'
    },
    paymentEmail: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 320,
      default: ''
    },
    country: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ''
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1200,
      default: ''
    },
    updatedAt: Date
  },
  creatorSettings: {
    defaultCategory: {
      type: String,
      trim: true,
      maxlength: 120,
      default: ''
    },
    defaultLevel: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced', 'mixed'],
      default: 'mixed'
    },
    defaultVisibility: {
      type: String,
      enum: ['private', 'public'],
      default: 'private'
    },
    defaultPaymentMode: {
      type: String,
      enum: ['free', 'paid'],
      default: 'free'
    },
    defaultCurrency: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 3,
      default: 'NGN'
    },
    preferredLessonDurationMinutes: {
      type: Number,
      min: 1,
      max: 600,
      default: 12
    },
    autoLoadSampleCurriculum: {
      type: Boolean,
      default: false
    },
    autoGenerateCourseSlug: {
      type: Boolean,
      default: true
    },
    defaultLessonMediaType: {
      type: String,
      enum: ['video', 'audio', 'document'],
      default: 'video'
    },
    autoSaveDraftMinutes: {
      type: Number,
      min: 1,
      max: 30,
      default: 5
    },
    publishNotifyByEmail: {
      type: Boolean,
      default: true
    },
    showSalesDashboard: {
      type: Boolean,
      default: true
    },
    showCreatorTips: {
      type: Boolean,
      default: true
    },
    updatedAt: Date
  },
  organizations: {
    type: [organizationMembershipSchema],
    default: []
  },
  currentOrganization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    default: null
  },
  partnerOrganization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    default: null,
    index: true
  },
  teams: {
    type: [teamMembershipSchema],
    default: []
  },
  roleMetadata: {
    previousLearningRole: {
      type: String,
      enum: LEARNING_ROLES,
      default: 'learner'
    },
    lastUpdatedAt: Date,
    lastUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AiinAccount',
      default: null
    }
  },
  isSystemAdmin: {
    type: Boolean,
    default: false
  },
  isSuperAdmin: {
    type: Boolean,
    default: false
  },
  notificationViews: {
    simpleLmsByOrganization: {
      type: Map,
      of: Date,
      default: {}
    }
  },
  passwordReset: {
    tokenHash: {
      type: String,
      default: ''
    },
    expiresAt: Date,
    requestedAt: Date
  }
}, {
  timestamps: true,
  collection: 'aiinaccounts'
})

AccountSchema.index({ 'organizations.organization': 1 })
AccountSchema.index({ 'teams.team': 1 })
AccountSchema.index({ 'teams.organization': 1 })
AccountSchema.index({ partnerOrganization: 1 })

AccountSchema.methods.setCurrentOrganization = async function (organizationId) {
  const isMember = this.organizations.some((membership) => (
    String(membership.organization) === String(organizationId) &&
    membership.isActive
  ))

  if (!isMember) {
    throw new Error('Not a member of this organization')
  }

  this.currentOrganization = organizationId
  await this.save()
  return this
}

AccountSchema.statics.findSystemAdmins = function () {
  return this.find({ $or: [{ isSystemAdmin: true }, { isSuperAdmin: true }] })
}

AccountSchema.statics.findSuperAdmins = function () {
  return this.find({ isSuperAdmin: true })
}

AccountSchema.methods.getLearningRole = function () {
  return resolveLearningRoleFromAccount(this)
}

export const Account =
  mongoose.models.AiinAccount ||
  mongoose.model('AiinAccount', AccountSchema)

export default Account
