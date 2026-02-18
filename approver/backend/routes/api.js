const express = require('express');
const router = express.Router();
const mainController = require('../controllers/mainController');
const authController = require('../controllers/authController');
const inviteController = require('../controllers/inviteController');
const organizationController = require('../controllers/organizationController');
const governanceController = require('../controllers/governanceController');
const upload = require('../middleware/upload');
const { verifyToken, verifyRole, injectOrgContext, optionalToken } = require('../middleware/auth');

// --- Auth Routes ---
router.post('/auth/register', authController.register);
router.post('/auth/verify', authController.verifyOtp);
router.post('/auth/resend-otp', authController.resendOtp);
router.post('/auth/login', authController.login);
router.post('/auth/seed-admin', authController.seedAdmin);
router.patch('/auth/me', verifyToken, authController.updateProfile);

// --- Organizations ---
router.get('/organizations', mainController.getOrganizations); // Public list
router.post('/organizations', verifyToken, injectOrgContext, verifyRole(['Admin']), mainController.createOrganization);
router.post('/organizations/create-and-join', verifyToken, mainController.createAndJoin); // Onboarding (no org context)
router.get('/organizations/my', verifyToken, mainController.getMyOrganizations); // My memberships (no org context)
router.patch('/organizations/current', verifyToken, injectOrgContext, verifyRole(['Admin']), organizationController.updateOrganization);
router.post('/organizations/current/logo', verifyToken, injectOrgContext, verifyRole(['Admin']), (req, res, next) => {
    upload.single('logo')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message || 'Invalid file' });
        next();
    });
}, organizationController.uploadLogo);
router.delete('/organizations/current/logo', verifyToken, injectOrgContext, verifyRole(['Admin']), organizationController.removeLogo);

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

// --- Role Catalog / Workflow Policy ---
router.get('/roles', verifyToken, injectOrgContext, governanceController.getRoles);
router.post('/roles', verifyToken, injectOrgContext, verifyRole(['Admin']), governanceController.createRole);
router.patch('/roles/:id', verifyToken, injectOrgContext, verifyRole(['Admin']), governanceController.updateRole);
router.delete('/roles/:id', verifyToken, injectOrgContext, verifyRole(['Admin']), governanceController.deleteRole);
router.get('/workflow-policy', verifyToken, injectOrgContext, verifyRole(['Admin']), governanceController.getWorkflowPolicy);
router.put('/workflow-policy', verifyToken, injectOrgContext, verifyRole(['Admin']), governanceController.updateWorkflowPolicy);
router.post('/workflow-policy/reset', verifyToken, injectOrgContext, verifyRole(['Admin']), governanceController.resetWorkflowPolicy);
router.get('/scoring-policy', verifyToken, injectOrgContext, verifyRole(['scoring.manage']), governanceController.getScoringPolicy);
router.put('/scoring-policy', verifyToken, injectOrgContext, verifyRole(['scoring.manage']), governanceController.updateScoringPolicy);

// --- Rules ---
router.post('/rules', verifyToken, injectOrgContext, verifyRole(['rules.manage']), mainController.createRule);
router.get('/rules', verifyToken, injectOrgContext, mainController.getRules);
router.post('/rules/embedding/retry-all', verifyToken, injectOrgContext, verifyRole(['rules.manage']), mainController.retryAllRuleEmbeddings);
router.patch('/rules/system/bulk', verifyToken, injectOrgContext, verifyRole(['rules.manage.system']), mainController.bulkUpdateSystemRules);
router.post('/rules/:id/embedding/retry', verifyToken, injectOrgContext, verifyRole(['rules.manage']), mainController.retryRuleEmbedding);
router.patch('/rules/:id', verifyToken, injectOrgContext, verifyRole(['rules.manage']), mainController.updateRule);

// --- Projects ---
router.post('/projects/analyze-async', verifyToken, injectOrgContext, mainController.analyzeProjectAsync);
router.get('/projects/analyze-jobs/:jobId', verifyToken, injectOrgContext, mainController.getAnalyzeJobStatus);
router.post('/projects/analyze', verifyToken, injectOrgContext, mainController.analyzeProject);
router.get('/projects', verifyToken, injectOrgContext, mainController.getProjects);
router.get('/projects/:id', verifyToken, injectOrgContext, mainController.getProjectById);
router.patch('/projects/:id/override', verifyToken, injectOrgContext, verifyRole(['projects.override']), mainController.overrideProject);
router.delete('/rules/:id', verifyToken, injectOrgContext, verifyRole(['rules.manage']), mainController.deleteRule);
router.delete('/projects/:id', verifyToken, injectOrgContext, verifyRole(['Admin']), mainController.deleteProject);

// Dashboard stats
router.get('/dashboard/stats', verifyToken, injectOrgContext, verifyRole(['dashboard.review']), mainController.getDashboardStats);

// --- Tiered Approval Workflow ---
router.post('/projects/governance-review', verifyToken, injectOrgContext, verifyRole(['projects.review.governance']), mainController.governanceReview);
router.post('/projects/executive-review', verifyToken, injectOrgContext, verifyRole(['projects.review.executive']), mainController.executiveReview);
router.post('/projects/coe-review', verifyToken, injectOrgContext, verifyRole(['projects.review.coe']), mainController.centerOfExcellenceReview);
router.get('/projects/pending-reviews', verifyToken, injectOrgContext, verifyRole(['dashboard.review']), mainController.getPendingReviews);


module.exports = router;
