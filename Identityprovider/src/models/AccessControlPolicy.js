import mongoose from 'mongoose'

const PermissionGrantSchema = new mongoose.Schema({
  appId: { type: String, required: true, trim: true },
  permissions: { type: [String], default: [] }
}, { _id: false })

const AccessRoleSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true, maxLength: 100 },
  description: { type: String, default: '', trim: true, maxLength: 500 },
  sourceOrganizationRoles: { type: [String], default: [] },
  sourceTeamRoles: { type: [String], default: [] },
  grants: { type: [PermissionGrantSchema], default: [] },
  denies: { type: [PermissionGrantSchema], default: [] },
  locked: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AiinAccount', default: null }
}, { _id: false })

const AccessControlPolicySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'global', immutable: true },
  schemaVersion: { type: Number, required: true, default: 1 },
  revision: { type: Number, required: true, default: 1 },
  roles: { type: [AccessRoleSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AiinAccount', default: null }
})

AccessControlPolicySchema.pre('save', function(next) {
  this.updatedAt = new Date()
  next()
})

export const AccessControlPolicy = mongoose.model('AiinAccessControlPolicy', AccessControlPolicySchema)
