const Department = require('../models/Department');
const Job = require('../models/Job');

// Get departments for organization
exports.getDepartments = async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization;
    
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'No organization selected'
      });
    }

    const departments = await Department.find({ 
      organization: organizationId, 
      isActive: true 
    }).sort({ name: 1 });
    
    res.json({ success: true, departments });
  } catch (error) {
    console.error('Error fetching departments:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create new department
exports.createDepartment = async (req, res) => {
  try {
    const { name, description } = req.body;
    const organizationId = req.user.currentOrganization;
    
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'No organization selected'
      });
    }

    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Department name is required'
      });
    }

    // Check if department already exists
    const existingDepartment = await Department.findOne({
      organization: organizationId,
      name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
      isActive: true
    });
    
    if (existingDepartment) {
      return res.status(400).json({
        success: false,
        error: 'Department with this name already exists'
      });
    }
    
    const department = new Department({
      name: name.trim(),
      description: description?.trim() || '',
      organization: organizationId,
      createdBy: req.user.id
    });
    
    await department.save();
    
    console.log(`✅ Department created: ${department.name} for organization ${organizationId}`);
    res.status(201).json({ success: true, department });
  } catch (error) {
    console.error('Error creating department:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update department
exports.updateDepartment = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    const organizationId = req.user.currentOrganization;
    
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'No organization selected'
      });
    }

    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Department name is required'
      });
    }

    // Check if another department with the same name exists
    const existingDepartment = await Department.findOne({
      organization: organizationId,
      name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
      isActive: true,
      _id: { $ne: id }
    });
    
    if (existingDepartment) {
      return res.status(400).json({
        success: false,
        error: 'Department with this name already exists'
      });
    }
    
    const department = await Department.findOneAndUpdate(
      { _id: id, organization: organizationId, isActive: true },
      { 
        name: name.trim(), 
        description: description?.trim() || '',
        updatedAt: Date.now() 
      },
      { new: true }
    );
    
    if (!department) {
      return res.status(404).json({
        success: false,
        error: 'Department not found'
      });
    }
    
    console.log(`✅ Department updated: ${department.name} for organization ${organizationId}`);
    res.json({ success: true, department });
  } catch (error) {
    console.error('Error updating department:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete department
exports.deleteDepartment = async (req, res) => {
  try {
    const { id } = req.params;
    const organizationId = req.user.currentOrganization;
    
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'No organization selected'
      });
    }
    
    // Check if department exists
    const department = await Department.findOne({
      _id: id,
      organization: organizationId,
      isActive: true
    });
    
    if (!department) {
      return res.status(404).json({
        success: false,
        error: 'Department not found'
      });
    }
    
    // Check if department is used in any jobs
    const jobCount = await Job.countDocuments({
      organization: organizationId,
      department: id
    });
    
    if (jobCount > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete department. It is used in ${jobCount} job(s)`
      });
    }
    
    // Soft delete the department
    department.isActive = false;
    department.updatedAt = Date.now();
    await department.save();
    
    console.log(`✅ Department deleted: ${department.name} for organization ${organizationId}`);
    res.json({ success: true, message: 'Department deleted successfully' });
  } catch (error) {
    console.error('Error deleting department:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get department by ID
exports.getDepartmentById = async (req, res) => {
  try {
    const { id } = req.params;
    const organizationId = req.user.currentOrganization;
    
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'No organization selected'
      });
    }
    
    const department = await Department.findOne({
      _id: id,
      organization: organizationId,
      isActive: true
    });
    
    if (!department) {
      return res.status(404).json({
        success: false,
        error: 'Department not found'
      });
    }
    
    res.json({ success: true, department });
  } catch (error) {
    console.error('Error fetching department:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
