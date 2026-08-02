const mongoose = require('mongoose');

const FeedbackOTPSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  otp: {
    type: String,
    required: true
  },
  interviewId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Interview',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  attempts: {
    type: Number,
    default: 0,
    max: 3
  },
  verified: {
    type: Boolean,
    default: false
  },
  verifiedAt: Date,
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
  }
}, {
  timestamps: true
});

// Index for expiration
FeedbackOTPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index for lookups
FeedbackOTPSchema.index({ email: 1, interviewId: 1 });

// Method to verify OTP
FeedbackOTPSchema.methods.verifyOTP = function(otp) {
  // Check if already verified
  if (this.verified) {
    return { valid: false, reason: 'OTP already used' };
  }
  
  // Check if expired
  if (this.expiresAt < new Date()) {
    return { valid: false, reason: 'OTP has expired' };
  }
  
  // Check if too many attempts
  if (this.attempts >= 3) {
    return { valid: false, reason: 'Too many invalid attempts' };
  }
  
  // Check if OTP matches - ensure string comparison
  const storedOTP = String(this.otp);
  const providedOTP = String(otp);
  
  console.log('🔐 [OTP-MODEL] OTP Comparison Debug:', {
    storedOTP,
    providedOTP,
    match: storedOTP === providedOTP,
    storedLength: storedOTP.length,
    providedLength: providedOTP.length
  });
  
  if (storedOTP !== providedOTP) {
    this.attempts += 1;
    return { valid: false, reason: 'Invalid OTP' };
  }
  
  // Mark as verified
  this.verified = true;
  this.verifiedAt = new Date();
  
  return { valid: true };
};

// Static method to generate OTP
FeedbackOTPSchema.statics.generateOTP = function() {
  // Generate 6-digit OTP
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Static method to create new OTP entry
FeedbackOTPSchema.statics.createOTP = async function(email, name, interviewId) {
  // Remove any existing OTPs for this email and interview
  await this.deleteMany({ email, interviewId, verified: false });
  
  const otp = this.generateOTP();
  console.log('🔐 [OTP-GENERATE] New OTP Created:', {
    otp,
    otpType: typeof otp,
    otpLength: otp.length,
    email: email,
    interviewId: interviewId
  });
  
  const otpEntry = new this({
    email,
    name,
    interviewId,
    otp
  });
  
  await otpEntry.save();
  
  return otp;
};

module.exports = mongoose.model('FeedbackOTP', FeedbackOTPSchema);
