const mongoose = require('mongoose');

const OrganizationSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    idpOrganizationId: { type: String, unique: true, sparse: true, trim: true },
    description: { type: String },
    logo: { type: String }, // Path/filename of uploaded logo (used when logoMode is 'all')
    logoDark: { type: String }, // Logo for dark theme (when logoMode is dark/system)
    logoLight: { type: String }, // Logo for light theme (when logoMode is light/system)
    logoStorage: { type: mongoose.Schema.Types.Mixed },
    logoDarkStorage: { type: mongoose.Schema.Types.Mixed },
    logoLightStorage: { type: mongoose.Schema.Types.Mixed },
    logoBackground: { type: String, default: 'transparent' }, // 'transparent' or hex color e.g. '#1a1a2e'
    logoMode: { type: String, default: 'all', enum: ['dark', 'light', 'system', 'all'] }, // When to show: dark theme only, light only, follow system, or always
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
});

// Auto-generate slug from name before validation
OrganizationSchema.pre('validate', function (next) {
    if (this.name && !this.slug) {
        this.slug = this.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    }
    next();
});

module.exports = mongoose.model('Organization', OrganizationSchema);
