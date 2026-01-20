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

exports.analyzeProject = async (req, res) => {
    try {
        const { name, description, repoUrl } = req.body;

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
            requester: req.user ? req.user.id : null
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
        // If Requester, only show their own projects
        if (req.user.role === 'Requester') {
            query.requester = req.user.id;
        }

        const projects = await Project.find(query).populate('requester', 'username department').sort({ createdAt: -1 });
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
            .populate('requester', 'username department');
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
        const total = await Project.countDocuments();
        const approved = await Project.countDocuments({ approvalStatus: 'Approved' });
        const rejected = await Project.countDocuments({ approvalStatus: 'Rejected' });
        const pending = await Project.countDocuments({ approvalStatus: { $in: ['Pending', 'Under Review'] } });
        const avgScoreAgg = await Project.aggregate([
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
