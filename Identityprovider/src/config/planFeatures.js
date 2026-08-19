export const PLAN_FEATURES = Object.freeze([
  { key: 'recruiter', label: 'Recruiter (SmartHR)', appIds: ['smarthr', 'recruiter'] },
  { key: 'leaveManagement', label: 'Leave Management', appIds: ['leave-management'] },
  { key: 'payrollManagement', label: 'Payroll Management', appIds: ['payroll-management'] },
  { key: 'performanceManagement', label: 'Performance Management', appIds: ['performance-management'] },
  { key: 'timeAttendance', label: 'Time & Attendance', appIds: ['time-attendance'] },
  { key: 'outlineDocs', label: 'Outline Docs', appIds: ['outline'] },
  { key: 'aiChat', label: 'AI Assistant', appIds: ['openwebui'] },
  { key: 'lms', label: 'Seemplify Learning', appIds: ['lms', 'seemplify-learning'] },
  { key: 'workspace', label: 'Workspace', appIds: ['messaging'] },
  { key: 'experienceManagement', label: 'Experience Management', appIds: ['experience-management'] },
  { key: 'approver', label: 'Approver', appIds: ['approver'] }
])

export const PLAN_FEATURE_KEYS = Object.freeze(PLAN_FEATURES.map(feature => feature.key))

const APP_FEATURE_KEYS = new Map(
  PLAN_FEATURES.flatMap(feature => feature.appIds.map(appId => [appId, feature.key]))
)

export function getPlanFeatureKeyForApp(appId) {
  return APP_FEATURE_KEYS.get(String(appId || '').trim())
}

export function createEmptyPlanFeatures() {
  return Object.fromEntries(PLAN_FEATURE_KEYS.map(key => [key, false]))
}
