const Organization = require('../models/Organization');
const LogoAsset = require('../models/LogoAsset');
const path = require('path');
const fs = require('fs');
const { createStorageService } = require('../services/storageService');

const resolveFilename = (logoPath) => {
    if (!logoPath) return null;
    const filename = path.basename(String(logoPath));
    return filename && filename !== '.' ? filename : null;
};

const resolveDiskLogoPath = (filename) => path.join(__dirname, '..', 'uploads', 'logos', filename);

const deleteDiskLogoIfExists = (logoPath) => {
    if (!logoPath) return;
    const filename = resolveFilename(logoPath);
    if (!filename) return;
    const diskPath = resolveDiskLogoPath(filename);
    if (fs.existsSync(diskPath)) {
        fs.unlinkSync(diskPath);
    }
};

const loadUploadedLogoBuffer = (file) => {
    if (!file) return null;
    if (file.buffer && Buffer.isBuffer(file.buffer)) return file.buffer;
    if (file.path && fs.existsSync(file.path)) {
        return fs.readFileSync(file.path);
    }
    return null;
};

// Update organization (name, logo settings) - Admin only
exports.updateOrganization = async (req, res) => {
    try {
        const { name, logoBackground, logoMode } = req.body;

        const org = await Organization.findById(req.organization);
        if (!org) {
            return res.status(404).json({ error: 'Organization not found' });
        }

        if (name !== undefined) {
            if (!name || typeof name !== 'string') {
                return res.status(400).json({ error: 'Organization name cannot be empty' });
            }
            const trimmedName = name.trim();
            if (!trimmedName) {
                return res.status(400).json({ error: 'Organization name cannot be empty' });
            }
            org.name = trimmedName;
        }

        if (logoBackground !== undefined) {
            org.logoBackground = logoBackground === 'transparent' || !logoBackground ? 'transparent' : String(logoBackground);
        }
        if (logoMode !== undefined && ['dark', 'light', 'system', 'all'].includes(logoMode)) {
            org.logoMode = logoMode;
        }

        await org.save();

        res.json({ _id: org._id, name: org.name, slug: org.slug, logo: org.logo, logoDark: org.logoDark, logoLight: org.logoLight, logoBackground: org.logoBackground, logoMode: org.logoMode });
    } catch (error) {
        if (error && error.code === 11000) {
            return res.status(409).json({ error: 'An organization with that name already exists.' });
        }
        res.status(500).json({ error: error.message });
    }
};

// Upload organization logo (Admin only)
// Query param: variant=dark|light — when set, uploads to logoDark/logoLight. Otherwise updates logo (for "all" mode).
exports.uploadLogo = async (req, res) => {
    let stored = null;
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const org = await Organization.findById(req.organization);
        if (!org) {
            return res.status(404).json({ error: 'Organization not found' });
        }

        const variant = req.query.variant; // 'dark' | 'light'
        const field = variant === 'dark' ? 'logoDark' : variant === 'light' ? 'logoLight' : 'logo';
        const storageField = variant === 'dark' ? 'logoDarkStorage' : variant === 'light' ? 'logoLightStorage' : 'logoStorage';
        const newFilename = req.file.originalname;
        const newBuffer = loadUploadedLogoBuffer(req.file);

        if (!newFilename || !newBuffer) {
            return res.status(500).json({ error: 'Failed to process uploaded logo file' });
        }

        const previousLogoPath = org[field];
        const previousStorage = org[storageField];
        const previousFilename = resolveFilename(previousLogoPath);
        const storage = createStorageService();
        stored = await storage.uploadBuffer(newBuffer, {
            fileName: newFilename,
            mimeType: req.file.mimetype,
            folder: `approver/logos/${org._id}/${field}`
        });
        org[field] = stored.storageUrl;
        org[storageField] = stored;
        await org.save();

        if (previousStorage?.storageKey) await storage.remove(previousStorage).catch(() => false);
        if (previousFilename && !previousStorage?.storageKey) {
            await LogoAsset.deleteOne({ filename: previousFilename, organization: org._id });
            deleteDiskLogoIfExists(previousLogoPath);
        }

        const logoUrl = stored.storageUrl;
        res.json({ logo: org.logo, logoDark: org.logoDark, logoLight: org.logoLight, logoUrl, field });
    } catch (error) {
        if (stored?.storageKey) await createStorageService().remove(stored).catch(() => false);
        res.status(500).json({ error: error.message });
    }
};

// Remove organization logo (Admin only)
// Query param: variant=dark|light — when set, removes logoDark/logoLight. Otherwise removes logo.
exports.removeLogo = async (req, res) => {
    try {
        const org = await Organization.findById(req.organization);
        if (!org) {
            return res.status(404).json({ error: 'Organization not found' });
        }

        const variant = req.query.variant;
        const field = variant === 'dark' ? 'logoDark' : variant === 'light' ? 'logoLight' : 'logo';
        const storageField = variant === 'dark' ? 'logoDarkStorage' : variant === 'light' ? 'logoLightStorage' : 'logoStorage';

        if (org[field]) {
            if (org[storageField]?.storageKey) {
                await createStorageService().remove(org[storageField]);
            }
            const oldFilename = resolveFilename(org[field]);
            if (oldFilename && !org[storageField]?.storageKey) {
                await LogoAsset.deleteOne({ filename: oldFilename, organization: org._id });
            }
            if (!org[storageField]?.storageKey) deleteDiskLogoIfExists(org[field]);
        }

        org[field] = undefined;
        org[storageField] = undefined;
        await org.save();

        res.json({ logo: org.logo, logoDark: org.logoDark, logoLight: org.logoLight, [field]: null, message: 'Logo removed' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Serve logo from disk first, then fallback to MongoDB-backed logo asset.
exports.serveLogo = async (req, res) => {
    try {
        const filename = path.basename(String(req.params.filename || ''));
        if (!filename || filename === '.' || filename === '..') {
            return res.status(404).json({ error: 'Logo not found' });
        }

        const diskPath = resolveDiskLogoPath(filename);
        if (fs.existsSync(diskPath)) {
            return res.sendFile(diskPath);
        }

        const logoAsset = await LogoAsset.findOne({ filename }).select('mimeType data');
        if (!logoAsset || !logoAsset.data) {
            return res.status(404).json({ error: 'Logo not found' });
        }

        res.setHeader('Content-Type', logoAsset.mimeType || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(logoAsset.data);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
