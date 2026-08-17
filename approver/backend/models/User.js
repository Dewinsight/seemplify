const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    firstName: { type: String, trim: true, default: '' },
    lastName: { type: String, trim: true, default: '' },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: {
        type: String,
        required() { return !this.idpSubject; }
    },
    idpSubject: { type: String, unique: true, sparse: true, trim: true },
    authProvider: { type: String, enum: ['local', 'seemplify-idp'], default: 'local' },
    sessionVersion: { type: Number, default: 0, min: 0 },
    lastLoginAt: { type: Date },

    // DEPRECATED — org membership now lives in UserOrganization model
    // Kept temporarily for backward compatibility during migration
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
    isAdmin: { type: Boolean, default: false },
    permissions: [{
        department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
        roles: [{ type: String, trim: true }]
    }],

    isVerified: { type: Boolean, default: false },
    otp: {
        code: String,
        expiresAt: Date
    },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
