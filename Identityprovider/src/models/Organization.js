import mongoose from 'mongoose'
import { normalizeAppAccess } from '../utils/appAccess.js'
import {
  buildSeedDepartments,
  buildDepartmentLookup,
  getGeneralDepartment,
  normalizeDepartmentName
} from '../utils/departments.js'

function normalizeEmployeeId(value = '') {
  return String(value || '').trim()
}

function getEmployeeIdKey(value = '') {
  return normalizeEmployeeId(value).toLowerCase()
}

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
      enum: ['owner', 'admin', 'hr_manager', 'recruiter', 'interviewer', 'staff'],
      default: 'recruiter'
    },
    designation: {
      type: String,
      trim: true,
      maxLength: 120
    },
    employeeId: {
      type: String,
      trim: true,
      maxLength: 80
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
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
    onboardingStatusOverride: {
      type: String,
      enum: ['not_started', 'pending', 'in_progress', 'completed', 'cancelled'],
      default: undefined
    },
    onboardingStatusUpdatedAt: Date,
    onboardingStatusUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AiinAccount'
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
    },
    simpleLms: {
      defaultCurrency: {
        type: String,
        trim: true,
        uppercase: true,
        default: 'NGN'
      },
      allowedCurrencies: {
        type: [String],
        default: ['NGN']
      }
    }
  },
  departments: [{
    name: {
      type: String,
      required: true,
      trim: true,
      maxLength: 120
    },
    description: {
      type: String,
      trim: true,
      maxLength: 500
    },
    parentDepartment: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
    },
    headAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AiinAccount',
      default: null
    },
    isSystem: {
      type: Boolean,
      default: false
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  }],
  branches: [{
    name: {
      type: String,
      required: true,
      trim: true,
      maxLength: 120
    },
    code: {
      type: String,
      trim: true,
      uppercase: true,
      maxLength: 24
    },
    address: {
      type: String,
      trim: true,
      maxLength: 240
    },
    city: {
      type: String,
      trim: true,
      maxLength: 100
    },
    state: {
      type: String,
      trim: true,
      maxLength: 100
    },
    country: {
      type: String,
      trim: true,
      maxLength: 100
    },
    countryCode: {
      type: String,
      trim: true,
      uppercase: true,
      maxLength: 2
    },
    stateCode: {
      type: String,
      trim: true,
      uppercase: true,
      maxLength: 10
    },
    managerAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AiinAccount',
      default: null
    },
    isHeadOffice: {
      type: Boolean,
      default: false
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  }],
  // For linking with SmartHR organization during migration
  smarthrOrganizationId: {
    type: String,
    sparse: true,
    index: true
  },
  // Active subscription reference
  activeSubscription: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinSubscription'
  },
  // Subscription status cache (updated by subscription lifecycle)
  subscriptionStatus: {
    type: String,
    enum: ['none', 'active', 'expired', 'suspended', 'grace_period'],
    default: 'none'
  },
  // Quick access to current plan (cached for performance)
  currentPlan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinPlan'
  },
  // Subscription expiry date (cached for quick checks)
  subscriptionExpiresAt: {
    type: Date
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
OrganizationSchema.index({ activeSubscription: 1 })
OrganizationSchema.index({ subscriptionStatus: 1 })
OrganizationSchema.index({ subscriptionExpiresAt: 1 })

// Pre-save middleware to update timestamp
OrganizationSchema.pre('save', function(next) {
  if (!Array.isArray(this.departments) || this.departments.length === 0) {
    this.departments = buildSeedDepartments()
  }

  const departmentLookup = buildDepartmentLookup(this.departments)
  const branchLookup = new Set((this.branches || []).map((branch) => branch._id.toString()))

  if (Array.isArray(this.members)) {
    this.members.forEach((member) => {
      if (member.department && !departmentLookup.has(member.department.toString())) {
        member.department = null
      }
      if (member.branch && !branchLookup.has(member.branch.toString())) {
        member.branch = null
      }
    })
  }

  if (Array.isArray(this.departments)) {
    this.departments.forEach((department) => {
      department.updatedAt = Date.now()
    })
  }

  if (Array.isArray(this.branches)) {
    this.branches.forEach((branch) => {
      branch.updatedAt = Date.now()
    })
  }

  if (this.settings?.simpleLms) {
    const defaultCurrency = String(this.settings.simpleLms.defaultCurrency || 'NGN')
      .trim()
      .toUpperCase()
      .slice(0, 3) || 'NGN'

    const normalizedAllowedCurrencies = Array.isArray(this.settings.simpleLms.allowedCurrencies)
      ? this.settings.simpleLms.allowedCurrencies
        .map(currency => String(currency || '').trim().toUpperCase().slice(0, 3))
        .filter(Boolean)
      : []

    if (!normalizedAllowedCurrencies.includes(defaultCurrency)) {
      normalizedAllowedCurrencies.unshift(defaultCurrency)
    }

    this.settings.simpleLms.defaultCurrency = defaultCurrency
    this.settings.simpleLms.allowedCurrencies = Array.from(new Set(normalizedAllowedCurrencies))
  }

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

OrganizationSchema.methods.getGeneralDepartment = function() {
  return getGeneralDepartment(this.departments || [])
}

OrganizationSchema.methods.getDepartmentById = function(departmentId) {
  const targetId = departmentId?.toString()
  return (this.departments || []).find((department) => department._id.toString() === targetId) || null
}

OrganizationSchema.methods.isDepartmentHead = function(accountId, departmentId = null) {
  return (this.departments || []).some((department) => {
    if (!department.headAccount) return false
    if (department.headAccount.toString() !== accountId.toString()) return false
    if (!departmentId) return true
    return department._id.toString() === departmentId.toString()
  })
}

OrganizationSchema.methods.addDepartment = async function(data = {}, createdBy = null) {
  const name = normalizeDepartmentName(data.name)
  if (!name) {
    throw new Error('Department name is required')
  }

  const exists = (this.departments || []).some(
    (department) => normalizeDepartmentName(department.name).toLowerCase() === name.toLowerCase()
  )
  if (exists) {
    throw new Error('Department with this name already exists')
  }

  const parentDepartment = data.parentDepartment || this.getGeneralDepartment()?._id || null
  if (parentDepartment && !this.getDepartmentById(parentDepartment)) {
    throw new Error('Parent department not found')
  }

  this.departments.push({
    name,
    description: String(data.description || '').trim(),
    parentDepartment,
    headAccount: data.headAccount || null,
    isSystem: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy
  })

  await this.save()
  return this.departments[this.departments.length - 1]
}

OrganizationSchema.methods.updateDepartment = async function(departmentId, updates = {}) {
  const department = this.getDepartmentById(departmentId)
  if (!department) {
    throw new Error('Department not found')
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
    const nextName = normalizeDepartmentName(updates.name)
    if (!nextName) {
      throw new Error('Department name is required')
    }
    const duplicate = (this.departments || []).some((candidate) =>
      candidate._id.toString() !== department._id.toString() &&
      normalizeDepartmentName(candidate.name).toLowerCase() === nextName.toLowerCase()
    )
    if (duplicate) {
      throw new Error('Department with this name already exists')
    }
    department.name = nextName
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'description')) {
    department.description = String(updates.description || '').trim()
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'headAccount')) {
    department.headAccount = updates.headAccount || null
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'parentDepartment')) {
    const parentDepartment = updates.parentDepartment || null
    if (parentDepartment && parentDepartment.toString() === department._id.toString()) {
      throw new Error('Department cannot be its own parent')
    }
    if (parentDepartment && !this.getDepartmentById(parentDepartment)) {
      throw new Error('Parent department not found')
    }
    department.parentDepartment = parentDepartment
  }

  department.updatedAt = new Date()
  await this.save()
  return department
}

OrganizationSchema.methods.getBranchById = function(branchId) {
  const targetId = branchId?.toString()
  return (this.branches || []).find((branch) => branch._id.toString() === targetId) || null
}

OrganizationSchema.methods.addBranch = async function(data = {}) {
  const name = String(data.name || '').trim()
  if (!name) {
    throw new Error('Branch name is required')
  }

  const duplicateName = (this.branches || []).some(
    (branch) => branch.name.toLowerCase() === name.toLowerCase()
  )
  if (duplicateName) {
    throw new Error('Branch with this name already exists')
  }

  const code = String(data.code || '').trim().toUpperCase()
  const duplicateCode = code && (this.branches || []).some(
    (branch) => String(branch.code || '').toUpperCase() === code
  )
  if (duplicateCode) {
    throw new Error('Branch code is already in use')
  }

  if (data.managerAccount) {
    const managerIsMember = (this.members || []).some((member) =>
      member.status === 'active' && member.account?.toString() === data.managerAccount.toString()
    )
    if (!managerIsMember) {
      throw new Error('Branch manager must be an active organization member')
    }
  }

  if (data.isHeadOffice) {
    (this.branches || []).forEach((branch) => { branch.isHeadOffice = false })
  }

  this.branches.push({
    name,
    code: code || undefined,
    address: String(data.address || '').trim(),
    city: String(data.city || '').trim(),
    state: String(data.state || '').trim(),
    country: String(data.country || '').trim(),
    countryCode: String(data.countryCode || '').trim().toUpperCase(),
    stateCode: String(data.stateCode || '').trim().toUpperCase(),
    managerAccount: data.managerAccount || null,
    isHeadOffice: !!data.isHeadOffice,
    createdAt: new Date(),
    updatedAt: new Date()
  })

  await this.save()
  return this.branches[this.branches.length - 1]
}

OrganizationSchema.methods.updateBranch = async function(branchId, updates = {}) {
  const branch = this.getBranchById(branchId)
  if (!branch) {
    throw new Error('Branch not found')
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
    const name = String(updates.name || '').trim()
    if (!name) throw new Error('Branch name is required')
    const duplicate = (this.branches || []).some((candidate) =>
      candidate._id.toString() !== branch._id.toString() && candidate.name.toLowerCase() === name.toLowerCase()
    )
    if (duplicate) throw new Error('Branch with this name already exists')
    branch.name = name
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'code')) {
    const code = String(updates.code || '').trim().toUpperCase()
    const duplicate = code && (this.branches || []).some((candidate) =>
      candidate._id.toString() !== branch._id.toString() && String(candidate.code || '').toUpperCase() === code
    )
    if (duplicate) throw new Error('Branch code is already in use')
    branch.code = code || undefined
  }

  for (const field of ['address', 'city', 'state', 'country']) {
    if (Object.prototype.hasOwnProperty.call(updates, field)) {
      branch[field] = String(updates[field] || '').trim()
    }
  }

  for (const field of ['countryCode', 'stateCode']) {
    if (Object.prototype.hasOwnProperty.call(updates, field)) {
      branch[field] = String(updates[field] || '').trim().toUpperCase()
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'managerAccount')) {
    const managerAccount = updates.managerAccount || null
    if (managerAccount) {
      const managerIsMember = (this.members || []).some((member) =>
        member.status === 'active' && member.account?.toString() === managerAccount.toString()
      )
      if (!managerIsMember) throw new Error('Branch manager must be an active organization member')
    }
    branch.managerAccount = managerAccount
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'isHeadOffice')) {
    if (updates.isHeadOffice) {
      (this.branches || []).forEach((candidate) => { candidate.isHeadOffice = false })
    }
    branch.isHeadOffice = !!updates.isHeadOffice
  }

  branch.updatedAt = new Date()
  await this.save()
  return branch
}

OrganizationSchema.methods.removeBranch = async function(branchId) {
  const branch = this.getBranchById(branchId)
  if (!branch) throw new Error('Branch not found')

  const assignedCount = (this.members || []).filter(
    (member) => member.status === 'active' && member.branch?.toString() === branch._id.toString()
  ).length
  if (assignedCount > 0) {
    throw new Error(`Move ${assignedCount} assigned member${assignedCount === 1 ? '' : 's'} before deleting this branch`)
  }

  this.branches.pull(branch._id)
  await this.save()
  return branch
}

OrganizationSchema.methods.getDerivedMemberDepartmentId = async function(accountId, options = {}) {
  const session = options.session || null
  const Team = mongoose.model('AiinTeam')
  let teamQuery = Team.find({
    organization: this._id,
    'members.account': accountId,
    'members.status': 'active'
  }).select('department')
  if (session) teamQuery = teamQuery.session(session)
  const teams = await teamQuery.lean()

  const departmentIds = Array.from(new Set(
    teams
      .map((team) => team.department?.toString())
      .filter(Boolean)
  ))

  return departmentIds[0] || null
}

OrganizationSchema.methods.syncMemberDepartmentFromTeams = async function(accountId, options = {}) {
  const session = options.session || null
  const member = this.members.find(
    m => m.account.toString() === accountId.toString()
  )

  if (!member) {
    return null
  }

  const departmentId = await this.getDerivedMemberDepartmentId(accountId, options)
  member.department = departmentId

  const Account = mongoose.model('AiinAccount')
  await Account.updateOne(
    { _id: accountId, 'organizations.organization': this._id },
    { $set: { 'organizations.$.department': departmentId } },
    session ? { session } : undefined
  )

  await this.save(session ? { session } : undefined)
  return departmentId
}

OrganizationSchema.methods.syncMemberDepartmentsFromTeams = async function(accountIds = []) {
  for (const accountId of accountIds) {
    await this.syncMemberDepartmentFromTeams(accountId)
  }
}

// Add member to organization
OrganizationSchema.methods.addMember = async function(accountId, role = 'recruiter', invitedBy = null, appAccess = null, options = {}) {
  const normalizedAppAccess = normalizeAppAccess(appAccess)
  const requestedDepartmentId = options.departmentId || null
  const departmentId = requestedDepartmentId && this.departments.id(requestedDepartmentId)
    ? requestedDepartmentId
    : null
  const designation = String(options.designation || '').trim() || undefined
  const employeeId = normalizeEmployeeId(options.employeeId) || undefined

  this.assertActiveEmployeeIdAvailable(employeeId, accountId)

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
    existing.appAccess = normalizedAppAccess
    existing.designation = designation
    existing.employeeId = employeeId
    existing.department = departmentId
    existing.joinedAt = new Date()
    existing.invitedBy = invitedBy
    await this.save()

    // Update Account's organizations array
    const Account = mongoose.model('AiinAccount')
    const accountMembershipUpdate = await Account.updateOne(
      { _id: accountId, 'organizations.organization': this._id },
      {
        $set: {
          'organizations.$.role': role,
          'organizations.$.department': departmentId,
          'organizations.$.appAccess': normalizedAppAccess,
          'organizations.$.joinedAt': new Date(),
          'organizations.$.isActive': true
        }
      }
    )
    if (!accountMembershipUpdate.matchedCount) await Account.updateOne(
      { _id: accountId },
      {
        $push: {
          organizations: {
            organization: this._id,
            role: role,
            department: departmentId,
            appAccess: normalizedAppAccess,
            joinedAt: new Date(),
            isActive: true
          }
        }
      }
    )
    await Account.updateOne(
      {
        _id: accountId,
        $or: [
          { currentOrganization: { $exists: false } },
          { currentOrganization: null }
        ]
      },
      {
        $set: {
          currentOrganization: this._id,
          updatedAt: new Date()
        }
      }
    )

    return this
  }

  this.members.push({
    account: accountId,
    role: role,
    designation,
    employeeId,
    department: departmentId,
    appAccess: normalizedAppAccess,
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
          department: departmentId,
          appAccess: normalizedAppAccess,
          joinedAt: new Date(),
          isActive: true
        }
      }
    }
  )
  await Account.updateOne(
    {
      _id: accountId,
      $or: [
        { currentOrganization: { $exists: false } },
        { currentOrganization: null }
      ]
    },
    {
      $set: {
        currentOrganization: this._id,
        updatedAt: new Date()
      }
    }
  )

  return this
}

// Remove member from organization
// CRITICAL: Prevent removing last owner
OrganizationSchema.methods.removeMember = async function(accountId, options = {}) {
  const session = options.session || null
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

  member.status = 'inactive'
  member.updatedAt = new Date()

  await this.save(session ? { session } : undefined)

  // Preserve the membership history on the account while revoking access.
  const Account = mongoose.model('AiinAccount')
  await Account.updateOne(
    { _id: accountId, 'organizations.organization': this._id },
    {
      $set: {
        'organizations.$.isActive': false
      }
    },
    session ? { session } : undefined
  )
  await Account.updateOne(
    { _id: accountId, currentOrganization: this._id },
    { $set: { currentOrganization: null } },
    session ? { session } : undefined
  )

  return this
}

// Update member role
// CRITICAL: Prevent demoting last owner
OrganizationSchema.methods.updateMemberRole = async function(accountId, newRole, updatedBy, options = {}) {
  const session = options.session || null
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

  await this.save(session ? { session } : undefined)

  // Update Account's organizations array
  const Account = mongoose.model('AiinAccount')
  await Account.updateOne(
    { _id: accountId, 'organizations.organization': this._id },
    { $set: { 'organizations.$.role': newRole } },
    session ? { session } : undefined
  )

  return this
}

OrganizationSchema.methods.updateMemberDetails = async function(accountId, updates = {}, updatedBy, options = {}) {
  const session = options.session || null
  const member = this.members.find(
    m => m.account.toString() === accountId.toString()
  )

  if (!member) {
    throw new Error('Member not found')
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'designation')) {
    member.designation = String(updates.designation || '').trim() || undefined
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'employeeId')) {
    const employeeId = normalizeEmployeeId(updates.employeeId) || undefined
    this.assertActiveEmployeeIdAvailable(employeeId, accountId)
    member.employeeId = employeeId
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'department')) {
    throw new Error('Department is derived from active team assignments')
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'branch')) {
    const branchId = updates.branch || null
    if (branchId && !this.getBranchById(branchId)) {
      throw new Error('Branch not found')
    }
    member.branch = branchId

    const Account = mongoose.model('AiinAccount')
    await Account.updateOne(
      { _id: accountId, 'organizations.organization': this._id },
      { $set: { 'organizations.$.branch': branchId } },
      session ? { session } : undefined
    )
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'appAccess')) {
    const normalizedAppAccess = normalizeAppAccess(updates.appAccess)
    member.appAccess = normalizedAppAccess

    const Account = mongoose.model('AiinAccount')
    await Account.updateOne(
      { _id: accountId, 'organizations.organization': this._id },
      { $set: { 'organizations.$.appAccess': normalizedAppAccess } },
      session ? { session } : undefined
    )
  }

  member.updatedAt = new Date()
  member.updatedBy = updatedBy

  await this.save(session ? { session } : undefined)

  return member
}

OrganizationSchema.methods.findActiveMemberByEmployeeId = function(employeeId, excludeAccountId = null) {
  const employeeIdKey = getEmployeeIdKey(employeeId)
  if (!employeeIdKey) return null

  return (this.members || []).find((member) => {
    if (member.status !== 'active') return false
    if (excludeAccountId && member.account?.toString() === excludeAccountId.toString()) {
      return false
    }

    return getEmployeeIdKey(member.employeeId) === employeeIdKey
  }) || null
}

OrganizationSchema.methods.assertActiveEmployeeIdAvailable = function(employeeId, excludeAccountId = null) {
  const normalizedEmployeeId = normalizeEmployeeId(employeeId)
  if (!normalizedEmployeeId) return

  const conflictingMember = this.findActiveMemberByEmployeeId(normalizedEmployeeId, excludeAccountId)
  if (conflictingMember) {
    throw new Error('Employee ID is already assigned to another active member')
  }
}

OrganizationSchema.methods.setMemberOnboardingStatusOverride = async function(accountId, status, updatedBy) {
  const member = this.members.find(
    m => m.account.toString() === accountId.toString()
  )

  if (!member) {
    throw new Error('Member not found')
  }

  const allowedStatuses = ['not_started', 'pending', 'in_progress', 'completed', 'cancelled']
  const normalizedStatus = status == null ? null : String(status || '').trim().toLowerCase()

  if (normalizedStatus && !allowedStatuses.includes(normalizedStatus)) {
    throw new Error(`Invalid onboarding status. Must be one of: ${allowedStatuses.join(', ')}`)
  }

  member.onboardingStatusOverride = normalizedStatus || undefined
  member.onboardingStatusUpdatedAt = new Date()
  member.onboardingStatusUpdatedBy = updatedBy || undefined
  member.updatedAt = new Date()
  member.updatedBy = updatedBy || undefined

  await this.save()

  return member
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
    ],
    staff: [] // Staff role has no permissions by default
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

// Check if organization has active subscription
OrganizationSchema.methods.hasActiveSubscription = function() {
  return this.subscriptionStatus === 'active' || this.subscriptionStatus === 'grace_period'
}

// Check if organization can access a specific app
OrganizationSchema.methods.canAccessApp = async function(appKey) {
  if (!this.activeSubscription) return false

  await this.populate('activeSubscription')
  if (!this.activeSubscription) return false

  return this.activeSubscription.canAccessApp(appKey)
}

// Update subscription cache (called when subscription changes)
OrganizationSchema.methods.updateSubscriptionCache = async function(subscription) {
  if (!subscription) {
    this.activeSubscription = null
    this.subscriptionStatus = 'none'
    this.currentPlan = null
    this.subscriptionExpiresAt = null
  } else {
    this.activeSubscription = subscription._id
    this.currentPlan = subscription.plan
    this.subscriptionExpiresAt = subscription.endDate

    // Determine status
    if (subscription.status === 'suspended') {
      this.subscriptionStatus = 'suspended'
    } else if (subscription.status === 'active') {
      this.subscriptionStatus = 'active'
    } else if (subscription.isInGracePeriod) {
      this.subscriptionStatus = 'grace_period'
    } else {
      this.subscriptionStatus = 'expired'
    }
  }

  return this.save()
}

// Get subscription details with plan
OrganizationSchema.methods.getSubscriptionDetails = async function() {
  if (!this.activeSubscription) return null

  await this.populate({
    path: 'activeSubscription',
    populate: { path: 'plan' }
  })

  return this.activeSubscription
}

// Static: Find organizations with expiring subscriptions
OrganizationSchema.statics.findWithExpiringSubscriptions = function(days = 7) {
  const futureDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  return this.find({
    subscriptionStatus: 'active',
    subscriptionExpiresAt: { $lte: futureDate, $gte: new Date() }
  }).populate(['activeSubscription', 'currentPlan', 'owner'])
}

// Static: Find organizations without subscription
OrganizationSchema.statics.findWithoutSubscription = function() {
  return this.find({
    $or: [
      { subscriptionStatus: 'none' },
      { subscriptionStatus: { $exists: false } },
      { activeSubscription: { $exists: false } }
    ]
  })
}

// Ensure virtual fields are serialized
OrganizationSchema.set('toJSON', { virtuals: true })

export const Organization = mongoose.model('AiinOrganization', OrganizationSchema)
