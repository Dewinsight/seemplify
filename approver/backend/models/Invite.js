const mongoose = require('mongoose');
const crypto = require('crypto');

const InviteSchema = new mongoose.Schema({
    email: { type: String, required: true, lowercase: true },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: {
        type: String,
        enum: ['Requester', 'GovernanceApprover', 'ExecutiveApprover', 'CenterOfExcellence'],
        default: 'Requester'
    },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
    isAdmin: { type: Boolean, default: false }, // Invite as org admin
    token: { type: String, required: true, unique: true },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'declined', 'expired'],
        default: 'pending'
    },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date },
    createdAt: { type: Date, default: Date.now }
});

// Find pending invites for an email
InviteSchema.index({ email: 1, status: 1 });
// Find invites for an org
InviteSchema.index({ organization: 1 });

// Auto-generate token before validation
InviteSchema.pre('validate', function (next) {
    if (!this.token) {
        this.token = crypto.randomBytes(32).toString('hex');
    }
    if (!this.expiresAt) {
        this.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    }
    next();
});

module.exports = mongoose.model('Invite', InviteSchema);
