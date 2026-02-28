const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization, requirePermission, requireOrganizationOwnership } = require('../middleware/organizationMiddleware');
const organizationController = require('../controllers/organizationController');

// Create organization
router.post('/', authMiddleware, organizationController.createOrganization);

// Get user's organizations
router.get('/user', authMiddleware, organizationController.getUserOrganizations);

// Get organization creation limits
router.get('/limits', authMiddleware, organizationController.getOrganizationLimits);

// Switch current organization
router.post('/switch', authMiddleware, organizationController.switchOrganization);

// Get current organization
router.get('/current', authMiddleware, requireOrganization, organizationController.getOrganization);

// Update current organization
router.put('/current', authMiddleware, requireOrganization, requirePermission('manage_users'), organizationController.updateOrganization);

// Delete organization (owner only) - current organization
router.delete('/current', authMiddleware, requireOrganization, requireOrganizationOwnership, organizationController.deleteOrganization);

// Delete organization by ID (owner only)
router.delete('/:organizationId', authMiddleware, organizationController.deleteOrganizationById);

// Invite user to organization
router.post('/invite', authMiddleware, requireOrganization, requirePermission('manage_users'), organizationController.inviteUser);

// Accept organization invite
router.post('/invite/:token/accept', authMiddleware, organizationController.acceptInvite);

// Get invite details (public access for checking invite validity)
router.get('/invite/:token', organizationController.getInviteDetails);

// Get organization members
router.get('/members', authMiddleware, requireOrganization, organizationController.getOrganizationMembers);

// Remove member from organization
router.delete('/members/:memberId', authMiddleware, requireOrganization, requirePermission('manage_users'), organizationController.removeMember);

// Leave organization (self-remove)
router.post('/leave', authMiddleware, requireOrganization, organizationController.leaveOrganization);

// Update member role
router.put('/members/:memberId/role', authMiddleware, requireOrganization, requirePermission('manage_users'), organizationController.updateMemberRole);

// Get pending invitations for organization
router.get('/invitations/pending', authMiddleware, requireOrganization, requirePermission('manage_users'), organizationController.getPendingInvitations);

// Cancel pending invitation
router.delete('/invitations/:inviteId', authMiddleware, requireOrganization, requirePermission('manage_users'), organizationController.cancelInvitation);

// Get pending invitations for user (invitations they received)
router.get('/user/invitations/pending', authMiddleware, organizationController.getUserPendingInvitations);

// Cleanup rejected/expired invitations for organization
router.post('/invitations/cleanup', authMiddleware, requireOrganization, requirePermission('manage_users'), organizationController.cleanupInvitations);

// Transfer organization ownership
router.post('/transfer-ownership', authMiddleware, requireOrganization, requireOrganizationOwnership, organizationController.transferOwnership);

module.exports = router; 