import express from 'express';
import multer from 'multer';
import { Account } from '../models/Account.js';
import CrossModuleApiService from '../../services/CrossModuleApiService.js';
import { getProfileCompletionForAccount } from '../utils/profileCompletion.js';
import { validatePersonalProfile } from '../utils/personalProfileValidation.js';
import { deleteFromCloudinary, uploadBufferToCloudinary } from '../services/cloudinaryService.js';
import { sendWebhook } from '../services/webhookService.js';

const router = express.Router();

const PROFILE_PICTURE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const profilePictureUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => {
        if (PROFILE_PICTURE_TYPES.has(String(file.mimetype || '').toLowerCase())) return callback(null, true);
        const error = new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'picture');
        error.message = 'Only JPEG, PNG, and WebP profile pictures are supported.';
        return callback(error);
    }
});

export function hasSupportedProfilePictureSignature(file) {
    const buffer = file?.buffer;
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
    if (file.mimetype === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (file.mimetype === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (file.mimetype === 'image/webp') {
        return buffer.subarray(0, 4).toString('ascii') === 'RIFF'
            && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    }
    return false;
}

function parseProfilePicture(req, res, next) {
    profilePictureUpload.single('picture')(req, res, (error) => {
        if (!error) return next();
        if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'The profile picture must be smaller than 5 MB.' });
        if (error instanceof multer.MulterError) return res.status(400).json({ error: error.message || 'The profile picture could not be read.' });
        return next(error);
    });
}

function ownedPictureAsset(profile = {}) {
    if (!profile.pictureStorageKey) return null;
    return {
        publicId: profile.pictureStorageKey,
        storageKey: profile.pictureStorageKey,
        storageProvider: profile.pictureStorageProvider,
        storageContainer: profile.pictureStorageContainer,
        resourceType: profile.pictureStorageResourceType || 'image'
    };
}

function publishProfilePictureChange(account) {
    const organizationIds = (account.organizations || [])
        .filter((membership) => membership.isActive !== false)
        .map((membership) => membership.organization?._id?.toString?.() || membership.organization?.toString?.())
        .filter(Boolean);
    return Promise.allSettled(organizationIds.map((organizationId) => sendWebhook('organization.member.updated', {
        organizationId,
        idpSubject: account.sub,
        email: account.email,
        picture: account.profile?.picture || null,
        change: 'profile.picture'
    })));
}

// Middleware to ensure user is authenticated
function ensureAuthenticated(req, res, next) {
    if (req.session && req.session.accountId) {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized' });
}

function resolveOrganizationId(req, account) {
    return req.session?.currentOrganization
        || account?.currentOrganization?._id?.toString?.()
        || account?.currentOrganization?.toString?.()
        || null;
}

router.post('/api/profile/picture', ensureAuthenticated, parseProfilePicture, async (req, res) => {
    let uploaded = null;
    try {
        if (!req.file) return res.status(400).json({ error: 'Choose a profile picture to upload.' });
        if (!hasSupportedProfilePictureSignature(req.file)) {
            return res.status(400).json({ error: 'The selected file is not a valid JPEG, PNG, or WebP image.' });
        }
        const account = await Account.findOne({ sub: req.session.accountId });
        if (!account) return res.status(404).json({ error: 'Account not found' });

        uploaded = await uploadBufferToCloudinary({
            buffer: req.file.buffer,
            filename: `avatar-${account.sub}-${Date.now()}.jpg`,
            folder: `identity-provider/profile-pictures/${account.sub}`,
            resourceType: 'image',
            mimeType: req.file.mimetype
        });
        const previousAsset = ownedPictureAsset(account.profile || {});
        account.profile = account.profile || {};
        account.profile.picture = uploaded.secure_url;
        account.profile.pictureStorageProvider = uploaded.storageProvider;
        account.profile.pictureStorageKey = uploaded.storageKey || uploaded.public_id;
        account.profile.pictureStorageContainer = uploaded.storageContainer || null;
        account.profile.pictureStorageResourceType = uploaded.resource_type || 'image';
        account.markModified('profile');
        await account.save();
        await publishProfilePictureChange(account);

        if (previousAsset && previousAsset.storageKey !== account.profile.pictureStorageKey) {
            deleteFromCloudinary(previousAsset).catch((error) => console.error('Previous profile picture cleanup failed:', error));
        }
        return res.json({ success: true, picture: account.profile.picture });
    } catch (error) {
        if (uploaded?.storageKey || uploaded?.public_id) {
            await deleteFromCloudinary({
                publicId: uploaded.public_id,
                storageKey: uploaded.storageKey,
                storageProvider: uploaded.storageProvider,
                storageContainer: uploaded.storageContainer,
                resourceType: uploaded.resource_type || 'image'
            }).catch(() => undefined);
        }
        console.error('Profile picture upload error:', error);
        const status = error?.message === 'Managed file storage is unavailable' ? 503 : 500;
        return res.status(status).json({
            error: status === 503
                ? 'Profile picture storage is temporarily unavailable. Please try again shortly.'
                : 'The profile picture could not be uploaded. Please try again.'
        });
    }
});

router.delete('/api/profile/picture', ensureAuthenticated, async (req, res) => {
    try {
        const account = await Account.findOne({ sub: req.session.accountId });
        if (!account) return res.status(404).json({ error: 'Account not found' });
        const previousAsset = ownedPictureAsset(account.profile || {});
        account.profile = account.profile || {};
        account.profile.picture = undefined;
        account.profile.pictureStorageProvider = undefined;
        account.profile.pictureStorageKey = undefined;
        account.profile.pictureStorageContainer = undefined;
        account.profile.pictureStorageResourceType = undefined;
        account.markModified('profile');
        await account.save();
        await publishProfilePictureChange(account);
        if (previousAsset) deleteFromCloudinary(previousAsset).catch((error) => console.error('Profile picture cleanup failed:', error));
        return res.json({ success: true, picture: null });
    } catch (error) {
        console.error('Profile picture removal error:', error);
        return res.status(500).json({ error: 'The profile picture could not be removed.' });
    }
});

async function updateCompletionTracking(req, account) {
    const completion = await getProfileCompletionForAccount(account, {
        organizationId: resolveOrganizationId(req, account)
    });
    account.profile = account.profile || {};
    account.profile.completionReminders = {
        ...(account.profile.completionReminders || {}),
        lastMissingSteps: (completion.steps || []).filter(step => !step.complete).map(step => step.key),
    };

    if (completion.complete) {
        account.profile.completionReminders.lastCompletedAt = new Date();
    }

    return completion;
}

/**
 * GET /api/profile/dashboard
 * Fetch aggregated employee dashboard data from all HR modules
 */
router.get('/api/profile/dashboard', ensureAuthenticated, async (req, res) => {
    try {
        const userId = req.session.accountId;
        const orgId = req.session.currentOrganization;

        if (!orgId) {
            return res.status(400).json({
                error: 'No organization selected',
                message: 'Please select an organization first'
            });
        }

        console.log(`📊 Fetching dashboard data for user: ${userId}, org: ${orgId}`);

        const crossModuleService = new CrossModuleApiService();
        const dashboardData = await crossModuleService.fetchAllEmployeeData(userId, orgId);

        res.json({
            success: true,
            data: dashboardData
        });
    } catch (error) {
        console.error('Dashboard data fetch error:', error);
        res.status(500).json({
            error: 'Failed to fetch dashboard data',
            message: error.message
        });
    }
});

/**
 * PUT /api/profile
 * Update basic user profile information
 */
router.put('/api/profile', ensureAuthenticated, async (req, res) => {
    try {
        const userId = req.session.accountId;
        const { name, preferredUsername } = req.body;

        const account = await Account.findOne({ sub: userId });
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }

        account.profile = account.profile || {};
        if (name !== undefined) account.profile.name = name;
        if (preferredUsername !== undefined) account.profile.preferred_username = preferredUsername;

        await account.save();

        res.json({
            success: true,
            message: 'Profile updated successfully',
            profile: account.profile
        });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

/**
 * PUT /api/profile/personal
 * Update extended personal information
 */
router.put('/api/profile/personal', ensureAuthenticated, async (req, res) => {
    try {
        const userId = req.session.accountId;
        const validation = validatePersonalProfile(req.body);
        if (!validation.valid) {
            return res.status(422).json({
                error: 'Check the highlighted fields and try again.',
                code: 'PERSONAL_PROFILE_VALIDATION_FAILED',
                fieldErrors: validation.fieldErrors
            });
        }

        const account = await Account.findOne({ sub: userId });
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }

        account.profile = account.profile || {};
        account.profile.personalInfo = validation.value;

        const completion = await updateCompletionTracking(req, account);
        account.markModified('profile');
        await account.save();

        res.json({
            success: true,
            message: 'Personal information updated successfully',
            profileCompletion: completion
        });
    } catch (error) {
        console.error('Personal info update error:', error);
        res.status(500).json({ error: 'Failed to update personal information' });
    }
});

/**
 * GET /api/profile/documents/payroll
 * Get list of payroll documents (payslips)
 */
router.get('/api/profile/documents/payroll', ensureAuthenticated, async (req, res) => {
    try {
        // TODO: Fetch from Payroll module
        res.json({
            success: true,
            documents: []  // Empty for now
        });
    } catch (error) {
        console.error('Error fetching payroll documents:', error);
        res.status(500).json({ error: 'Failed to fetch payroll documents' });
    }
});

export default router;
