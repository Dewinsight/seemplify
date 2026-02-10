const Invite = require('../models/Invite');
const UserOrganization = require('../models/UserOrganization');
const Department = require('../models/Department');
const User = require('../models/User');
const emailService = require('../services/EmailService');

const ALLOWED_INVITE_ROLES = Invite.schema.path('role').enumValues || ['Requester', 'GovernanceApprover', 'ExecutiveApprover', 'CenterOfExcellence'];

const getDisplayName = (user) => {
    const firstName = typeof user?.firstName === 'string' ? user.firstName.trim() : '';
    const lastName = typeof user?.lastName === 'string' ? user.lastName.trim() : '';
    const fullName = `${firstName} ${lastName}`.trim();
    return fullName || user?.username || 'Someone';
};

// Admin sends invite to an email
exports.sendInvite = async (req, res) => {
    try {
        const { email, role, department, isAdmin } = req.body;
        const selectedRole = role || 'Requester';

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        if (!ALLOWED_INVITE_ROLES.includes(selectedRole)) {
            return res.status(400).json({
                error: `Invalid role. Allowed roles: ${ALLOWED_INVITE_ROLES.join(', ')}`
            });
        }

        // Check if there's already a pending invite for this email+org
        const existingInvite = await Invite.findOne({
            email: email.toLowerCase(),
            organization: req.organization,
            status: 'pending',
            expiresAt: { $gt: new Date() }
        });
        if (existingInvite) {
            return res.status(400).json({ error: 'A pending invite already exists for this email in your organization.' });
        }

        // If department specified, validate it belongs to the org
        if (department) {
            const dept = await Department.findOne({ _id: department, organization: req.organization });
            if (!dept) {
                return res.status(400).json({ error: 'Department not found in your organization.' });
            }
        }

        const invite = new Invite({
            email: email.toLowerCase(),
            organization: req.organization,
            invitedBy: req.user.id,
            role: selectedRole,
            department: department || null,
            isAdmin: isAdmin || false
        });
        await invite.save();

        // Try to send email notification
        const inviter = await User.findById(req.user.id, 'username firstName lastName');
        const org = await require('../models/Organization').findById(req.organization, 'name');
        const hasAccount = !!(await User.findOne({ email: email.toLowerCase() }));
        try {
            await emailService.sendInvite(email, org?.name || 'Unknown', getDisplayName(inviter), hasAccount);
        } catch (emailErr) {
            console.warn('Failed to send invite email:', emailErr.message);
        }

        await invite.populate('organization', 'name slug');
        await invite.populate('invitedBy', 'username firstName lastName');

        res.status(201).json(invite);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get pending invites for the current user's email
exports.getPendingInvites = async (req, res) => {
    try {
        const invites = await Invite.find({
            email: req.user.email,
            status: 'pending',
            expiresAt: { $gt: new Date() }
        })
            .populate('organization', 'name slug')
            .populate('invitedBy', 'username firstName lastName')
            .populate('department', 'name')
            .sort({ createdAt: -1 });

        res.json(invites);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Accept an invite
exports.acceptInvite = async (req, res) => {
    try {
        const invite = await Invite.findById(req.params.id)
            .populate('organization', 'name slug');

        if (!invite) {
            return res.status(404).json({ error: 'Invite not found' });
        }

        // Validate invite belongs to this user's email
        if (invite.email !== req.user.email.toLowerCase()) {
            return res.status(403).json({ error: 'This invite is not for your account.' });
        }

        if (invite.status !== 'pending') {
            return res.status(400).json({ error: `Invite has already been ${invite.status}.` });
        }

        if (new Date() > invite.expiresAt) {
            invite.status = 'expired';
            await invite.save();
            return res.status(400).json({ error: 'This invite has expired.' });
        }

        // Check if user already belongs to this org
        const existingMembership = await UserOrganization.findOne({
            user: req.user.id,
            organization: invite.organization._id
        });
        if (existingMembership) {
            invite.status = 'accepted';
            invite.acceptedAt = new Date();
            await invite.save();
            return res.json({ message: 'You already belong to this organization.', alreadyMember: true });
        }

        // Find/create General dept if no specific dept
        let deptId = invite.department;
        if (!deptId) {
            let generalDept = await Department.findOne({ name: 'General', organization: invite.organization._id });
            if (!generalDept) {
                generalDept = await new Department({
                    name: 'General',
                    description: 'Default',
                    organization: invite.organization._id
                }).save();
            }
            deptId = generalDept._id;
        }

        // Create UserOrganization membership
        const membership = await UserOrganization.create({
            user: req.user.id,
            organization: invite.organization._id,
            isAdmin: invite.isAdmin || false,
            permissions: [{ department: deptId, roles: [invite.role || 'Requester'] }]
        });

        // Mark invite as accepted
        invite.status = 'accepted';
        invite.acceptedAt = new Date();
        await invite.save();

        await membership.populate('organization', 'name slug');
        await membership.populate('permissions.department', 'name');

        res.json({
            message: 'Invite accepted! You have joined the organization.',
            membership: {
                _id: membership.organization._id,
                name: membership.organization.name,
                slug: membership.organization.slug,
                isAdmin: membership.isAdmin,
                permissions: membership.permissions
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Decline an invite
exports.declineInvite = async (req, res) => {
    try {
        const invite = await Invite.findById(req.params.id);
        if (!invite) {
            return res.status(404).json({ error: 'Invite not found' });
        }

        if (invite.email !== req.user.email.toLowerCase()) {
            return res.status(403).json({ error: 'This invite is not for your account.' });
        }

        if (invite.status !== 'pending') {
            return res.status(400).json({ error: `Invite has already been ${invite.status}.` });
        }

        invite.status = 'declined';
        await invite.save();

        res.json({ message: 'Invite declined.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Admin: view invites sent by this org
exports.getSentInvites = async (req, res) => {
    try {
        const invites = await Invite.find({ organization: req.organization })
            .populate('invitedBy', 'username firstName lastName')
            .populate('department', 'name')
            .sort({ createdAt: -1 });

        res.json(invites);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Admin: revoke a pending invite
exports.revokeInvite = async (req, res) => {
    try {
        const invite = await Invite.findOne({
            _id: req.params.id,
            organization: req.organization,
            status: 'pending'
        });

        if (!invite) {
            return res.status(404).json({ error: 'Pending invite not found in your organization.' });
        }

        await Invite.findByIdAndDelete(req.params.id);
        res.json({ message: 'Invite revoked.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
