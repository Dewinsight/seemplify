// Department controller — PostgreSQL/Prisma (migrated from Mongoose).
const prisma = require('../db/client');
const orgAccess = require('../db/orgAccess');

const resolveCurrentOrganization = async (req) => {
  if (req.user?.currentOrganization) return req.user.currentOrganization;
  if (!req.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { currentOrganizationId: true },
  });
  if (user?.currentOrganizationId) {
    req.user.currentOrganization = user.currentOrganizationId;
    return user.currentOrganizationId;
  }

  const active = await orgAccess.getActiveMemberships(req.user.id);
  if (active.length > 0) {
    const orgId = active[0].organizationId;
    await prisma.user.update({
      where: { id: req.user.id },
      data: { currentOrganizationId: orgId, hasCompletedOrganizationSetup: true },
    });
    req.user.currentOrganization = orgId;
    return orgId;
  }
  return null;
};

// Get departments for organization
exports.getDepartments = async (req, res) => {
  try {
    const organizationId = await resolveCurrentOrganization(req);
    if (!organizationId) {
      return res.json({
        success: true,
        departments: [],
        message: 'No organization selected',
        requiresOrganizationSetup: true,
      });
    }

    const departments = await prisma.department.findMany({
      where: { organizationId, isActive: true },
      orderBy: { name: 'asc' },
    });

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
      return res.status(400).json({ success: false, error: 'No organization selected' });
    }
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Department name is required' });
    }

    const existingDepartment = await prisma.department.findFirst({
      where: { organizationId, isActive: true, name: { equals: name.trim(), mode: 'insensitive' } },
    });
    if (existingDepartment) {
      return res.status(400).json({ success: false, error: 'Department with this name already exists' });
    }

    let department;
    try {
      department = await prisma.department.create({
        data: { name: name.trim(), description: description?.trim() || '', organizationId, createdById: req.user.id },
      });
    } catch (e) {
      if (e.code === 'P2002') {
        return res.status(400).json({ success: false, error: 'Department with this name already exists' });
      }
      throw e;
    }

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
      return res.status(400).json({ success: false, error: 'No organization selected' });
    }
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Department name is required' });
    }

    const duplicate = await prisma.department.findFirst({
      where: { organizationId, isActive: true, name: { equals: name.trim(), mode: 'insensitive' }, id: { not: id } },
    });
    if (duplicate) {
      return res.status(400).json({ success: false, error: 'Department with this name already exists' });
    }

    const existing = await prisma.department.findFirst({ where: { id, organizationId, isActive: true } });
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Department not found' });
    }

    const department = await prisma.department.update({
      where: { id },
      data: { name: name.trim(), description: description?.trim() || '' },
    });

    console.log(`✅ Department updated: ${department.name} for organization ${organizationId}`);
    res.json({ success: true, department });
  } catch (error) {
    console.error('Error updating department:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete department (soft)
exports.deleteDepartment = async (req, res) => {
  try {
    const { id } = req.params;
    const organizationId = req.user.currentOrganization;

    if (!organizationId) {
      return res.status(400).json({ success: false, error: 'No organization selected' });
    }

    const department = await prisma.department.findFirst({ where: { id, organizationId, isActive: true } });
    if (!department) {
      return res.status(404).json({ success: false, error: 'Department not found' });
    }

    const jobCount = await prisma.job.count({ where: { organizationId, departmentId: id } });
    if (jobCount > 0) {
      return res.status(400).json({ success: false, error: `Cannot delete department. It is used in ${jobCount} job(s)` });
    }

    await prisma.department.update({ where: { id }, data: { isActive: false } });

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
      return res.status(400).json({ success: false, error: 'No organization selected' });
    }

    const department = await prisma.department.findFirst({ where: { id, organizationId, isActive: true } });
    if (!department) {
      return res.status(404).json({ success: false, error: 'Department not found' });
    }

    res.json({ success: true, department });
  } catch (error) {
    console.error('Error fetching department:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
