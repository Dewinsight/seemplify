const APPROVAL_MODES = Object.freeze({
    SINGLE: 'single',
    MULTI: 'multi',
});

const APPROVER_TYPES = new Set(['line_manager', 'department_head', 'hr', 'explicit']);
const DEFAULT_SINGLE_LEVEL = Object.freeze({ name: 'Line manager', approverType: 'line_manager' });
const DEFAULT_MULTI_LEVELS = Object.freeze([
    DEFAULT_SINGLE_LEVEL,
    Object.freeze({ name: 'HR Manager / Attendance Admin', approverType: 'hr' }),
]);

function cloneLevel(level) {
    return {
        name: level.name,
        approverType: level.approverType,
        ...(level.approverId ? { approverId: level.approverId } : {}),
        ...(level.approverName ? { approverName: level.approverName } : {}),
        ...(level.approverEmail ? { approverEmail: level.approverEmail } : {}),
    };
}

function inferredApprovalMode(settings = {}) {
    if (settings.approvalMode === APPROVAL_MODES.MULTI) return APPROVAL_MODES.MULTI;
    if (settings.approvalMode === APPROVAL_MODES.SINGLE) return APPROVAL_MODES.SINGLE;
    return Array.isArray(settings.approvalLevels) && settings.approvalLevels.length > 1
        ? APPROVAL_MODES.MULTI
        : APPROVAL_MODES.SINGLE;
}

function normalizeLevel(level = {}, index = 0) {
    const approverType = APPROVER_TYPES.has(level.approverType) ? level.approverType : 'line_manager';
    const defaultName = approverType === 'line_manager'
        ? 'Line manager'
        : approverType === 'department_head'
            ? 'Department head'
            : approverType === 'hr' ? 'HR Manager / Attendance Admin' : `Named approver ${index + 1}`;
    return {
        name: String(level.name || defaultName).trim().slice(0, 120) || defaultName,
        approverType,
        ...(level.approverId ? { approverId: String(level.approverId).slice(0, 200) } : {}),
        ...(level.approverName ? { approverName: String(level.approverName).slice(0, 200) } : {}),
        ...(level.approverEmail ? { approverEmail: String(level.approverEmail).slice(0, 320) } : {}),
    };
}

function normalizeApprovalSettings(settings = {}) {
    const approvalMode = inferredApprovalMode(settings);
    if (approvalMode === APPROVAL_MODES.SINGLE) {
        return {
            ...settings,
            approvalMode,
            approvalLevels: [cloneLevel(DEFAULT_SINGLE_LEVEL)],
        };
    }

    const configured = Array.isArray(settings.approvalLevels)
        ? settings.approvalLevels.slice(0, 10).map(normalizeLevel)
        : [];
    return {
        ...settings,
        approvalMode,
        approvalLevels: configured.length >= 2
            ? configured
            : DEFAULT_MULTI_LEVELS.map(cloneLevel),
    };
}

function approvalAssignment(level, context = {}) {
    if (level.approverType === 'line_manager') {
        return {
            approverId: context.managerId,
            approverName: context.managerName,
            approverEmail: context.managerEmail,
        };
    }
    return {
        approverId: level.approverId,
        approverName: level.approverName,
        approverEmail: level.approverEmail,
    };
}

function buildApprovalWorkflow(settings = {}, context = {}) {
    const normalized = normalizeApprovalSettings(settings);
    const levels = normalized.approvalLevels.map((level, order) => {
        const assignment = approvalAssignment(level, context);
        return {
            order,
            name: level.name || `Approval stage ${order + 1}`,
            approverType: level.approverType,
            ...assignment,
            status: 'pending',
        };
    });
    const first = levels[0];
    return {
        workflow: {
            mode: normalized.approvalMode,
            currentLevel: 0,
            levels,
        },
        assignedApprover: {
            userId: first.approverId,
            userName: first.approverName || first.name,
            userEmail: first.approverEmail,
            ...(context.teamId ? { teamId: context.teamId } : {}),
            assignedAt: new Date(),
        },
    };
}

module.exports = {
    APPROVAL_MODES,
    DEFAULT_SINGLE_LEVEL,
    DEFAULT_MULTI_LEVELS,
    inferredApprovalMode,
    normalizeApprovalSettings,
    buildApprovalWorkflow,
};
