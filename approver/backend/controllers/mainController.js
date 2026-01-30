const Rule = require('../models/Rule');
const Project = require('../models/Project');
const openAIService = require('../services/OpenAIService');

exports.createRule = async (req, res) => {
    try {
        // Ensure department is handled (null if empty)
        const { department } = req.body;
        const rule = new Rule({ ...req.body, department: department || null });
        await rule.save();
        res.status(201).json(rule);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getRules = async (req, res) => {
    try {
        const { department } = req.query;
        let query = {};

        if (department) {
            // Specific Context: Rules for this Dept + General Rules
            query = { $or: [{ department: department }, { department: null }] };
        } else if (!req.user.isAdmin) {
            // Non-admin without context sees only General rules? 
            // Or maybe they shouldn't see anything if no context? Default to General.
            query = { department: null };
        }
        // If Admin and no department query, query remains {} (All rules)

        const rules = await Rule.find(query).populate('department', 'name');
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
        const { name, description, repoUrl, formData } = req.body;

        // Determine Department
        let department = req.body.department;

        // Validate user belongs to this department (unless Admin)
        if (department && !req.user.isAdmin) {
            const hasConf = req.user.permissions.some(p => {
                const userDeptId = (p.department._id || p.department).toString();
                return userDeptId === department.toString();
            });
            if (!hasConf) {
                return res.status(403).json({ error: 'You do not have permissions for the selected department.' });
            }
        }

        if (!department) {
            // Fallback default
            if (req.user && req.user.permissions && req.user.permissions.length > 0) {
                const firstDept = req.user.permissions[0].department;
                department = firstDept._id || firstDept;
            } else {
                const general = await require('../models/Department').findOne({ name: 'General' });
                department = general?._id;
            }
        }

        // 1. Fetch active rules for this scope (Dept + Global)
        const rules = await Rule.find({
            isActive: true,
            $or: [{ department: department }, { department: null }]
        });

        if (rules.length === 0) {
            return res.status(400).json({ error: "No active rules defined for approval." });
        }

        // 2. Perform Analysis
        const analysisResult = await openAIService.analyzeProject(description || "No description provided", rules);

        // 3. Compute weighted score and check for mandatory rule failures
        let totalWeight = 0;
        let passedWeight = 0;
        let mandatoryFailed = false;
        const escalationTriggers = [];
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
            // Check for mandatory rule failures (these are escalation triggers)
            if (rule.isMandatory && (!ra.status || ra.status.toLowerCase() !== 'pass')) {
                mandatoryFailed = true;
                escalationTriggers.push(rule.name);
            }
        });

        const score = totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : 0;
        const minPassScore = process.env.MIN_PASS_SCORE ? parseInt(process.env.MIN_PASS_SCORE) : 70;

        // 4. Use AI's calculated priority score and tier (from new scoring parameters)
        // Get scoring breakdown from AI analysis
        const scoringBreakdown = analysisResult.scoringBreakdown || null;
        let priorityScore = analysisResult.priorityScore || (score / 20); // Fallback to simple conversion
        let tier = analysisResult.calculatedTier;

        // Validate and default tier if not provided
        if (!tier || tier < 1 || tier > 3) {
            if (priorityScore >= 3.6) {
                tier = 3;
            } else if (priorityScore >= 2.6) {
                tier = 2;
            } else {
                tier = 1;
            }
        }

        // Escalation triggers automatically push to Tier 3
        if (escalationTriggers.length > 0) {
            tier = 3;
            priorityScore = Math.max(priorityScore, 3.6);
        }

        // 5. Determine AI decision and workflow routing
        const aiApproved = !mandatoryFailed && score >= minPassScore;

        let approvalStatus;
        let workflowStage;
        let simpleStatus;

        if (aiApproved) {
            if (tier === 1) {
                // Tier 1 + AI Approved = Final Approved
                approvalStatus = 'AI Approved';
                workflowStage = 'Complete';
                simpleStatus = 'Approved';
            } else {
                // Tier 2/3 + AI Approved = Still needs human review
                approvalStatus = 'Pending Governance';
                workflowStage = 'Governance Committee';
                simpleStatus = 'Under Review';
            }
        } else {
            if (tier === 1) {
                // Tier 1 + AI Rejected = Final Rejected
                approvalStatus = 'AI Rejected';
                workflowStage = 'Complete';
                simpleStatus = 'Rejected';
            } else {
                // Tier 2/3 + AI Rejected = Escalate to Governance
                approvalStatus = 'Pending Governance';
                workflowStage = 'Governance Committee';
                simpleStatus = 'Under Review';
            }
        }

        // 6. Create project with tiered workflow data
        const project = new Project({
            name,
            description,
            repoUrl,
            analysisResult,
            approvalStatus,
            status: simpleStatus,
            score,
            requester: req.user ? req.user.id : null,
            department: department,
            formData: formData || null,
            submittedAt: new Date(),
            tier,
            priorityScore,
            scoringBreakdown,
            escalationTriggers,
            workflowStage,
            approvalHistory: [{
                stage: 'AI',
                action: aiApproved ? 'Approved' : (tier > 1 ? 'Escalated' : 'Rejected'),
                by: null, // AI decision
                reason: aiApproved
                    ? `AI approved with score ${score}/100 (Priority: ${priorityScore.toFixed(2)}, Tier ${tier})`
                    : `AI ${tier > 1 ? 'escalated to Governance' : 'rejected'} - Score: ${score}/100, Priority: ${priorityScore.toFixed(2)}, Tier ${tier}${escalationTriggers.length > 0 ? '. Triggers: ' + escalationTriggers.join(', ') : ''}`,
                score,
                timestamp: new Date()
            }]
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
                .filter(p => {
                    const roles = p.roles || (p.role ? [p.role] : []);
                    return roles.some(r => ['GovernanceApprover', 'ExecutiveApprover'].includes(r));
                })
                .map(p => (p.department._id || p.department).toString());

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
            // Stats for Approvers (Governance or Executive)
            const approverDepts = (req.user.permissions || [])
                .filter(p => {
                    const roles = p.roles || (p.role ? [p.role] : []);
                    return roles.some(r => ['GovernanceApprover', 'ExecutiveApprover'].includes(r));
                })
                .map(p => (p.department._id || p.department).toString());

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

// Helper function to check role hierarchy
const hasMinimumRole = (user, minRole, departmentId) => {
    if (user.isAdmin) return true;

    const roleHierarchy = {
        'Requester': 1,
        'GovernanceApprover': 2,
        'ExecutiveApprover': 3
    };

    const minLevel = roleHierarchy[minRole] || 0;

    return user.permissions?.some(p => {
        const deptMatch = !departmentId ||
            (p.department._id || p.department).toString() === departmentId.toString();

        // Support both old format (p.role) and new format (p.roles array)
        const userRoles = p.roles || (p.role ? [p.role] : []);
        const maxRoleLevel = Math.max(...userRoles.map(r => roleHierarchy[r] || 0));

        return deptMatch && maxRoleLevel >= minLevel;
    });
};

// Governance Committee Review
exports.governanceReview = async (req, res) => {
    try {
        const { projectId, action, reason } = req.body;

        if (!['Approved', 'Rejected'].includes(action)) {
            return res.status(400).json({ error: 'Action must be Approved or Rejected' });
        }

        const project = await Project.findById(projectId);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Check if project is pending governance review
        if (project.approvalStatus !== 'Pending Governance') {
            return res.status(400).json({ error: `Project is not pending governance review (Current: ${project.approvalStatus})` });
        }

        // Check user has governance approver role
        if (!hasMinimumRole(req.user, 'GovernanceApprover', project.department)) {
            return res.status(403).json({ error: 'You do not have permission to perform governance review' });
        }

        // Add to approval history
        project.approvalHistory.push({
            stage: 'Governance',
            action: action === 'Approved' ? 'Approved' : (project.tier === 3 ? 'Escalated' : 'Rejected'),
            by: req.user.id,
            reason: reason || `Governance ${action.toLowerCase()}`,
            timestamp: new Date()
        });

        if (action === 'Approved') {
            if (project.tier === 2) {
                // Tier 2 + Governance Approved = Final Approved
                project.approvalStatus = 'Governance Approved';
                project.status = 'Approved';
                project.workflowStage = 'Complete';
            } else if (project.tier === 3) {
                // Tier 3 + Governance Approved = Send to Executive
                project.approvalStatus = 'Pending Executive';
                project.workflowStage = 'Executive Approval';
            }
        } else {
            if (project.tier === 3) {
                // Tier 3 Governance Rejected = Can still escalate to Executive
                project.approvalStatus = 'Pending Executive';
                project.workflowStage = 'Executive Approval';
                // Update history to show escalation
                project.approvalHistory[project.approvalHistory.length - 1].action = 'Escalated';
            } else {
                // Tier 2 Governance Rejected = Final Rejected
                project.approvalStatus = 'Governance Rejected';
                project.status = 'Rejected';
                project.workflowStage = 'Complete';
            }
        }

        await project.save();

        // Record audit
        const Audit = require('../models/Audit');
        await Audit.create({
            project: project._id,
            action: 'governance_review',
            performedBy: req.user.id,
            previousStatus: 'Pending Governance',
            newStatus: project.approvalStatus,
            reason,
        });

        res.json(project);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Executive Review
exports.executiveReview = async (req, res) => {
    try {
        const { projectId, action, reason } = req.body;

        if (!['Approved', 'Rejected'].includes(action)) {
            return res.status(400).json({ error: 'Action must be Approved or Rejected' });
        }

        const project = await Project.findById(projectId);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Check if project is pending executive review
        if (project.approvalStatus !== 'Pending Executive') {
            return res.status(400).json({ error: 'Project is not pending executive review' });
        }

        // Check user has executive approver role
        if (!hasMinimumRole(req.user, 'ExecutiveApprover', project.department)) {
            return res.status(403).json({ error: 'You do not have permission to perform executive review' });
        }

        // Add to approval history
        project.approvalHistory.push({
            stage: 'Executive',
            action,
            by: req.user.id,
            reason: reason || `Executive ${action.toLowerCase()}`,
            timestamp: new Date()
        });

        if (action === 'Approved') {
            project.approvalStatus = 'Executive Approved';
            project.status = 'Approved';
        } else {
            project.approvalStatus = 'Executive Rejected';
            project.status = 'Rejected';
        }
        project.workflowStage = 'Complete';

        await project.save();

        // Record audit
        const Audit = require('../models/Audit');
        await Audit.create({
            project: project._id,
            action: 'executive_review',
            performedBy: req.user.id,
            previousStatus: 'Pending Executive',
            newStatus: project.approvalStatus,
            reason,
        });

        res.json(project);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get projects pending review for specific role
exports.getPendingReviews = async (req, res) => {
    try {
        const { stage } = req.query; // 'governance' or 'executive'

        let query = {};

        if (stage === 'governance') {
            query.approvalStatus = 'Pending Governance';
        } else if (stage === 'executive') {
            query.approvalStatus = 'Pending Executive';
        } else {
            query.approvalStatus = { $in: ['Pending Governance', 'Pending Executive'] };
        }

        // Filter by department if not admin
        if (!req.user.isAdmin) {
            const userDepts = req.user.permissions
                ?.filter(p => {
                    const roles = p.roles || (p.role ? [p.role] : []);
                    return roles.some(r => ['GovernanceApprover', 'ExecutiveApprover'].includes(r));
                })
                .map(p => (p.department._id || p.department).toString());

            if (userDepts?.length > 0) {
                query.department = { $in: userDepts };
            } else {
                return res.json([]); // No reviewer permissions
            }
        }

        const projects = await Project.find(query)
            .populate('requester', 'username')
            .populate('department', 'name')
            .sort({ createdAt: -1 });

        res.json(projects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
