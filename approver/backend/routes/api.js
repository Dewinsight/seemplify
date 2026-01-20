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

// --- Rules (Admin & Approver can manage, All can view?) ---
// Let's say Admins/Approvers can create rules, Requesters can only view.
router.post('/rules', verifyToken, verifyRole(['Admin', 'Approver']), mainController.createRule);
router.get('/rules', verifyToken, mainController.getRules); // All authenticated users can view rules

// --- Projects (Analysis) ---
router.post('/projects/analyze', verifyToken, mainController.analyzeProject);
router.get('/projects', verifyToken, mainController.getProjects);

// Project detail
router.get('/projects/:id', verifyToken, mainController.getProjectById);
// Admin override
router.patch('/projects/:id/override', verifyToken, verifyRole(['Admin', 'Approver']), mainController.overrideProject);
router.delete('/rules/:id', verifyToken, verifyRole(['Admin', 'Approver']), mainController.deleteRule);
router.delete('/projects/:id', verifyToken, verifyRole(['Admin']), mainController.deleteProject);

// Dashboard stats
router.get('/dashboard/stats', verifyToken, verifyRole(['Admin', 'Approver']), mainController.getDashboardStats);


module.exports = router;
