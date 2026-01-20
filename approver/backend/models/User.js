const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    // Old fields (kept for migration or simple fallback if needed, but we will move to permissions)
    // role: { type: String, enum: ['Admin', 'Approver', 'Requester'], default: 'Requester' },
    // department: { type: String, default: 'General' },

    isAdmin: { type: Boolean, default: false }, // Global Admin
    permissions: [{
        department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
        role: { type: String, enum: ['Approver', 'Requester'] }
    }],

    // Legacy mapping helpers could be added, but field is enough
    isVerified: { type: Boolean, default: false },
    otp: {
        code: String,
        expiresAt: Date
    },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
