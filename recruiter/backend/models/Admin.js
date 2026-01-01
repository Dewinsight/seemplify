const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const AdminSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  role: {
    type: String,
    enum: ['super_admin', 'admin', 'support'],
    default: 'admin'
  },
  permissions: {
    manageUsers: { type: Boolean, default: false },
    manageOrganizations: { type: Boolean, default: false },
    manageLicenses: { type: Boolean, default: false },
    manageBilling: { type: Boolean, default: false },
    viewAnalytics: { type: Boolean, default: false },
    systemSettings: { type: Boolean, default: false }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date
  },
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date
  },
  // Password reset fields
  resetPasswordOTP: {
    type: String
  },
  resetPasswordOTPExpires: {
    type: Date
  },
  resetPasswordAttempts: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Virtual for checking if account is locked
AdminSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Pre-save middleware to hash password
AdminSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
AdminSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to handle failed login attempts
AdminSchema.methods.incLoginAttempts = function() {
  // If we have a previous lock that has expired, restart at 1
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 }
    });
  }
  
  // Otherwise we're incrementing
  const updates = { $inc: { loginAttempts: 1 } };
  
  // Lock the account after 5 attempts for 2 hours
  const maxAttempts = 5;
  const lockTime = 2 * 60 * 60 * 1000; // 2 hours
  
  if (this.loginAttempts + 1 >= maxAttempts && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + lockTime };
  }
  
  return this.updateOne(updates);
};

// Method to reset login attempts
AdminSchema.methods.resetLoginAttempts = function() {
  return this.updateOne({
    $set: { loginAttempts: 0, lastLogin: Date.now() },
    $unset: { lockUntil: 1 }
  });
};

// Super admin permissions (all permissions enabled)
AdminSchema.statics.getSuperAdminPermissions = function() {
  return {
    manageUsers: true,
    manageOrganizations: true,
    manageLicenses: true,
    manageBilling: true,
    viewAnalytics: true,
    systemSettings: true
  };
};

// Method to generate OTP for password reset
AdminSchema.methods.generateResetOTP = function() {
  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  this.resetPasswordOTP = otp;
  this.resetPasswordOTPExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  this.resetPasswordAttempts = 0;
  
  return otp;
};

// Method to verify OTP
AdminSchema.methods.verifyResetOTP = function(otp) {
  // Check if OTP has expired
  if (!this.resetPasswordOTPExpires || this.resetPasswordOTPExpires < Date.now()) {
    return { valid: false, reason: 'OTP has expired' };
  }
  
  // Check if too many attempts
  if (this.resetPasswordAttempts >= 3) {
    return { valid: false, reason: 'Too many invalid attempts' };
  }
  
  // Check if OTP matches
  if (this.resetPasswordOTP !== otp) {
    this.resetPasswordAttempts += 1;
    return { valid: false, reason: 'Invalid OTP' };
  }
  
  return { valid: true };
};

// Method to clear reset OTP
AdminSchema.methods.clearResetOTP = function() {
  this.resetPasswordOTP = undefined;
  this.resetPasswordOTPExpires = undefined;
  this.resetPasswordAttempts = 0;
};

// Update timestamps on save
AdminSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Admin', AdminSchema);
