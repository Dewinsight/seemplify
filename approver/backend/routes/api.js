const express = require('express');
const router = express.Router();
const mainController = require('../controllers/mainController');
const authController = require('../controllers/authController');
const { verifyToken, verifyRole } = require('../middleware/auth');

// --- Auth Routes ---
router.post('/auth/register', authController.register);
router.post('/auth/verify', authController.verifyOtp);
router.post('/auth/login', authController.login);
router.post('/auth/seed-admin', authController.seedAdmin); // Call manually once
router.patch('/auth/me', verifyToken, authController.updateProfile);

// --- Constants ---
// Need to make sure mainController has these keys.
// ... 

// --- Departments (Public List for Register, Admin for Manage) ---
router.get('/departments', mainController.getDepartments);
router.post('/departments', verifyToken, verifyRole(['Admin']), mainController.createDepartment);
router.delete('/departments/:id', verifyToken, verifyRole(['Admin']), mainController.deleteDepartment);

// --- Protected User Management (Admin Only) ---
router.get('/users', verifyToken, verifyRole(['Admin']), authController.getAllUsers);
router.patch('/users/role', verifyToken, verifyRole(['Admin']), authController.updateUserRole);

// --- Rules (Admin & GovernanceApprover can manage, All can view)
router.post('/rules', verifyToken, verifyRole(['Admin', 'GovernanceApprover', 'ExecutiveApprover']), mainController.createRule);
router.get('/rules', verifyToken, mainController.getRules); // All authenticated users can view rules

// --- Projects (Analysis) ---
router.post('/projects/analyze', verifyToken, mainController.analyzeProject);
router.get('/projects', verifyToken, mainController.getProjects);

// Project detail
router.get('/projects/:id', verifyToken, mainController.getProjectById);
// Admin/Governance override
router.patch('/projects/:id/override', verifyToken, verifyRole(['Admin', 'GovernanceApprover', 'ExecutiveApprover']), mainController.overrideProject);
router.delete('/rules/:id', verifyToken, verifyRole(['Admin', 'GovernanceApprover', 'ExecutiveApprover']), mainController.deleteRule);
router.delete('/projects/:id', verifyToken, verifyRole(['Admin']), mainController.deleteProject);

// Dashboard stats
router.get('/dashboard/stats', verifyToken, verifyRole(['Admin', 'GovernanceApprover', 'ExecutiveApprover']), mainController.getDashboardStats);

// --- Tiered Approval Workflow ---
// Governance Committee review
router.post('/projects/governance-review', verifyToken, verifyRole(['Admin', 'GovernanceApprover', 'ExecutiveApprover']), mainController.governanceReview);
// Executive review  
router.post('/projects/executive-review', verifyToken, verifyRole(['Admin', 'ExecutiveApprover']), mainController.executiveReview);
// CoE review
router.post('/projects/coe-review', verifyToken, verifyRole(['Admin', 'CenterOfExcellence']), mainController.centerOfExcellenceReview);
// Get pending reviews for reviewer dashboard
router.get('/projects/pending-reviews', verifyToken, verifyRole(['Admin', 'GovernanceApprover', 'ExecutiveApprover']), mainController.getPendingReviews);


module.exports = router;
