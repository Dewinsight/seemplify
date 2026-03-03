import mongoose from 'mongoose'

const organizationMembershipSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization'
  },
  role: {
    type: String,
    enum: ['owner', 'admin', 'hr_manager', 'recruiter', 'interviewer', 'staff'],
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
  organizations: {
    type: [organizationMembershipSchema],
    default: []
  },
  currentOrganization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    default: null
  },
  teams: {
    type: [teamMembershipSchema],
    default: []
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
  }
}, {
  timestamps: true,
  collection: 'aiinaccounts'
})

AccountSchema.index({ 'organizations.organization': 1 })
AccountSchema.index({ 'teams.team': 1 })
AccountSchema.index({ 'teams.organization': 1 })

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

export const Account =
  mongoose.models.AiinAccount ||
  mongoose.model('AiinAccount', AccountSchema)

export default Account
