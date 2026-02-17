const mongoose = require('mongoose');

const UserOrganizationSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    isAdmin: { type: Boolean, default: false }, // Org-level admin for THIS org
    permissions: [{
        department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
        roles: [{ type: String, trim: true }]
    }],
    joinedAt: { type: Date, default: Date.now }
});

// One membership per user-org pair
UserOrganizationSchema.index({ user: 1, organization: 1 }, { unique: true });
// Find all members of an org
UserOrganizationSchema.index({ organization: 1 });
// Find all orgs for a user
UserOrganizationSchema.index({ user: 1 });

module.exports = mongoose.model('UserOrganization', UserOrganizationSchema);
