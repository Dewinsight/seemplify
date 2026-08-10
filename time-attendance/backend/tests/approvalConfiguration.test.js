const {
    inferredApprovalMode,
    normalizeApprovalSettings,
    buildApprovalWorkflow,
} = require('../services/approvalConfigurationService');

test('single approval is the default and always resolves to one line-manager decision', () => {
    const normalized = normalizeApprovalSettings({
        approvalLevels: [
            { name: 'Manager', approverType: 'line_manager' },
            { name: 'HR', approverType: 'hr' },
        ],
        approvalMode: 'single',
    });
    expect(normalized.approvalMode).toBe('single');
    expect(normalized.approvalLevels).toEqual([{ name: 'Line manager', approverType: 'line_manager' }]);

    const result = buildApprovalWorkflow(normalized, {
        managerId: 'manager-1',
        managerName: 'Morgan Manager',
        managerEmail: 'manager@example.test',
        teamId: 'team-1',
    });
    expect(result.workflow).toMatchObject({ mode: 'single', currentLevel: 0 });
    expect(result.workflow.levels).toHaveLength(1);
    expect(result.assignedApprover).toMatchObject({ userId: 'manager-1', userName: 'Morgan Manager', teamId: 'team-1' });
});

test('multi-stage approval remains opt-in and preserves the configured order', () => {
    const normalized = normalizeApprovalSettings({
        approvalMode: 'multi',
        approvalLevels: [
            { name: 'Line manager', approverType: 'line_manager' },
            { name: 'Department review', approverType: 'department_head' },
            { name: 'HR review', approverType: 'hr' },
        ],
    });
    expect(normalized.approvalLevels.map(level => level.approverType)).toEqual(['line_manager', 'department_head', 'hr']);
    expect(buildApprovalWorkflow(normalized, { managerId: 'manager-1' }).workflow.levels).toHaveLength(3);
});

test('legacy organizations with several configured levels retain multi-stage behavior', () => {
    const legacy = { approvalLevels: [{ name: 'Manager', approverType: 'line_manager' }, { name: 'HR', approverType: 'hr' }] };
    expect(inferredApprovalMode(legacy)).toBe('multi');
    expect(normalizeApprovalSettings(legacy).approvalLevels).toHaveLength(2);
});

test('enabling multi-stage approval creates a safe two-stage default when stages are missing', () => {
    const normalized = normalizeApprovalSettings({ approvalMode: 'multi', approvalLevels: [] });
    expect(normalized.approvalLevels).toEqual([
        { name: 'Line manager', approverType: 'line_manager' },
        { name: 'HR Manager / Attendance Admin', approverType: 'hr' },
    ]);
});
