import { getHubApps } from './hubApps.js'

export const DEFAULT_TRIAL_PLAN_NAME = 'Free Trial'
export const DEFAULT_TRIAL_PLAN_SLUG = 'free-trial'
export const LEGACY_DEFAULT_TRIAL_PLAN_SLUG = 'trial'
export const DEFAULT_TRIAL_PLAN_DAYS = 7

const DEFAULT_TRIAL_CORE_APP_NAMES = [
  'Simple Evaluation',
  'Simple LMS'
]

export const DEFAULT_TRIAL_APP_NAMES = Array.from(
  new Set([
    ...DEFAULT_TRIAL_CORE_APP_NAMES,
    ...getHubApps().map(app => app.name).filter(Boolean)
  ])
)

export function buildDefaultTrialPlanData() {
  return {
    name: DEFAULT_TRIAL_PLAN_NAME,
    slug: DEFAULT_TRIAL_PLAN_SLUG,
    description: 'One-week free trial with access to all Seemplify apps and launchable integrations.',
    pricing: {
      monthly: 0,
      yearly: 0,
      yearlyDiscount: 0,
      currency: 'NGN'
    },
    limits: {
      maxMembers: null,
      maxTeams: null,
      maxStorage: null,
      maxSystemCourses: null
    },
    hideHubCards: [],
    showComingSoonCards: [],
    features: {
      recruiter: true,
      leaveManagement: true,
      payrollManagement: true,
      performanceManagement: true,
      timeAttendance: true,
      outlineDocs: true,
      aiChat: true,
      lms: true
    },
    isActive: true,
    isPublic: false,
    isRequestable: false,
    isFeatured: false,
    isTrial: true,
    trialDays: DEFAULT_TRIAL_PLAN_DAYS,
    displayOrder: 0,
    badgeText: 'Default Trial',
    color: '#22c55e'
  }
}
