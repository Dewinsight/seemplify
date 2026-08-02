const User = require('../models/User');
const Department = require('../models/Department');
const Organization = require('../models/Organization');
const UserOrganization = require('../models/UserOrganization');
const Role = require('../models/Role');
const emailService = require('../services/EmailService');
const { ensureGovernanceConfigForOrganization } = require('../services/governanceConfigService');
const { buildRoleCatalog, sanitizePermissions, collectUserCapabilities } = require('../utils/access');
const { clearAuthCookie, setAuthCookie } = require('../utils/authSession');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const generateOtp = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

const normalizeName = (value) => (typeof value === 'string' ? value.trim() : '');
const hasCompletedProfile = (user) => {
    return Boolean(normalizeName(user?.firstName) && normalizeName(user?.lastName));
};

const buildAuthPayload = (user) => ({
    id: user._id,
    username: user.username,
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    email: user.email
});

const enrichMemberships = async (memberships) => {
    const orgIds = Array.from(new Set(
        memberships
            .map((membership) => membership.organization?._id || membership.organization)
            .filter(Boolean)
            .map(id => id.toString())
    ));

    for (const orgId of orgIds) {
        await ensureGovernanceConfigForOrganization(orgId);
    }

    const roleDocs = await Role.find(
        { organization: { $in: orgIds } },
        'organization key name description capabilities isSystem isActive'
    ).lean();

    const rolesByOrg = new Map();
    roleDocs.forEach((roleDoc) => {
        const orgId = roleDoc.organization.toString();
        if (!rolesByOrg.has(orgId)) rolesByOrg.set(orgId, []);
        rolesByOrg.get(orgId).push(roleDoc);
    });

    return memberships.map((membership) => {
        const orgId = (membership.organization?._id || membership.organization).toString();
        const orgRoles = rolesByOrg.get(orgId) || [];
        const roleCatalog = buildRoleCatalog(orgRoles);
        const permissions = sanitizePermissions(
            membership.permissions || [],
            Object.keys(roleCatalog).length > 0 ? new Set(Object.keys(roleCatalog)) : null
        );
        const capabilities = collectUserCapabilities({ permissions }, roleCatalog);

        return {
            _id: membership.organization._id,
            name: membership.organization.name,
            slug: membership.organization.slug,
            logo: membership.organization.logo,
            logoDark: membership.organization.logoDark,
            logoLight: membership.organization.logoLight,
            logoBackground: membership.organization.logoBackground,
            logoMode: membership.organization.logoMode,
            isAdmin: membership.isAdmin,
            permissions,
            capabilities,
            roles: orgRoles.map((role) => ({
                key: role.key,
                name: role.name,
                description: role.description || '',
                capabilities: role.capabilities || [],
                isSystem: role.isSystem === true,
                isActive: role.isActive !== false
            }))
        };
    });
};

const buildSessionResponse = async (user) => {
    const memberships = await UserOrganization.find({ user: user._id })
        .populate('organization', 'name slug logo logoDark logoLight logoBackground logoMode')
        .populate('permissions.department', 'name');

    const organizations = await enrichMemberships(memberships);

    return {
        user: buildAuthPayload(user),
        organizations,
        needsOnboarding: organizations.length === 0 || !hasCompletedProfile(user)
    };
};

// --- Registration: simple (username, email, password only) ---
exports.register = async (req, res) => {
    try {
        const { username, email, password, firstName, lastName } = req.body;

        // Check if user exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            if (!existingUser.isVerified) {
                const otp = generateOtp();
                const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
                existingUser.otp = { code: otp, expiresAt: otpExpiresAt };
                await existingUser.save();
                try {
                    await emailService.sendOtp(email, otp);
                } catch (e) {
                    console.warn('Failed to send OTP email:', e.message);
                }
                return res.status(200).json({
                    message: 'Account exists but not verified. OTP resent.',
                    needsVerification: true,
                    email: email
                });
            }
            return res.status(400).json({ error: 'Email already exists and is verified.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const otp = generateOtp();
        const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

        // Create user with NO org, NO permissions — org setup happens post-login via onboarding
        const user = new User({
            username,
            firstName: normalizeName(firstName),
            lastName: normalizeName(lastName),
            email,
            password: hashedPassword,
            otp: { code: otp, expiresAt: otpExpiresAt }
        });

        await user.save();
        try {
            await emailService.sendOtp(email, otp);
        } catch (e) {
            console.warn('Failed to send OTP email:', e.message);
        }
        res.status(201).json({ message: 'User registered. Check your email for the verification code.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.verifyOtp = async (req, res) => {
    try {
        const { email, otp } = req.body;
        const user = await User.findOne({ email });

        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.isVerified) return res.json({ message: 'User already verified' });

        if (!user.otp || user.otp.code !== otp) {
            return res.status(400).json({ error: 'Invalid OTP' });
        }

        if (new Date() > user.otp.expiresAt) {
            return res.status(400).json({ error: 'OTP expired' });
        }

        user.isVerified = true;
        user.otp = undefined;
        await user.save();

        res.json({ message: 'Account verified successfully. You can now login.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Resend OTP for unverified user
exports.resendOtp = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.isVerified) return res.json({ message: 'Account already verified' });

        const otp = generateOtp();
        const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
        user.otp = { code: otp, expiresAt: otpExpiresAt };
        await user.save();

        try {
            await emailService.sendOtp(email, otp);
        } catch (e) {
            console.warn('Failed to send OTP email:', e.message);
        }

        res.json({ message: 'Verification code resent. Check your email.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Login: returns org memberships list + needsOnboarding flag ---
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (!user) return res.status(400).json({ error: 'User not found' });

        if (!user.isVerified) {
            const otp = generateOtp();
            const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
            user.otp = { code: otp, expiresAt: otpExpiresAt };
            await user.save();
            try {
                await emailService.sendOtp(email, otp);
            } catch (e) {
                console.warn('Failed to send OTP email:', e.message);
            }

            return res.status(403).json({
                error: 'Account not verified.',
                needsVerification: true,
                email: email
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            console.warn(`Failed login attempt for email: ${email}`);
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        // Query all org memberships from UserOrganization
        const memberships = await UserOrganization.find({ user: user._id })
            .populate('organization', 'name slug logo logoDark logoLight logoBackground logoMode')
            .populate('permissions.department', 'name');

        // JWT payload = identity only (no org — active org comes via X-Organization-Id header)
        const payload = buildAuthPayload(user);

        const token = jwt.sign(
            payload,
            process.env.JWT_SECRET || 'default_secret',
            { expiresIn: '24h' }
        );

        const session = await buildSessionResponse(user);
        setAuthCookie(res, token);

        res.json({
            token,
            ...session
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getSession = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            clearAuthCookie(res);
            return res.status(404).json({ error: 'User not found' });
        }

        const session = await buildSessionResponse(user);
        res.json(session);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.logout = async (req, res) => {
    clearAuthCookie(res);
    res.json({ message: 'Logged out successfully' });
};

exports.seedAdmin = async (req, res) => {
    try {
        const existingAdmin = await User.findOne({ email: 'admin@approver.com' });
        if (existingAdmin) return res.json({ message: 'Admin already exists' });

        // Ensure Testing org exists
        let testingOrg = await Organization.findOne({ slug: 'testing' });
        if (!testingOrg) {
            testingOrg = await new Organization({
                name: 'Testing',
                slug: 'testing',
                description: 'Default organization'
            }).save();
        }

        await ensureGovernanceConfigForOrganization(testingOrg._id);

        const hashedPassword = await bcrypt.hash('password123', 10);

        let generalDept = await Department.findOne({ name: 'General', organization: testingOrg._id });
        if (!generalDept) generalDept = await new Department({ name: 'General', organization: testingOrg._id }).save();

        const admin = new User({
            username: 'admin',
            firstName: 'Admin',
            lastName: 'User',
            email: 'admin@approver.com',
            password: hashedPassword,
            isVerified: true
        });
        await admin.save();

        // Create UserOrganization membership
        await UserOrganization.create({
            user: admin._id,
            organization: testingOrg._id,
            isAdmin: true,
            permissions: [{ department: generalDept._id, roles: ['ExecutiveApprover'] }]
        });

        res.json({ message: 'Default admin created: admin / password123' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- User management (reads from UserOrganization) ---
exports.getAllUsers = async (req, res) => {
    try {
        const [memberships, activeRoles] = await Promise.all([
            UserOrganization.find({ organization: req.organization })
                .populate('user', '-password')
                .populate('permissions.department'),
            Role.find({ organization: req.organization, isActive: true }, 'key')
        ]);

        const validRoleKeys = new Set(activeRoles.map(role => role.key));

        const users = memberships.map(m => ({
            _id: m.user._id,
            username: m.user.username,
            firstName: m.user.firstName || '',
            lastName: m.user.lastName || '',
            email: m.user.email,
            isAdmin: m.isAdmin,
            permissions: sanitizePermissions(
                m.permissions || [],
                validRoleKeys.size > 0 ? validRoleKeys : null
            ),
            isVerified: m.user.isVerified,
            createdAt: m.user.createdAt
        }));

        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateUserRole = async (req, res) => {
    try {
        const { userId, isAdmin, permissions } = req.body;

        const membership = await UserOrganization.findOne({
            user: userId,
            organization: req.organization
        });
        if (!membership) return res.status(404).json({ error: 'User not found in this organization' });

        if (typeof isAdmin !== 'undefined') {
            membership.isAdmin = isAdmin;
        }

        if (permissions) {
            const activeRoles = await Role.find({ organization: req.organization, isActive: true }, 'key');
            const validRoleKeys = new Set(activeRoles.map(role => role.key));

            const incomingRoleKeys = (permissions || [])
                .flatMap(permission => Array.isArray(permission?.roles) ? permission.roles : [])
                .filter(Boolean);
            const invalidRoles = Array.from(new Set(incomingRoleKeys.filter(role => !validRoleKeys.has(role))));
            if (invalidRoles.length > 0) {
                return res.status(400).json({
                    error: `Invalid roles for this organization: ${invalidRoles.join(', ')}`
                });
            }

            membership.permissions = sanitizePermissions(
                permissions,
                validRoleKeys.size > 0 ? validRoleKeys : null
            );
        }

        await membership.save();
        res.json({ message: 'User updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateProfile = async (req, res) => {
    try {
        const { username, firstName, lastName } = req.body;
        const userId = req.user.id;
        const user = await User.findById(userId);

        if (!user) return res.status(404).json({ error: 'User not found' });

        if (typeof username !== 'undefined') {
            const nextUsername = typeof username === 'string' ? username.trim() : '';
            if (!nextUsername) {
                return res.status(400).json({ error: 'Username cannot be empty' });
            }
            user.username = nextUsername;
        }

        if (typeof firstName !== 'undefined') {
            const nextFirstName = normalizeName(firstName);
            if (!nextFirstName) {
                return res.status(400).json({ error: 'First name is required' });
            }
            user.firstName = nextFirstName;
        }

        if (typeof lastName !== 'undefined') {
            const nextLastName = normalizeName(lastName);
            if (!nextLastName) {
                return res.status(400).json({ error: 'Last name is required' });
            }
            user.lastName = nextLastName;
        }

        await user.save();
        res.json({
            message: 'Profile updated successfully',
            user: {
                id: user._id,
                username: user.username,
                firstName: user.firstName || '',
                lastName: user.lastName || '',
                email: user.email
            }
        });
    } catch (error) {
        if (error && error.code === 11000 && error.keyPattern?.username) {
            return res.status(409).json({ error: 'Username already exists' });
        }
        res.status(500).json({ error: error.message });
    }
};

// --- Forgot Password ---
exports.forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const user = await User.findOne({ email: email.toLowerCase().trim() });
        
        // Don't reveal whether the email exists or not
        if (!user) {
            return res.json({ message: 'If an account exists with this email, a password reset code has been sent' });
        }

        // Generate reset OTP
        const resetOtp = generateOtp();
        user.resetOtp = {
            code: resetOtp,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
        };
        
        await user.save();

        // Send reset email via Brevo
        await emailService.sendPasswordReset(user.email, resetOtp);

        res.json({ message: 'If an account exists with this email, a password reset code has been sent' });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'An error occurred. Please try again.' });
    }
};

// --- Reset Password ---
exports.resetPassword = async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        
        if (!email || !otp || !newPassword) {
            return res.status(400).json({ error: 'Email, OTP, and new password are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const user = await User.findOne({ email: email.toLowerCase().trim() });
        
        if (!user) {
            return res.status(404).json({ error: 'Invalid or expired reset code' });
        }

        // Verify OTP
        if (!user.resetOtp || 
            user.resetOtp.code !== otp.trim() || 
            user.resetOtp.expiresAt < new Date()) {
            return res.status(400).json({ error: 'Invalid or expired reset code' });
        }

        // Update password
        user.password = await bcrypt.hash(newPassword, 10);
        user.resetOtp = undefined; // Clear the reset OTP
        user.passwordChangedAt = new Date();
        
        await user.save();

        res.json({ message: 'Password reset successfully. You can now log in with your new password.' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'An error occurred. Please try again.' });
    }
};
