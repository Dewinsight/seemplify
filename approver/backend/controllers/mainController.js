const Rule = require('../models/Rule');
const Project = require('../models/Project');
const Organization = require('../models/Organization');
const openAIService = require('../services/OpenAIService');

exports.createRule = async (req, res) => {
    try {
        const { department, ...rest } = req.body;
        // User-created rules are never system rules
        const rule = new Rule({
            ...rest,
            department: department || null,
            organization: req.organization,
            isSystem: false,
            isHidden: false
        });
        await rule.save();
        res.status(201).json(rule);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getRules = async (req, res) => {
    try {
        const { department, includeHidden } = req.query;
        let query = { organization: req.organization };

        if (department) {
            query = {
                organization: req.organization,
                $or: [{ department: department }, { department: null }]
            };
        } else if (!req.user.isAdmin) {
            query.department = null;
        }

        // By default exclude hidden rules unless admin requests includeHidden=1
        if (includeHidden !== '1' && includeHidden !== 'true') {
            query.isHidden = { $ne: true };
        }

        const rules = await Rule.find(query).populate('department', 'name');
        res.json(rules);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getDepartments = async (req, res) => {
    try {
        const Department = require('../models/Department');
        let query = {};

        // If authenticated user, scope to their org
        if (req.user && req.organization) {
            query.organization = req.organization;
        } else if (req.query.organization) {
            // Public route (registration) - filter by requested org
            query.organization = req.query.organization;
        }

        const departments = await Department.find(query, 'name description manager organization').populate('manager', 'username firstName lastName');
        res.json(departments);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.createDepartment = async (req, res) => {
    try {
        const { name, description } = req.body;
        const Department = require('../models/Department');
        const dept = new Department({ name, description, organization: req.organization });
        await dept.save();
        res.status(201).json(dept);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.deleteDepartment = async (req, res) => {
    try {
        const Department = require('../models/Department');
        // Verify department belongs to user's org before deleting
        const dept = await Department.findOne({ _id: req.params.id, organization: req.organization });
        if (!dept) {
            return res.status(404).json({ error: 'Department not found in your organization' });
        }
        await Department.findByIdAndDelete(req.params.id);
        res.json({ message: 'Department deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.analyzeProject = async (req, res) => {
    try {
        const { name, description, repoUrl, formData } = req.body;

        // No form-level rejection — Group Head and HEART are evaluated as AI rules.
        // If rules 2 & 3 are active and mandatory, AI will reject when they fail.

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
                const general = await require('../models/Department').findOne({ name: 'General', organization: req.organization });
                department = general?._id;
            }
        }

        // 1. Fetch active rules for this scope (Dept + Global) within org
        const rules = await Rule.find({
            isActive: true,
            organization: req.organization,
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

        // Build lookup maps: exact name and normalized name for fuzzy matching
        const ruleMapExact = {};
        const ruleMapNorm = {};
        const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

        rules.forEach(r => {
            ruleMapExact[r.name] = r;
            ruleMapNorm[normalize(r.name)] = r;
            totalWeight += r.weight || 1;
        });

        const findRule = (aiName) => {
            if (ruleMapExact[aiName]) return ruleMapExact[aiName];
            const norm = normalize(aiName);
            if (ruleMapNorm[norm]) return ruleMapNorm[norm];
            // Partial match: if AI name contains or is contained by a DB rule name
            for (const r of rules) {
                const rNorm = normalize(r.name);
                if (rNorm.includes(norm) || norm.includes(rNorm)) return r;
            }
            return null;
        };

        const ruleAnalyses = analysisResult.rulesAnalysis || [];
        const matchedRuleIds = new Set();

        ruleAnalyses.forEach(ra => {
            const rule = findRule(ra.ruleName);
            if (!rule) return;
            const ruleId = rule._id?.toString() || rule.name;
            if (matchedRuleIds.has(ruleId)) return; // avoid double-counting
            matchedRuleIds.add(ruleId);
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

        // 4. Priority Score: always compute from breakdown when available (source of truth per rubric)
        const scoringBreakdown = analysisResult.scoringBreakdown || null;
        let priorityScore;

        if (scoringBreakdown) {
            const s = scoringBreakdown.strategicAlignment?.score ?? 0;
            const r = scoringBreakdown.regulatoryRisk?.score ?? 0;
            const b = scoringBreakdown.businessImpact?.score ?? 0;
            const c = scoringBreakdown.implementationComplexity?.score ?? 0;
            const t = scoringBreakdown.timeToValue?.score ?? 0;
            const res = scoringBreakdown.resourceRequirements?.score ?? 0;
            priorityScore = Math.round(((s * 0.25) + (r * 0.25) + (b * 0.20) + (c * 0.15) + (t * 0.10) + (res * 0.05)) * 100) / 100;
        } else {
            priorityScore = typeof analysisResult.priorityScore === 'number' && !isNaN(analysisResult.priorityScore)
                ? analysisResult.priorityScore
                : score / 20;
        }

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

        // 5. Process flow: Priority Score thresholds (rule 4 — not LLM rule)
        const rejectBelow = parseFloat(process.env.PRIORITY_SCORE_REJECT_BELOW || '1.5');
        const enhancedOversightMax = parseFloat(process.env.PRIORITY_SCORE_ENHANCED_OVERSIGHT_MAX || '2.0');
        const needEnhancedOversight = priorityScore >= rejectBelow && priorityScore < enhancedOversightMax;

        // AI decision: reject if below threshold OR mandatory rules failed
        const aiApproved = !mandatoryFailed && priorityScore >= rejectBelow;

        let approvalStatus;
        let workflowStage;
        let simpleStatus;

        if (!aiApproved) {
            approvalStatus = 'AI Rejected';
            workflowStage = 'Screening';
            simpleStatus = 'Rejected';
        } else {
            approvalStatus = 'Pending Center of Excellence';
            workflowStage = 'Center of Excellence Review';
            simpleStatus = needEnhancedOversight ? 'Under Review (Enhanced Oversight)' : 'Under Review';
        }

        // 6. Create project with tiered workflow data
        const project = new Project({
            name,
            description,
            repoUrl,
            organization: req.organization,
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
            needEnhancedOversight: needEnhancedOversight || false,
            workflowStage,
            approvalHistory: [{
                stage: 'AI',
                action: aiApproved ? (needEnhancedOversight ? 'Escalated' : 'Approved') : 'Rejected',
                by: null, // AI decision
                reason: aiApproved
                    ? needEnhancedOversight
                        ? `AI approved with enhanced oversight - Priority Score ${priorityScore.toFixed(2)} (1.5–2.0 range). Score: ${score}/100, Tier ${tier}`
                        : `AI approved with score ${score}/100 (Priority: ${priorityScore.toFixed(2)}, Tier ${tier})`
                    : `AI rejected - Priority Score ${priorityScore.toFixed(2)} below ${rejectBelow}${mandatoryFailed ? '. Mandatory rules failed: ' + escalationTriggers.join(', ') : ''}. Score: ${score}/100, Tier ${tier}`,
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
        let query = { organization: req.organization };

        // Admin sees all within org
        if (req.user.isAdmin) {
            // Just org filter
        } else {
            const approverDeptIds = (req.user.permissions || [])
                .filter(p => {
                    const roles = p.roles || (p.role ? [p.role] : []);
                    return roles.some(r => ['GovernanceApprover', 'ExecutiveApprover', 'CenterOfExcellence'].includes(r));
                })
                .map(p => (p.department._id || p.department).toString());

            query = {
                organization: req.organization,
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
            .populate('requester', 'username firstName lastName department')
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
        const project = await Project.findOne({ _id: projectId, organization: req.organization });
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
            organization: req.organization,
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
        const project = await Project.findOne({ _id: projectId, organization: req.organization })
            .populate('requester', 'username firstName lastName department')
            .populate('department', 'name')
            .populate('approvalHistory.by', 'username firstName lastName');
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
        let query = { organization: req.organization };
        if (!req.user.isAdmin) {
            const approverDepts = (req.user.permissions || [])
                .filter(p => {
                    const roles = p.roles || (p.role ? [p.role] : []);
                    return roles.some(r => ['GovernanceApprover', 'ExecutiveApprover', 'CenterOfExcellence'].includes(r));
                })
                .map(p => (p.department._id || p.department).toString());

            query = {
                organization: req.organization,
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

// Bulk update system rules (turn off/on all, or hide/unhide all)
exports.bulkUpdateSystemRules = async (req, res) => {
    try {
        const { isActive, isHidden } = req.body;
        const update = {};
        if (typeof isActive === 'boolean') update.isActive = isActive;
        if (typeof isHidden === 'boolean') update.isHidden = isHidden;
        if (Object.keys(update).length === 0) {
            return res.status(400).json({ error: 'Provide isActive and/or isHidden' });
        }
        const result = await Rule.updateMany(
            { organization: req.organization, isSystem: true },
            { $set: update }
        );
        res.json({ modifiedCount: result.modifiedCount, message: 'System rules updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Update rule (isActive, isHidden only — used for system rules)
exports.updateRule = async (req, res) => {
    try {
        const rule = await Rule.findOne({ _id: req.params.id, organization: req.organization });
        if (!rule) {
            return res.status(404).json({ error: 'Rule not found in your organization' });
        }
        const { isActive, isHidden } = req.body;
        if (typeof isActive === 'boolean') rule.isActive = isActive;
        if (typeof isHidden === 'boolean') rule.isHidden = isHidden;
        await rule.save();
        res.json(rule);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Delete a rule (system rules cannot be deleted)
exports.deleteRule = async (req, res) => {
    try {
        const rule = await Rule.findOne({ _id: req.params.id, organization: req.organization });
        if (!rule) {
            return res.status(404).json({ error: 'Rule not found in your organization' });
        }
        if (rule.isSystem) {
            return res.status(403).json({ error: 'System rules cannot be deleted. You can turn them off or hide them.' });
        }
        await Rule.findByIdAndDelete(req.params.id);
        res.json({ message: 'Rule deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Delete a project
exports.deleteProject = async (req, res) => {
    try {
        const project = await Project.findOne({ _id: req.params.id, organization: req.organization });
        if (!project) {
            return res.status(404).json({ error: 'Project not found in your organization' });
        }
        await Project.findByIdAndDelete(req.params.id);
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
        'CenterOfExcellence': 2,
        'GovernanceApprover': 3,
        'ExecutiveApprover': 4
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

// Center of Excellence Review
exports.centerOfExcellenceReview = async (req, res) => {
    try {
        const { projectId, action, reason } = req.body;

        if (!['Approved', 'Rejected'].includes(action)) {
            return res.status(400).json({ error: 'Action must be Approved or Rejected' });
        }

        const project = await Project.findOne({ _id: projectId, organization: req.organization });
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        if (project.approvalStatus !== 'Pending Center of Excellence') {
            return res.status(400).json({ error: `Project is not pending Center of Excellence review (Current: ${project.approvalStatus})` });
        }

        if (!hasMinimumRole(req.user, 'CenterOfExcellence', project.department)) {
            return res.status(403).json({ error: 'You do not have permission to perform Center of Excellence review' });
        }

        project.approvalHistory.push({
            stage: 'CenterOfExcellence',
            action,
            by: req.user.id,
            reason: reason || `Center of Excellence ${action.toLowerCase()}`,
            timestamp: new Date()
        });

        if (action === 'Approved') {
            project.approvalStatus = 'Center of Excellence Approved';

            if (project.tier === 1) {
                project.approvalStatus = 'Approved';
                project.status = 'Approved';
                project.workflowStage = 'Complete';
            } else {
                project.approvalStatus = 'Pending Governance';
                project.workflowStage = 'Governance Committee';
            }
        } else {
            project.approvalStatus = 'Center of Excellence Rejected';
            project.status = 'Rejected';
            project.workflowStage = 'Complete';
        }

        await project.save();

        const Audit = require('../models/Audit');
        await Audit.create({
            project: project._id,
            organization: req.organization,
            action: 'coe_review',
            performedBy: req.user.id,
            previousStatus: 'Pending Center of Excellence',
            newStatus: project.approvalStatus,
            reason,
        });

        res.json(project);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Governance Committee Review
exports.governanceReview = async (req, res) => {
    try {
        const { projectId, action, reason } = req.body;

        if (!['Approved', 'Rejected'].includes(action)) {
            return res.status(400).json({ error: 'Action must be Approved or Rejected' });
        }

        const project = await Project.findOne({ _id: projectId, organization: req.organization });
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
                project.approvalStatus = 'Governance Approved';
                project.status = 'Approved';
                project.workflowStage = 'Complete';
            } else if (project.tier === 3) {
                project.approvalStatus = 'Pending Executive';
                project.workflowStage = 'Executive Approval';
            }
        } else {
            if (project.tier === 3) {
                project.approvalStatus = 'Pending Executive';
                project.workflowStage = 'Executive Approval';
                project.approvalHistory[project.approvalHistory.length - 1].action = 'Escalated';
            } else {
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
            organization: req.organization,
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

        const project = await Project.findOne({ _id: projectId, organization: req.organization });
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
            organization: req.organization,
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
        const { stage } = req.query;

        let query = { organization: req.organization };

        if (stage === 'governance') {
            query.approvalStatus = 'Pending Governance';
        } else if (stage === 'executive') {
            query.approvalStatus = 'Pending Executive';
        } else if (stage === 'center_of_excellence') {
            query.approvalStatus = 'Pending Center of Excellence';
        } else {
            query.approvalStatus = { $in: ['Pending Governance', 'Pending Executive', 'Pending Center of Excellence'] };
        }

        // Filter by department if not admin
        if (!req.user.isAdmin) {
            const userDepts = req.user.permissions
                ?.filter(p => {
                    const roles = p.roles || (p.role ? [p.role] : []);
                    return roles.some(r => ['GovernanceApprover', 'ExecutiveApprover', 'CenterOfExcellence'].includes(r));
                })
                .map(p => (p.department._id || p.department).toString());

            if (userDepts?.length > 0) {
                query.department = { $in: userDepts };
            } else {
                return res.json([]); // No reviewer permissions
            }
        }

        const projects = await Project.find(query)
            .populate('requester', 'username firstName lastName')
            .populate('department', 'name')
            .sort({ createdAt: -1 });

        res.json(projects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Organization Management ---
exports.getOrganizations = async (req, res) => {
    try {
        const orgs = await Organization.find({}, 'name slug description');
        res.json(orgs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.createOrganization = async (req, res) => {
    try {
        const { name, description } = req.body;
        const org = new Organization({
            name,
            description,
            createdBy: req.user.id
        });
        await org.save();
        res.status(201).json(org);
    } catch (error) {
        // Duplicate key (e.g. unique org name/slug)
        if (error && error.code === 11000) {
            const dupField = error.keyPattern ? Object.keys(error.keyPattern)[0] : null;
            const message =
                dupField === 'name'
                    ? 'An organization with that name already exists.'
                    : dupField === 'slug'
                        ? 'An organization with a similar name already exists.'
                        : 'Organization already exists.';
            return res.status(409).json({ error: message });
        }
        res.status(500).json({ error: error.message });
    }
};

// Same slug derivation as Organization model (for lookup on conflict)
function slugFromName(name) {
    if (!name || typeof name !== 'string') return '';
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Create org AND join it (onboarding flow — no org context needed)
exports.createAndJoin = async (req, res) => {
    const UserOrganization = require('../models/UserOrganization');
    const Department = require('../models/Department');

    try {
        const { name, description } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Organization name is required' });
        }

        const trimmedName = name.trim();

        // Create the organization (rely on MongoDB unique indexes for duplicate detection)
        const org = new Organization({
            name: trimmedName,
            description: (description || '').trim(),
            createdBy: req.user.id
        });
        await org.save();

        // Create General department
        const generalDept = await new Department({
            name: 'General',
            description: 'Default department',
            organization: org._id
        }).save();

        // Create UserOrganization — creator becomes admin with ExecutiveApprover role
        const membership = await UserOrganization.create({
            user: req.user.id,
            organization: org._id,
            isAdmin: true,
            permissions: [{ department: generalDept._id, roles: ['ExecutiveApprover'] }]
        });

        await membership.populate('organization', 'name slug');
        await membership.populate('permissions.department', 'name');

        res.status(201).json({
            organization: {
                _id: org._id,
                name: org.name,
                slug: org.slug,
                isAdmin: membership.isAdmin,
                permissions: membership.permissions
            }
        });
    } catch (error) {
        // Duplicate key (org name/slug already exists)
        if (error && error.code === 11000) {
            const trimmedName = (req.body.name || '').trim();
            const attemptedSlug = slugFromName(trimmedName);
            const existingOrg = await Organization.findOne({
                $or: [{ name: trimmedName }, { slug: attemptedSlug }]
            });
            if (existingOrg) {
                const existingMembership = await UserOrganization.findOne({
                    user: req.user.id,
                    organization: existingOrg._id
                }).populate('organization', 'name slug').populate('permissions.department', 'name');
                if (existingMembership) {
                    return res.status(200).json({
                        organization: {
                            _id: existingOrg._id,
                            name: existingOrg.name,
                            slug: existingOrg.slug,
                            isAdmin: existingMembership.isAdmin,
                            permissions: existingMembership.permissions
                        }
                    });
                }
                // Orphan recovery: org exists but has no members — createdBy matches current user (partial create failed)
                const isOrphan = existingOrg.createdBy && existingOrg.createdBy.toString() === req.user.id.toString();
                if (isOrphan) {
                    let generalDept = await Department.findOne({ name: 'General', organization: existingOrg._id });
                    if (!generalDept) {
                        generalDept = await new Department({
                            name: 'General',
                            description: 'Default department',
                            organization: existingOrg._id
                        }).save();
                    }
                    const membership = await UserOrganization.create({
                        user: req.user.id,
                        organization: existingOrg._id,
                        isAdmin: true,
                        permissions: [{ department: generalDept._id, roles: ['ExecutiveApprover'] }]
                    });
                    await membership.populate('organization', 'name slug');
                    await membership.populate('permissions.department', 'name');
                    return res.status(200).json({
                        organization: {
                            _id: existingOrg._id,
                            name: existingOrg.name,
                            slug: existingOrg.slug,
                            isAdmin: membership.isAdmin,
                            permissions: membership.permissions
                        }
                    });
                }
            }
            const dupField = error.keyPattern ? Object.keys(error.keyPattern)[0] : null;
            const message =
                dupField === 'name'
                    ? 'An organization with that name already exists.'
                    : dupField === 'slug'
                        ? 'An organization with a similar name already exists.'
                        : 'Organization already exists.';
            return res.status(409).json({
                error: message,
                hint: 'Try a different name (e.g. add "2" or your company name), or ask an admin of that organization to invite you.'
            });
        }
        res.status(500).json({ error: error.message });
    }
};

// Get all orgs the current user belongs to
exports.getMyOrganizations = async (req, res) => {
    try {
        const UserOrganization = require('../models/UserOrganization');

        const memberships = await UserOrganization.find({ user: req.user.id })
            .populate('organization', 'name slug logo logoDark logoLight logoBackground logoMode')
            .populate('permissions.department', 'name');

        const organizations = memberships.map(m => ({
            _id: m.organization._id,
            name: m.organization.name,
            slug: m.organization.slug,
            logo: m.organization.logo,
            logoDark: m.organization.logoDark,
            logoLight: m.organization.logoLight,
            logoBackground: m.organization.logoBackground,
            logoMode: m.organization.logoMode,
            isAdmin: m.isAdmin,
            permissions: m.permissions
        }));

        res.json(organizations);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
