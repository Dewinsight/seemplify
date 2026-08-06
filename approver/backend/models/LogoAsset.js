const mongoose = require('mongoose');

const LogoAssetSchema = new mongoose.Schema({
    organization: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Organization',
        required: true,
        index: true
    },
    filename: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    mimeType: {
        type: String,
        default: 'application/octet-stream'
    },
    size: {
        type: Number,
        default: 0
    },
    data: {
        type: Buffer,
        required: true
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

LogoAssetSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

LogoAssetSchema.index({ organization: 1, updatedAt: -1 });

module.exports = mongoose.model('LogoAsset', LogoAssetSchema);
