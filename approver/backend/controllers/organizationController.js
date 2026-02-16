const Organization = require('../models/Organization');
const path = require('path');
const fs = require('fs');

// Update organization name (Admin only)
exports.updateOrganization = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || typeof name !== 'string') {
            return res.status(400).json({ error: 'Organization name is required' });
        }

        const trimmedName = name.trim();
        if (!trimmedName) {
            return res.status(400).json({ error: 'Organization name cannot be empty' });
        }

        const org = await Organization.findById(req.organization);
        if (!org) {
            return res.status(404).json({ error: 'Organization not found' });
        }

        org.name = trimmedName;
        await org.save();

        res.json({ _id: org._id, name: org.name, slug: org.slug, logo: org.logo });
    } catch (error) {
        if (error && error.code === 11000) {
            return res.status(409).json({ error: 'An organization with that name already exists.' });
        }
        res.status(500).json({ error: error.message });
    }
};

// Upload organization logo (Admin only)
exports.uploadLogo = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const org = await Organization.findById(req.organization);
        if (!org) {
            return res.status(404).json({ error: 'Organization not found' });
        }

        // Remove old logo file if exists
        if (org.logo) {
            const oldPath = path.join(__dirname, '..', org.logo);
            if (fs.existsSync(oldPath)) {
                fs.unlinkSync(oldPath);
            }
        }

        // Store relative path: uploads/logos/filename
        const filename = req.file.filename;
        org.logo = `uploads/logos/${filename}`;
        await org.save();

        // Return URL path for frontend (API base + /uploads/logos/filename)
        const logoUrl = `/api/uploads/logos/${filename}`;
        res.json({ logo: org.logo, logoUrl });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
