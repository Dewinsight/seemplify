const User = require('../models/User');
const Department = require('../models/Department');
const emailService = require('../services/EmailService');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const generateOtp = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

exports.register = async (req, res) => {
    try {
        const { username, email, password } = req.body; // department ignored for now, defaulting to General

        // Check if user exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            // If user exists but NOT verified, resend OTP and redirect to verify
            if (!existingUser.isVerified) {
                const otp = '111111'; // Hardcoded for dev
                const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
                existingUser.otp = { code: otp, expiresAt: otpExpiresAt };
                await existingUser.save();
                return res.status(200).json({
                    message: 'Account exists but not verified. OTP resent.',
                    needsVerification: true,
                    email: email
                });
            }
            return res.status(400).json({ error: 'Email already exists and is verified.' });
        }

        // Check for provided department
        let deptId = null;
        if (req.body.department) {
            const requestedDept = await Department.findById(req.body.department);
            if (requestedDept) deptId = requestedDept._id;
        }

        // Fallback to General
        if (!deptId) {
            let generalDept = await Department.findOne({ name: 'General' });
            if (!generalDept) {
                generalDept = await new Department({ name: 'General', description: 'Default' }).save();
            }
            deptId = generalDept._id;
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const otp = '111111';
        const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

        const user = new User({
            username,
            email,
            password: hashedPassword,
            permissions: [{ department: deptId, roles: ['Requester'] }], // Default role in that dept
            otp: { code: otp, expiresAt: otpExpiresAt }
        });

        await user.save();
        res.status(201).json({ message: 'User registered. Use OTP 111111 to verify.' });
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
        user.otp = undefined; // Clear OTP
        await user.save();

        res.json({ message: 'Account verified successfully. You can now login.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email }).populate('permissions.department');

        if (!user) return res.status(400).json({ error: 'User not found' });

        if (!user.isVerified) {
            // Resend OTP/Refresh logic
            const otp = '111111';
            const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
            user.otp = { code: otp, expiresAt: otpExpiresAt };
            await user.save();

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

        // Build Payload
        const payload = {
            id: user._id,
            username: user.username,
            isAdmin: user.isAdmin,
            // Fallbacks for legacy components - get highest role from first permission
            role: user.isAdmin ? 'Admin' : (
                user.permissions[0]?.roles?.[0] || user.permissions[0]?.role || 'Requester'
            ),
            permissions: user.permissions
        };

        const token = jwt.sign(
            payload,
            process.env.JWT_SECRET || 'default_secret',
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: payload
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.seedAdmin = async (req, res) => {
    try {
        const existingAdmin = await User.findOne({ email: 'admin@approver.com' });
        if (existingAdmin) return res.json({ message: 'Admin already exists' });

        const hashedPassword = await bcrypt.hash('password123', 10);

        let generalDept = await Department.findOne({ name: 'General' });
        if (!generalDept) generalDept = await new Department({ name: 'General' }).save();

        const admin = new User({
            username: 'admin',
            email: 'admin@approver.com',
            password: hashedPassword,
            isAdmin: true,
            permissions: [{ department: generalDept._id, roles: ['ExecutiveApprover'] }],
            isVerified: true
        });

        await admin.save();
        res.json({ message: 'Default admin created: admin / password123' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getAllUsers = async (req, res) => {
    try {
        const users = await User.find({}, '-password').populate('permissions.department');
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateUserRole = async (req, res) => {
    try {
        const { userId, role, isAdmin, permissions } = req.body;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // New Mode: Full update
        if (typeof isAdmin !== 'undefined') {
            user.isAdmin = isAdmin;
        }

        if (permissions) {
            // Validate? Ensure departments exist? Mongoose will cast to ObjectId.
            // Ensure format is correct
            user.permissions = permissions;
        }

        // Legacy fallback (if only role sent)
        if (role && typeof isAdmin === 'undefined' && !permissions) {
            if (role === 'Admin') user.isAdmin = true;
            else {
                user.isAdmin = false;
                // Basic toggle logic would go here but let's assume legacy usage is getting phased out
                // or just mapped to General department if absolutely necessary
                const generalDept = await Department.findOne({ name: 'General' });
                if (generalDept) {
                    user.permissions = [{ department: generalDept._id, roles: [role] }];
                }
            }
        }

        await user.save();
        res.json({ message: 'User updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateProfile = async (req, res) => {
    try {
        const { username } = req.body;
        const userId = req.user.id;
        const user = await User.findById(userId);

        if (!user) return res.status(404).json({ error: 'User not found' });

        if (username) user.username = username;

        // Restriction: Email and Password cannot be updated by user via profile.
        // Contact admin for sensitive changes.
        /*
        if (email && email !== user.email) {
            const existing = await User.findOne({ email });
            if (existing) return res.status(400).json({ error: 'Email already in use' });
            user.email = email;
        }

        if (password && password.trim()) {
            user.password = await bcrypt.hash(password, 10);
        }
        */

        await user.save();
        res.json({ message: 'Profile updated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
