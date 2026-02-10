const express = require('express');
const router = express.Router();
const mainController = require('../controllers/mainController');
const authController = require('../controllers/authController');
const inviteController = require('../controllers/inviteController');
const { verifyToken, verifyRole, injectOrgContext, optionalToken } = require('../middleware/auth');

// --- Auth Routes ---
router.post('/auth/register', authController.register);
router.post('/auth/verify', authController.verifyOtp);
router.post('/auth/login', authController.login);
router.post('/auth/seed-admin', authController.seedAdmin);
router.patch('/auth/me', verifyToken, authController.updateProfile);

// --- Organizations ---
router.get('/organizations', mainController.getOrganizations); // Public list
router.post('/organizations', verifyToken, injectOrgContext, verifyRole(['Admin']), mainController.createOrganization);
router.post('/organizations/create-and-join', verifyToken, mainController.createAndJoin); // Onboarding (no org context)
router.get('/organizations/my', verifyToken, mainController.getMyOrganizations); // My memberships (no org context)

// --- Invites ---
router.get('/invites/pending', verifyToken, inviteController.getPendingInvites); // My pending invites (no org context)
router.post('/invites/:id/accept', verifyToken, inviteController.acceptInvite);
router.post('/invites/:id/decline', verifyToken, inviteController.declineInvite);
router.post('/invites', verifyToken, injectOrgContext, verifyRole(['Admin']), inviteController.sendInvite);
router.get('/invites/sent', verifyToken, injectOrgContext, verifyRole(['Admin']), inviteController.getSentInvites);
router.delete('/invites/:id', verifyToken, injectOrgContext, verifyRole(['Admin']), inviteController.revokeInvite);

// --- Departments ---
// Departments are org-scoped; require org context to avoid leaking departments across tenants.
router.get('/departments', verifyToken, injectOrgContext, mainController.getDepartments);
router.post('/departments', verifyToken, injectOrgContext, verifyRole(['Admin']), mainController.createDepartment);
router.delete('/departments/:id', verifyToken, injectOrgContext, verifyRole(['Admin']), mainController.deleteDepartment);

// --- Protected User Management (Admin Only) ---
router.get('/users', verifyToken, injectOrgContext, verifyRole(['Admin']), authController.getAllUsers);
router.patch('/users/role', verifyToken, injectOrgContext, verifyRole(['Admin']), authController.updateUserRole);

// --- Rules ---
router.post('/rules', verifyToken, injectOrgContext, verifyRole(['Admin', 'GovernanceApprover', 'ExecutiveApprover']), mainController.createRule);
router.get('/rules', verifyToken, injectOrgContext, mainController.getRules);

// --- Projects ---
router.post('/projects/analyze', verifyToken, injectOrgContext, mainController.analyzeProject);
router.get('/projects', verifyToken, injectOrgContext, mainController.getProjects);
router.get('/projects/:id', verifyToken, injectOrgContext, mainController.getProjectById);
router.patch('/projects/:id/override', verifyToken, injectOrgContext, verifyRole(['Admin', 'GovernanceApprover', 'ExecutiveApprover']), mainController.overrideProject);
router.delete('/rules/:id', verifyToken, injectOrgContext, verifyRole(['Admin', 'GovernanceApprover', 'ExecutiveApprover']), mainController.deleteRule);
router.delete('/projects/:id', verifyToken, injectOrgContext, verifyRole(['Admin']), mainController.deleteProject);

// Dashboard stats
router.get('/dashboard/stats', verifyToken, injectOrgContext, verifyRole(['Admin', 'GovernanceApprover', 'ExecutiveApprover']), mainController.getDashboardStats);

// --- Tiered Approval Workflow ---
router.post('/projects/governance-review', verifyToken, injectOrgContext, verifyRole(['Admin', 'GovernanceApprover', 'ExecutiveApprover']), mainController.governanceReview);
router.post('/projects/executive-review', verifyToken, injectOrgContext, verifyRole(['Admin', 'ExecutiveApprover']), mainController.executiveReview);
router.post('/projects/coe-review', verifyToken, injectOrgContext, verifyRole(['Admin', 'CenterOfExcellence']), mainController.centerOfExcellenceReview);
router.get('/projects/pending-reviews', verifyToken, injectOrgContext, verifyRole(['Admin', 'GovernanceApprover', 'ExecutiveApprover']), mainController.getPendingReviews);


module.exports = router;
