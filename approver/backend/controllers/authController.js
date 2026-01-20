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
        const { username, email, password, department } = req.body;

        // Check if user exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            // If user exists but NOT verified, resend OTP and redirect to verify
            if (!existingUser.isVerified) {
                const otp = '111111'; // Hardcoded for dev
                const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
                existingUser.otp = { code: otp, expiresAt: otpExpiresAt };
                await existingUser.save();
                // await emailService.sendOtp(email, otp);
                return res.status(200).json({
                    message: 'Account exists but not verified. OTP resent.',
                    needsVerification: true,
                    email: email
                });
            }
            return res.status(400).json({ error: 'Email already exists and is verified.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        // OTP HARDCODED FOR DEV
        const otp = '111111';
        const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

        const user = new User({
            username,
            email,
            password: hashedPassword,
            department: department || 'General',
            role: 'Requester', // Default role
            otp: { code: otp, expiresAt: otpExpiresAt }
        });

        await user.save();
        // await emailService.sendOtp(email, otp); // Skip email sending

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
        const user = await User.findOne({ email });

        if (!user) return res.status(400).json({ error: 'User not found' });

        // IMPORTANT: Allow admin login even if not verified (manual seed)
        // Or enforce verification for everyone. Let's enforce for now generally, but specific exception if we seed verified.
        if (!user.isVerified) return res.status(403).json({ error: 'Account not verified. Please verify your email.' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

        const token = jwt.sign(
            { id: user._id, role: user.role, username: user.username, department: user.department },
            process.env.JWT_SECRET || 'default_secret',
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                department: user.department
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.seedAdmin = async (req, res) => {
    try {
        const existingAdmin = await User.findOne({ role: 'Admin' });
        if (existingAdmin) return res.json({ message: 'Admin already exists' });

        const hashedPassword = await bcrypt.hash('password123', 10);

        const admin = new User({
            username: 'admin',
            email: 'admin@approver.com',
            password: hashedPassword,
            role: 'Admin',
            department: 'IT',
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
        const users = await User.find({}, '-password'); // Exclude password
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateUserRole = async (req, res) => {
    try {
        const { userId, role } = req.body;
        await User.findByIdAndUpdate(userId, { role });
        res.json({ message: 'User role updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
