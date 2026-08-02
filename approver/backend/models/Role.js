const mongoose = require('mongoose');

const RoleSchema = new mongoose.Schema({
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    key: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    capabilities: [{ type: String, trim: true }],
    isSystem: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

RoleSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

RoleSchema.index({ organization: 1, key: 1 }, { unique: true });
RoleSchema.index({ organization: 1, isActive: 1 });

module.exports = mongoose.model('Role', RoleSchema);
