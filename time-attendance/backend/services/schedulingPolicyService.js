const { normalizeApprovalSettings } = require('./approvalConfigurationService');

const REQUEST_TYPES = Object.freeze(['cover', 'release', 'swap']);

function defaultRequestPolicy() {
    return {
        approvalRequired: true,
        approvalMode: 'single',
        approvalLevels: [{ name: 'Line manager', approverType: 'line_manager' }],
    };
}

function defaultSchedulingSettings() {
    return {
        usePublishedShiftsAsAttendanceSchedule: true,
        enforceAvailability: true,
        requireAvailabilityRecord: false,
        enforceMinimumRest: true,
        enforceMaximumWeeklyHours: true,
        allowConflictOverride: false,
        allowEmployeeRelease: true,
        allowShiftSwap: true,
        requestPolicies: {
            cover: defaultRequestPolicy(),
            release: defaultRequestPolicy(),
            swap: defaultRequestPolicy(),
        },
    };
}

function normalizeRequestPolicy(input = {}) {
    const approvalRequired = input.approvalRequired !== false;
    const normalized = normalizeApprovalSettings(input);
    return {
        ...normalized,
        approvalRequired,
    };
}

function normalizeSchedulingSettings(input = {}) {
    const defaults = defaultSchedulingSettings();
    const requestPolicies = input.requestPolicies || {};
    return {
        ...defaults,
        ...input,
        requestPolicies: Object.fromEntries(REQUEST_TYPES.map(type => [
            type,
            normalizeRequestPolicy(requestPolicies[type] || defaults.requestPolicies[type]),
        ])),
    };
}

function requestPolicy(policy, type) {
    if (!REQUEST_TYPES.includes(type)) return null;
    return normalizeSchedulingSettings(policy?.schedulingSettings).requestPolicies[type];
}

module.exports = {
    REQUEST_TYPES,
    defaultRequestPolicy,
    defaultSchedulingSettings,
    normalizeRequestPolicy,
    normalizeSchedulingSettings,
    requestPolicy,
};
