import mongoose from 'mongoose'

const AppLaunchActivitySchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    index: true
  },
  account: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    index: true
  },
  appId: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  appName: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  source: {
    type: String,
    default: 'hub',
    trim: true
  },
  details: {
    type: mongoose.Schema.Types.Mixed
  },
  ipAddress: {
    type: String,
    trim: true
  },
  userAgent: {
    type: String,
    trim: true
  }
}, {
  timestamps: true,
  collection: 'aiin_app_launch_activity'
})

AppLaunchActivitySchema.index({ organization: 1, createdAt: -1 })
AppLaunchActivitySchema.index({ organization: 1, appId: 1, createdAt: -1 })
AppLaunchActivitySchema.index({ account: 1, createdAt: -1 })
AppLaunchActivitySchema.index({ status: 1, createdAt: -1 })

const AppLaunchActivity = mongoose.model('AiinAppLaunchActivity', AppLaunchActivitySchema)

export default AppLaunchActivity
