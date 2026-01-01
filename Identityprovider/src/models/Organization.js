import mongoose from 'mongoose'

const OrganizationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxLength: 100
  },
  description: {
    type: String,
    trim: true,
    maxLength: 500
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true
  },
  members: [{
    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AiinAccount',
      required: true
    },
    role: {
      type: String,
      enum: ['owner', 'admin', 'hr_manager', 'recruiter', 'interviewer'],
      default: 'recruiter'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AiinAccount'
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    },
    updatedAt: {
      type: Date
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AiinAccount'
    }
  }],
  settings: {
    allowPublicInvites: {
      type: Boolean,
      default: false
    },
    requireApproval: {
      type: Boolean,
      default: true
    }
  },
  // For linking with SmartHR organization during migration
  smarthrOrganizationId: {
    type: String,
    sparse: true,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
})

// Indexes for better performance
OrganizationSchema.index({ name: 'text' })
OrganizationSchema.index({ owner: 1 })
OrganizationSchema.index({ 'members.account': 1 })
OrganizationSchema.index({ createdAt: -1 })

// Pre-save middleware to update timestamp
OrganizationSchema.pre('save', function(next) {
  this.updatedAt = Date.now()
  next()
})

// Virtual for member count
OrganizationSchema.virtual('memberCount').get(function() {
  return this.members ? this.members.filter(m => m.status === 'active').length : 0
})

// Get owner count (for safety checks)
OrganizationSchema.methods.getOwnerCount = function() {
  return this.members.filter(m => m.role === 'owner' && m.status === 'active').length
}

// Check if account is a member
OrganizationSchema.methods.isMember = function(accountId) {
  return this.members.some(
    m => m.account.toString() === accountId.toString() && m.status === 'active'
  )
}

// Get member role
OrganizationSchema.methods.getMemberRole = function(accountId) {
  const member = this.members.find(
    m => m.account.toString() === accountId.toString() && m.status === 'active'
  )
  return member ? member.role : null
}

// Add member to organization
OrganizationSchema.methods.addMember = async function(accountId, role = 'recruiter', invitedBy = null) {
  // Check if already a member
  const existing = this.members.find(
    m => m.account.toString() === accountId.toString()
  )

  if (existing) {
    if (existing.status === 'active') {
      throw new Error('User is already a member of this organization')
    }
    // Reactivate inactive member
    existing.status = 'active'
    existing.role = role
    existing.joinedAt = new Date()
    existing.invitedBy = invitedBy
    await this.save()

    // Update Account's organizations array
    const Account = mongoose.model('AiinAccount')
    await Account.updateOne(
      { _id: accountId },
      {
        $push: {
          organizations: {
            organization: this._id,
            role: role,
            joinedAt: new Date(),
            isActive: true
          }
        }
      }
    )

    return this
  }

  this.members.push({
    account: accountId,
    role: role,
    joinedAt: new Date(),
    invitedBy: invitedBy,
    status: 'active'
  })

  await this.save()

  // Update Account's organizations array
  const Account = mongoose.model('AiinAccount')
  await Account.updateOne(
    { _id: accountId },
    {
      $push: {
        organizations: {
          organization: this._id,
          role: role,
          joinedAt: new Date(),
          isActive: true
        }
      }
    }
  )

  return this
}

// Remove member from organization
// CRITICAL: Prevent removing last owner
OrganizationSchema.methods.removeMember = async function(accountId) {
  const member = this.members.find(
    m => m.account.toString() === accountId.toString()
  )

  if (!member) {
    throw new Error('Member not found')
  }

  // CRITICAL: Prevent removing last owner
  if (member.role === 'owner') {
    const ownerCount = this.getOwnerCount()
    if (ownerCount === 1) {
      throw new Error('Cannot remove the last owner. Transfer ownership first.')
    }
  }

  this.members = this.members.filter(
    m => m.account.toString() !== accountId.toString()
  )

  await this.save()

  // Also remove from Account's organizations array
  const Account = mongoose.model('AiinAccount')
  await Account.updateOne(
    { _id: accountId },
    { $pull: { organizations: { organization: this._id } } }
  )

  return this
}

// Update member role
// CRITICAL: Prevent demoting last owner
OrganizationSchema.methods.updateMemberRole = async function(accountId, newRole, updatedBy) {
  const member = this.members.find(
    m => m.account.toString() === accountId.toString()
  )

  if (!member) {
    throw new Error('Member not found')
  }

  // CRITICAL: Prevent demoting last owner
  if (member.role === 'owner' && newRole !== 'owner') {
    const ownerCount = this.getOwnerCount()
    if (ownerCount === 1) {
      throw new Error('Cannot demote the last owner. Transfer ownership first.')
    }
  }

  // CRITICAL: Only owner can assign owner role
  if (newRole === 'owner') {
    const updater = this.members.find(
      m => m.account.toString() === updatedBy.toString()
    )
    if (updater?.role !== 'owner') {
      throw new Error('Only current owner can assign owner role')
    }
  }

  member.role = newRole
  member.updatedAt = new Date()
  member.updatedBy = updatedBy

  await this.save()

  // Update Account's organizations array
  const Account = mongoose.model('AiinAccount')
  await Account.updateOne(
    { _id: accountId, 'organizations.organization': this._id },
    { $set: { 'organizations.$.role': newRole } }
  )

  return this
}

// Transfer ownership (explicit method)
// CRITICAL: Explicit owner transfer with validation
OrganizationSchema.methods.transferOwnership = async function(newOwnerId, transferredBy) {
  // Verify transferrer is current owner
  const transferrer = this.members.find(
    m => m.account.toString() === transferredBy.toString()
  )
  if (transferrer?.role !== 'owner') {
    throw new Error('Only current owner can transfer ownership')
  }

  // Verify new owner is a member
  const newOwner = this.members.find(
    m => m.account.toString() === newOwnerId.toString()
  )
  if (!newOwner) {
    throw new Error('New owner must be a member of the organization')
  }

  // Update old owner to admin (or keep as owner if multiple owners)
  const ownerCount = this.getOwnerCount()
  if (ownerCount === 1) {
    // Only one owner, demote to admin
    transferrer.role = 'admin'
    transferrer.updatedAt = new Date()
    transferrer.updatedBy = transferredBy
  }
  // If multiple owners, keep as owner

  // Promote new owner
  newOwner.role = 'owner'
  newOwner.updatedAt = new Date()
  newOwner.updatedBy = transferredBy
  this.owner = newOwnerId // Update organization owner field

  await this.save()

  // Update Account records
  const Account = mongoose.model('AiinAccount')
  await Account.updateOne(
    { _id: transferredBy, 'organizations.organization': this._id },
    { $set: { 'organizations.$.role': ownerCount === 1 ? 'admin' : 'owner' } }
  )
  await Account.updateOne(
    { _id: newOwnerId, 'organizations.organization': this._id },
    { $set: { 'organizations.$.role': 'owner' } }
  )

  return this
}

// Check if account has permission
OrganizationSchema.methods.hasPermission = function(accountId, permission) {
  const member = this.members.find(
    m => m.account.toString() === accountId.toString() && m.status === 'active'
  )

  if (!member) return false

  // Define permissions for each role
  const rolePermissions = {
    owner: ['*'], // All permissions
    admin: [
      'manage_users',
      'manage_organizations',
      'manage_invitations',
      'manage_members',
      'manage_roles',
      'manage_jobs',
      'manage_candidates',
      'view_analytics'
    ],
    hr_manager: [
      'manage_jobs',
      'manage_candidates',
      'view_analytics'
    ],
    recruiter: [
      'manage_candidates',
      'view_jobs',
      'view_candidates'
    ],
    interviewer: [
      'view_candidates',
      'view_jobs'
    ]
  }

  const permissions = rolePermissions[member.role] || []
  return permissions.includes('*') || permissions.includes(permission)
}

// Static method to find organizations for an account
OrganizationSchema.statics.findByAccount = function(accountId) {
  return this.find({
    'members.account': accountId,
    'members.status': 'active'
  })
}

// Ensure virtual fields are serialized
OrganizationSchema.set('toJSON', { virtuals: true })

export const Organization = mongoose.model('AiinOrganization', OrganizationSchema)
