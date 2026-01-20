const Rule = require('../models/Rule');
const Project = require('../models/Project');
const openAIService = require('../services/OpenAIService');

exports.createRule = async (req, res) => {
    try {
        const rule = new Rule(req.body);
        await rule.save();
        res.status(201).json(rule);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getRules = async (req, res) => {
    try {
        const rules = await Rule.find();
        res.json(rules);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getDepartments = async (req, res) => {
    try {
        const departments = await require('../models/Department').find({}, 'name description manager').populate('manager', 'username');
        res.json(departments);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.createDepartment = async (req, res) => {
    try {
        const { name, description } = req.body;
        const Department = require('../models/Department');
        const dept = new Department({ name, description });
        await dept.save();
        res.status(201).json(dept);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.deleteDepartment = async (req, res) => {
    try {
        const Department = require('../models/Department');
        await Department.findByIdAndDelete(req.params.id);
        res.json({ message: 'Department deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.analyzeProject = async (req, res) => {
    try {
        const { name, description, repoUrl } = req.body;

        // Determine Department
        let department = req.body.department;

        // Validate user belongs to this department (unless Admin)
        if (department && !req.user.isAdmin) {
            const hasConf = req.user.permissions.some(p => p.department.toString() === department.toString());
            if (!hasConf) {
                return res.status(403).json({ error: 'You do not have permissions for the selected department.' });
            }
        }

        if (!department) {
            // Fallback default
            if (req.user && req.user.permissions && req.user.permissions.length > 0) {
                // If permissions objects are populated, .department is an object. 
                // Wait, verifyToken doesn't populate nested department details, usually just IDs unless explicitly populated in middleware lookup.
                // In authController.login I populate it. In middleware?
                // verifyToken just uses jwt payload which HAS populated objects.
                // So p.department might be {_id:..., name:...} OR a string depending on how it was saved.
                // Safest to access ._id if it's an object, or use it if string.
                const firstDept = req.user.permissions[0].department;
                department = firstDept._id || firstDept;
            } else {
                const general = await require('../models/Department').findOne({ name: 'General' });
                department = general?._id;
            }
        }

        // 1. Fetch active rules
        const rules = await Rule.find({ isActive: true });

        if (rules.length === 0) {
            return res.status(400).json({ error: "No active rules defined for approval." });
        }

        // 2. Perform Analysis
        const analysisResult = await openAIService.analyzeProject(description || "No description provided", rules);

        // 3. Compute weighted score and determine final status
        let totalWeight = 0;
        let passedWeight = 0;
        let mandatoryFailed = false;
        const ruleMap = {};
        rules.forEach(r => {
            ruleMap[r.name] = r;
            totalWeight += r.weight || 1;
        });
        const ruleAnalyses = analysisResult.rulesAnalysis || [];
        ruleAnalyses.forEach(ra => {
            const rule = ruleMap[ra.ruleName];
            if (!rule) return;
            const weight = rule.weight || 1;
            if (ra.status && ra.status.toLowerCase() === 'pass') {
                passedWeight += weight;
            }
            if (rule.isMandatory && (!ra.status || ra.status.toLowerCase() !== 'pass')) {
                mandatoryFailed = true;
            }
        });
        const score = totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : 0;
        const minPassScore = process.env.MIN_PASS_SCORE ? parseInt(process.env.MIN_PASS_SCORE) : 70;
        const finalStatus = (!mandatoryFailed && score >= minPassScore) ? 'Approved' : 'Rejected';

        const project = new Project({
            name,
            description,
            repoUrl,
            analysisResult,
            approvalStatus: finalStatus,
            status: finalStatus,
            score,
            requester: req.user ? req.user.id : null,
            department: department
        });
        await project.save();

        res.json(project);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getProjects = async (req, res) => {
    try {
        let query = {};

        // Admin sees all
        if (req.user.isAdmin) {
            // No filter
        } else {
            // Build filter based on permissions
            // Can see if:
            // 1. I am the requester
            // 2. I have 'Approver' role in the project's department

            const approverDeptIds = (req.user.permissions || [])
                .filter(p => p.role === 'Approver')
                .map(p => p.department);

            query = {
                $or: [
                    { requester: req.user.id },
                    { department: { $in: approverDeptIds } }
                ]
            };
        }

        // Filter by specific department if requested
        if (req.query.department) {
            query.department = req.query.department;
        }

        const projects = await Project.find(query)
            .populate('requester', 'username department')
            .populate('department', 'name')
            .sort({ createdAt: -1 });
        res.json(projects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.overrideProject = async (req, res) => {
    try {
        const { projectId, newStatus, reason } = req.body;
        // Only allow Approved or Rejected as final statuses
        if (!['Approved', 'Rejected'].includes(newStatus)) {
            return res.status(400).json({ error: 'Invalid status for override.' });
        }
        const project = await Project.findById(projectId);
        if (!project) {
            return res.status(404).json({ error: 'Project not found.' });
        }
        const previousStatus = project.approvalStatus;
        project.approvalStatus = newStatus;
        project.status = newStatus;
        project.overrideBy = req.user.id;
        project.overrideReason = reason || '';
        await project.save();
        // Record audit
        const Audit = require('../models/Audit');
        await Audit.create({
            project: project._id,
            action: 'override',
            performedBy: req.user.id,
            previousStatus,
            newStatus,
            reason,
        });
        res.json(project);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get a single project by ID (including analysis and score)
exports.getProjectById = async (req, res) => {
    try {
        const projectId = req.params.id;
        const project = await Project.findById(projectId)
            .populate('requester', 'username department')
            .populate('department', 'name');
        if (!project) {
            return res.status(404).json({ error: 'Project not found.' });
        }
        res.json(project);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Dashboard statistics for admin/approver view
exports.getDashboardStats = async (req, res) => {
    try {
        let query = {};
        if (!req.user.isAdmin) {
            const approverDeptIds = (req.user.permissions || [])
                .filter(p => p.role === 'Approver' || p.role === 'Requester') // Requesters see their own scope stats? Or just Approvers?
                // Usually stats are for Approvers. Requesters just see their own list.
                // But if a Requester accesses dashboard, maybe show stats of their own projects?
                // Let's stick to: Stats show what getProjects shows.
                .map(p => p.department);
            // Reconstruct the OR query properly is hard for countDocuments aggregate without duplications if logic overlaps.
            // Simpler: Just count matches.

            // Wait, the query used in getProjects (Requester OR ApproverDept)
            const approverDepts = (req.user.permissions || [])
                .filter(p => p.role === 'Approver')
                .map(p => p.department);

            query = {
                $or: [
                    { requester: req.user.id },
                    { department: { $in: approverDepts } }
                ]
            };
        }

        // Filter by specific department if requested
        if (req.query.department) {
            query.department = req.query.department;
        }

        const total = await Project.countDocuments(query);
        const approved = await Project.countDocuments({ ...query, approvalStatus: 'Approved' });
        const rejected = await Project.countDocuments({ ...query, approvalStatus: 'Rejected' });
        const pending = await Project.countDocuments({ ...query, approvalStatus: { $in: ['Pending', 'Under Review'] } });

        // Aggregate for avg score needs the query match
        const avgScoreAgg = await Project.aggregate([
            { $match: query },
            { $group: { _id: null, avgScore: { $avg: '$score' } } }
        ]);
        const avgScore = avgScoreAgg[0] ? Math.round(avgScoreAgg[0].avgScore) : 0;

        res.json({ total, approved, rejected, pending, avgScore });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Delete a rule
exports.deleteRule = async (req, res) => {
    try {
        await Rule.findByIdAndDelete(req.params.id);
        res.json({ message: 'Rule deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Delete a project
exports.deleteProject = async (req, res) => {
    try {
        await Project.findByIdAndDelete(req.params.id);
        // Also remove associated audit logs? Optional but good practice.
        // await require('../models/Audit').deleteMany({ project: req.params.id }); 
        res.json({ message: 'Project deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
