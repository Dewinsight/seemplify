import mongoose from 'mongoose'

const TeamSchema = new mongoose.Schema({
  // Organization reference
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    required: true,
    index: true
  },

  // Team hierarchy (teams can be under teams)
  parentTeam: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinTeam',
    default: null, // null = root team (directly under organization)
    index: true
  },

  // Team details
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

  // Manager assignment (line manager of this team)
  // CRITICAL: Manager must have line_manager role in the team
  manager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    default: null // Can be null if no manager assigned
  },

  // Team members (people assigned to this team)
  members: [{
    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AiinAccount',
      required: true
    },
    // CRITICAL: Line manager role is separate from organization role
    // Must be explicitly assigned when adding member to team
    role: {
      type: String,
      enum: ['member', 'line_manager', 'team_lead'],
      default: 'member'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    }
  }],

  // Metadata
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
})

// Indexes for efficient queries
TeamSchema.index({ organization: 1, parentTeam: 1 })
TeamSchema.index({ manager: 1 })
TeamSchema.index({ 'members.account': 1 })
TeamSchema.index({ name: 'text' })
TeamSchema.index({ createdAt: -1 })

// PERFORMANCE OPTIMIZATION: Compound indexes for common query patterns
// Used by getTeamClaims and getTeamPermissions
TeamSchema.index({ 'members.account': 1, 'members.status': 1 })
TeamSchema.index({ organization: 1, 'members.account': 1 })

// Pre-save middleware to update timestamp
TeamSchema.pre('save', function(next) {
  this.updatedAt = Date.now()
  next()
})

// Virtual for member count
TeamSchema.virtual('memberCount').get(function() {
  return this.members ? this.members.filter(m => m.status === 'active').length : 0
})

// Add member to team
TeamSchema.methods.addMember = async function(accountId, role = 'member') {
  // Check if already a member
  const existing = this.members.find(
    m => m.account.toString() === accountId.toString()
  )
  if (existing) {
    existing.role = role
    existing.status = 'active'
    await this.save()

    // Update Account's teams array
    await this.updateAccountTeamMembership(accountId, role)

    return this
  }

  this.members.push({
    account: accountId,
    role,
    joinedAt: new Date(),
    status: 'active'
  })
  await this.save()

  // Update Account's teams array
  await this.updateAccountTeamMembership(accountId, role)

  return this
}

// Helper to update Account's teams array
TeamSchema.methods.updateAccountTeamMembership = async function(accountId, role) {
  const Account = mongoose.model('AiinAccount')
  const existingMembership = await Account.findOne({
    _id: accountId,
    'teams.team': this._id
  })

  if (existingMembership) {
    await Account.updateOne(
      { _id: accountId, 'teams.team': this._id },
      {
        $set: {
          'teams.$.role': role,
          'teams.$.isActive': true
        }
      }
    )
  } else {
    await Account.updateOne(
      { _id: accountId },
      {
        $push: {
          teams: {
            team: this._id,
            organization: this.organization,
            role: role,
            joinedAt: new Date(),
            isActive: true
          }
        }
      }
    )
  }
}

// Remove member from team
TeamSchema.methods.removeMember = async function(accountId) {
  this.members = this.members.filter(
    m => m.account.toString() !== accountId.toString()
  )

  // If manager is being removed, clear manager
  if (this.manager && this.manager.toString() === accountId.toString()) {
    this.manager = null
  }

  await this.save()

  // Remove from Account's teams array
  const Account = mongoose.model('AiinAccount')
  await Account.updateOne(
    { _id: accountId },
    { $pull: { teams: { team: this._id } } }
  )

  return this
}

// Update team member role
TeamSchema.methods.updateMemberRole = async function(accountId, newRole) {
  const member = this.members.find(
    m => m.account.toString() === accountId.toString()
  )
  if (!member) {
    throw new Error('Member not found in team')
  }

  const oldRole = member.role
  member.role = newRole
  await this.save()

  // If member was manager and role changed from line_manager, clear manager
  if (this.manager &&
      this.manager.toString() === accountId.toString() &&
      oldRole === 'line_manager' &&
      newRole !== 'line_manager') {
    this.manager = null
    await this.save()
  }

  // Update Account's teams array
  const Account = mongoose.model('AiinAccount')
  await Account.updateOne(
    { _id: accountId, 'teams.team': this._id },
    { $set: { 'teams.$.role': newRole } }
  )

  return this
}

// Set team manager
// CRITICAL: Manager must have line_manager role in the team
TeamSchema.methods.setManager = async function(accountId) {
  if (accountId === null) {
    this.manager = null
    await this.save()
    return this
  }

  // CRITICAL: Verify account has line_manager role in team
  const teamMember = this.members.find(
    m => m.account.toString() === accountId.toString() && m.status === 'active'
  )

  if (!teamMember) {
    throw new Error('Account must be a member of the team')
  }

  if (teamMember.role !== 'line_manager') {
    throw new Error('Manager must have line_manager role in the team. Assign line_manager role first.')
  }

  // Verify account is member of organization
  const Organization = mongoose.model('AiinOrganization')
  const org = await Organization.findById(this.organization)
  if (!org) {
    throw new Error('Organization not found')
  }

  const orgMember = org.members.find(
    m => m.account.toString() === accountId.toString() && m.status === 'active'
  )
  if (!orgMember) {
    throw new Error('Manager must be a member of the organization')
  }

  this.manager = accountId
  await this.save()
  return this
}

// Check if account is member of this team
TeamSchema.methods.isMember = function(accountId) {
  return this.members.some(
    m => m.account.toString() === accountId.toString() && m.status === 'active'
  )
}

// Get member role in this team
TeamSchema.methods.getMemberRole = function(accountId) {
  const member = this.members.find(
    m => m.account.toString() === accountId.toString() && m.status === 'active'
  )
  return member ? member.role : null
}

// Get all direct reports (members of this team and sub-teams)
// Recursive method
TeamSchema.methods.getDirectReports = async function() {
  const directMembers = this.members
    .filter(m => m.status === 'active')
    .map(m => m.account)

  // Get members from sub-teams
  const Team = mongoose.model('AiinTeam')
  const subTeams = await Team.find({ parentTeam: this._id })
  const subTeamMembers = []

  for (const subTeam of subTeams) {
    const reports = await subTeam.getDirectReports()
    subTeamMembers.push(...reports)
  }

  // Return unique accounts (deduplicate)
  const allMembers = [...directMembers, ...subTeamMembers]
  const uniqueIds = [...new Set(allMembers.map(id => id.toString()))]
  return uniqueIds.map(id => mongoose.Types.ObjectId.createFromHexString(id))
}

// Get team hierarchy path (for display)
// Returns array like ["Engineering", "Backend", "API Team"]
TeamSchema.methods.getHierarchyPath = async function() {
  const path = [this.name]
  let current = this

  const Team = mongoose.model('AiinTeam')
  while (current.parentTeam) {
    current = await Team.findById(current.parentTeam)
    if (current) {
      path.unshift(current.name)
    } else {
      break
    }
  }

  return path
}

// Check if account is in team hierarchy (this team or any sub-team)
TeamSchema.methods.isInHierarchy = async function(accountId) {
  // Check direct membership
  const isDirectMember = this.members.some(
    m => m.account.toString() === accountId.toString() && m.status === 'active'
  )

  if (isDirectMember) {
    return true
  }

  // Check sub-teams recursively
  const Team = mongoose.model('AiinTeam')
  const subTeams = await Team.find({ parentTeam: this._id })
  for (const subTeam of subTeams) {
    if (await subTeam.isInHierarchy(accountId)) {
      return true
    }
  }

  return false
}

// Get all sub-teams (immediate children)
TeamSchema.methods.getSubTeams = function() {
  const Team = mongoose.model('AiinTeam')
  return Team.find({ parentTeam: this._id })
}

// Get all descendant teams (all levels)
TeamSchema.methods.getAllDescendantTeams = async function() {
  const Team = mongoose.model('AiinTeam')
  const descendants = []
  const subTeams = await Team.find({ parentTeam: this._id })

  for (const subTeam of subTeams) {
    descendants.push(subTeam)
    const subDescendants = await subTeam.getAllDescendantTeams()
    descendants.push(...subDescendants)
  }

  return descendants
}

// Static method to find teams for an organization
TeamSchema.statics.findByOrganization = function(organizationId, includeTree = false) {
  return this.find({ organization: organizationId })
    .populate('manager', 'email profile.name')
    .populate('members.account', 'email profile.name')
    .populate('parentTeam', 'name')
}

// Static method to find root teams (no parent) for an organization
TeamSchema.statics.findRootTeams = function(organizationId) {
  return this.find({
    organization: organizationId,
    parentTeam: null
  })
    .populate('manager', 'email profile.name')
    .populate('members.account', 'email profile.name')
}

// Static method to find teams by account
TeamSchema.statics.findByAccount = function(accountId) {
  return this.find({
    'members.account': accountId,
    'members.status': 'active'
  })
    .populate('organization', 'name')
    .populate('manager', 'email profile.name')
    .populate('parentTeam', 'name')
}

// Static method to find teams where account is manager
TeamSchema.statics.findManagedTeams = function(accountId) {
  return this.find({
    manager: accountId
  })
    .populate('organization', 'name')
    .populate('members.account', 'email profile.name')
    .populate('parentTeam', 'name')
}

// Build team tree for an organization (for UI display)
TeamSchema.statics.buildTeamTree = async function(organizationId) {
  const teams = await this.find({ organization: organizationId })
    .populate('manager', 'email profile.name')
    .populate('members.account', 'email profile.name')
    .lean()

  // Build tree structure
  const teamMap = new Map()
  const rootTeams = []

  // First pass: index all teams
  teams.forEach(team => {
    teamMap.set(team._id.toString(), { ...team, children: [] })
  })

  // Second pass: build tree
  teams.forEach(team => {
    const teamWithChildren = teamMap.get(team._id.toString())
    if (team.parentTeam) {
      const parent = teamMap.get(team.parentTeam.toString())
      if (parent) {
        parent.children.push(teamWithChildren)
      } else {
        // Parent not found, treat as root
        rootTeams.push(teamWithChildren)
      }
    } else {
      rootTeams.push(teamWithChildren)
    }
  })

  return rootTeams
}

// Ensure virtual fields are serialized
TeamSchema.set('toJSON', { virtuals: true })

export const Team = mongoose.model('AiinTeam', TeamSchema)
