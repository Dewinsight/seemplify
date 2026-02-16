const User = require('../models/User');
const Department = require('../models/Department');
const Organization = require('../models/Organization');
const UserOrganization = require('../models/UserOrganization');
const emailService = require('../services/EmailService');
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
            .populate('organization', 'name slug logo')
            .populate('permissions.department', 'name');

        // JWT payload = identity only (no org — active org comes via X-Organization-Id header)
        const payload = {
            id: user._id,
            username: user.username,
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            email: user.email
        };

        const token = jwt.sign(
            payload,
            process.env.JWT_SECRET || 'default_secret',
            { expiresIn: '24h' }
        );

        // Transform memberships for frontend
        const organizations = memberships.map(m => ({
            _id: m.organization._id,
            name: m.organization.name,
            slug: m.organization.slug,
            logo: m.organization.logo,
            isAdmin: m.isAdmin,
            permissions: m.permissions
        }));

        res.json({
            token,
            user: payload,
            organizations,
            needsOnboarding: organizations.length === 0 || !hasCompletedProfile(user)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
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
        const memberships = await UserOrganization.find({ organization: req.organization })
            .populate('user', '-password')
            .populate('permissions.department');

        const users = memberships.map(m => ({
            _id: m.user._id,
            username: m.user.username,
            firstName: m.user.firstName || '',
            lastName: m.user.lastName || '',
            email: m.user.email,
            isAdmin: m.isAdmin,
            permissions: m.permissions,
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
            membership.permissions = permissions;
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
