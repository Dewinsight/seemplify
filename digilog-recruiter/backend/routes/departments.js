const express = require('express');
const router = express.Router();
const departmentController = require('../controllers/departmentController');
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization } = require('../middleware/organizationMiddleware');

// Apply authentication and organization middleware
router.use(authMiddleware);
router.use(requireOrganization);

// Department routes
router.get('/', departmentController.getDepartments);
router.post('/', departmentController.createDepartment);
router.get('/:id', departmentController.getDepartmentById);
router.put('/:id', departmentController.updateDepartment);
router.delete('/:id', departmentController.deleteDepartment);

module.exports = router;
