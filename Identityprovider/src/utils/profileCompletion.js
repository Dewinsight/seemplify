import { OnboardingAssignment } from '../models/OnboardingAssignment.js'
import { normalizeOnboardingStatus } from './onboardingStatus.js'
import { isRedirectMode } from '../middleware/onboardingMode.js'

const PROFILE_COMPLETION_STEPS = [
  {
    key: 'personal',
    label: 'Personal Info',
    route: '/profile/personal',
    description: 'Add your date of birth, address, phone number, and emergency contact.'
  },
  {
    key: 'banking',
    label: 'Banking',
    route: '/profile/banking',
    description: 'Add the payment account payroll should use for you.'
  },
  {
    key: 'dependents',
    label: 'Dependents',
    route: '/profile/dependents',
    description: 'Add your dependents or confirm that you do not have any to add.'
  }
]

const ONBOARDING_PROFILE_COMPLETION_STEP = {
  key: 'documents',
  label: 'Onboarding',
  route: '/profile/documents',
  description: 'Complete the onboarding documents and tasks assigned to you in Document Workspace.'
}

const PROFILE_COMPLETION_STEP_MAP = new Map(
  [...PROFILE_COMPLETION_STEPS, ONBOARDING_PROFILE_COMPLETION_STEP].map(step => [step.key, step])
)

const ONBOARDING_ACTIONABLE_STATUSES = new Set(['pending', 'in_progress', 'not_started'])

function hasText(value) {
  return String(value || '').trim().length > 0
}

function normalizeDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function getProfile(account = {}) {
  return account?.profile || {}
}

function getPersonalInfo(profile = {}) {
  return profile?.personalInfo || {}
}

function getMailingAddress(profile = {}) {
  return getPersonalInfo(profile)?.mailingAddress || {}
}

function getPhoneNumbers(profile = {}) {
  return getPersonalInfo(profile)?.phoneNumbers || {}
}

function getEmergencyContacts(profile = {}) {
  return Array.isArray(getPersonalInfo(profile)?.emergencyContacts)
    ? getPersonalInfo(profile).emergencyContacts
    : []
}

function getValidDependents(profile = {}) {
  return (Array.isArray(profile?.dependents) ? profile.dependents : []).filter(dependent => {
    return hasText(dependent?.name) && hasText(dependent?.relationship)
  })
}

function getDependentsDeclaration(profile = {}) {
  const status = String(profile?.dependentsDeclaration?.status || '').trim().toLowerCase()
  if (status === 'none' || status === 'provided') {
    return {
      status,
      confirmedAt: normalizeDate(profile?.dependentsDeclaration?.confirmedAt),
      lastUpdated: normalizeDate(profile?.dependentsDeclaration?.lastUpdated)
    }
  }

  return {
    status: 'pending',
    confirmedAt: null,
    lastUpdated: null
  }
}

function getActiveBankAccounts(profile = {}) {
  const banking = profile?.banking || {}
  const accounts = Array.isArray(banking.accounts) ? banking.accounts : []

  return accounts.filter(account => {
    if (!account || account.isActive === false) return false
    return hasText(account.bankName) || hasText(account.accountNumber) || hasText(account.iban)
  })
}

function getPrimaryBankAccount(profile = {}) {
  const accounts = getActiveBankAccounts(profile)
  if (accounts.length === 0) return null
  return accounts.find(account => account?.isPrimary !== false) || accounts[0]
}

function getPrimaryEmergencyContact(profile = {}) {
  const contacts = getEmergencyContacts(profile).filter(contact => hasText(contact?.name) && hasText(contact?.phone))
  if (contacts.length === 0) return null
  return contacts.find(contact => contact?.isPrimary === true) || contacts[0]
}

function isCompleteAddress(address = {}) {
  return hasText(address?.street) && hasText(address?.city) && hasText(address?.country)
}

function hasRequiredBankFields(account = {}, fallbackCountry = '') {
  const country = String(account?.country || fallbackCountry || 'Other').trim()
  const hasBankName = hasText(account?.bankName)
  const hasAccountNumber = hasText(account?.accountNumber)

  if (!hasBankName) return false

  switch (country) {
    case 'USA':
      return hasAccountNumber && hasText(account?.routingNumber)
    case 'UK':
      return hasAccountNumber && hasText(account?.sortCode)
    case 'EU':
      return hasText(account?.iban) && hasText(account?.bicSwift)
    case 'Nigeria':
      return hasAccountNumber && hasText(account?.bankCode)
    default:
      return hasAccountNumber || hasText(account?.iban)
  }
}

function normalizeWorkflowType(value, fallback = 'onboarding') {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized || fallback
}

function resolveCurrentOrganizationId(account = {}, explicitOrganizationId = null) {
  return explicitOrganizationId
    || account?.currentOrganization?._id?.toString?.()
    || account?.currentOrganization?.toString?.()
    || null
}

function sortAssignmentsByLatest(assignments = []) {
  return [...assignments].sort((left, right) => {
    const leftTime = new Date(left?.updatedAt || left?.createdAt || 0).getTime()
    const rightTime = new Date(right?.updatedAt || right?.createdAt || 0).getTime()
    return rightTime - leftTime
  })
}

function buildOnboardingRequirement(onboardingAssignments = []) {
  const relevantAssignments = sortAssignmentsByLatest(
    (Array.isArray(onboardingAssignments) ? onboardingAssignments : []).filter((assignment) => {
      return normalizeWorkflowType(assignment?.workflowType, 'onboarding') === 'onboarding'
    })
  )

  const requiredAssignments = relevantAssignments.filter((assignment) => {
    return normalizeOnboardingStatus(assignment?.status, 'pending') !== 'cancelled'
  })

  if (requiredAssignments.length === 0) {
    return {
      required: false,
      complete: true,
      status: 'not_started',
      latestAssignment: null,
      assignmentCount: 0,
      pendingCount: 0,
      completedCount: 0
    }
  }

  const incompleteAssignments = requiredAssignments.filter((assignment) => {
    return normalizeOnboardingStatus(assignment?.status, 'pending') !== 'completed'
  })
  const latestAssignment = requiredAssignments[0] || null
  const currentStatus = incompleteAssignments.length > 0
    ? normalizeOnboardingStatus(incompleteAssignments[0]?.status, 'pending')
    : 'completed'

  return {
    required: true,
    complete: incompleteAssignments.length === 0,
    status: currentStatus,
    latestAssignment,
    assignmentCount: requiredAssignments.length,
    pendingCount: incompleteAssignments.length,
    completedCount: requiredAssignments.length - incompleteAssignments.length
  }
}

export function getProfileCompletion(account = {}, options = {}) {
  const profile = getProfile(account)
  const personalInfo = getPersonalInfo(profile)
  const mailingAddress = getMailingAddress(profile)
  const phoneNumbers = getPhoneNumbers(profile)
  const primaryEmergencyContact = getPrimaryEmergencyContact(profile)
  const activeBankAccounts = getActiveBankAccounts(profile)
  const primaryBankAccount = getPrimaryBankAccount(profile)
  const validDependents = getValidDependents(profile)
  const dependentsDeclaration = getDependentsDeclaration(profile)
  const reminder = profile?.completionReminders || {}
  const onboarding = buildOnboardingRequirement(options.onboardingAssignments)

  const personalComplete = Boolean(
    normalizeDate(personalInfo?.dateOfBirth) &&
    isCompleteAddress(mailingAddress) &&
    hasText(phoneNumbers?.mobile) &&
    primaryEmergencyContact
  )
  const bankingComplete = activeBankAccounts.some(account => hasRequiredBankFields(account, profile?.banking?.country))
  const dependentsComplete = validDependents.length > 0 || dependentsDeclaration.status === 'none'

  const completionByKey = {
    personal: personalComplete,
    banking: bankingComplete,
    dependents: dependentsComplete
  }

  const steps = PROFILE_COMPLETION_STEPS.map(step => ({
    ...step,
    complete: completionByKey[step.key] === true
  }))

  // Onboarding has moved to the recruiter app: in redirect mode keep only the
  // IdP-owned profile steps (Personal/Banking/Dependents) so percent recomputes
  // cleanly without the retired onboarding step.
  if (onboarding.required && !isRedirectMode()) {
    steps.push({
      ...ONBOARDING_PROFILE_COMPLETION_STEP,
      complete: onboarding.complete,
      description: onboarding.complete
        ? 'Your assigned onboarding documents and tasks are complete.'
        : ONBOARDING_PROFILE_COMPLETION_STEP.description
    })
  }

  const completedCount = steps.filter(step => step.complete).length
  const nextIncompleteStep = steps.find(step => !step.complete) || null

  return {
    complete: completedCount === steps.length,
    completedCount,
    totalSteps: steps.length,
    percent: Math.round((completedCount / steps.length) * 100),
    steps,
    nextIncompleteStep,
    dependentsCount: validDependents.length,
    hasDeclaredNoDependents: dependentsDeclaration.status === 'none',
    reminder: {
      lastSentAt: normalizeDate(reminder?.lastSentAt),
      sendCount: Number(reminder?.sendCount || 0),
      lastCompletedAt: normalizeDate(reminder?.lastCompletedAt),
      lastMissingSteps: Array.isArray(reminder?.lastMissingSteps) ? reminder.lastMissingSteps : []
    },
    onboarding: {
      ...onboarding,
      isAssigned: onboarding.required,
      requiresAction: onboarding.required && !onboarding.complete,
      isActionableStatus: ONBOARDING_ACTIONABLE_STATUSES.has(onboarding.status)
    },
    summary: {
      primaryEmergencyContact,
      primaryBankAccount: primaryBankAccount
        ? {
            bankName: primaryBankAccount.bankName || '',
            country: primaryBankAccount.country || profile?.banking?.country || '',
            accountType: primaryBankAccount.accountType || '',
            maskedAccountNumber: hasText(primaryBankAccount.accountNumber)
              ? `****${String(primaryBankAccount.accountNumber).slice(-4)}`
              : ''
          }
        : null,
      onboarding: onboarding.required
        ? {
            status: onboarding.status,
            assignmentCount: onboarding.assignmentCount,
            pendingCount: onboarding.pendingCount,
            completedCount: onboarding.completedCount,
            latestAssignmentCreatedAt: normalizeDate(onboarding.latestAssignment?.createdAt),
            latestAssignmentDueAt: normalizeDate(onboarding.latestAssignment?.dueAt),
            latestAssignmentCompletedAt: normalizeDate(onboarding.latestAssignment?.completedAt)
          }
        : null
    }
  }
}

export async function getProfileCompletionForAccount(account = {}, options = {}) {
  if (Array.isArray(options.onboardingAssignments)) {
    return getProfileCompletion(account, options)
  }

  const organizationId = resolveCurrentOrganizationId(account, options.organizationId)
  const accountId = options.accountId || account?._id

  if (!organizationId || !accountId) {
    return getProfileCompletion(account, options)
  }

  // Skip the retired onboarding-assignment lookup when redirecting to recruiter.
  if (isRedirectMode()) {
    return getProfileCompletion(account, { ...options, onboardingAssignments: [] })
  }

  const onboardingAssignments = await OnboardingAssignment.find({
    organization: organizationId,
    member: accountId,
    workflowType: 'onboarding',
    status: { $in: ['pending', 'in_progress', 'completed', 'cancelled'] }
  })
    .select('status workflowType dueAt completedAt createdAt updatedAt')
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean()

  return getProfileCompletion(account, {
    ...options,
    onboardingAssignments
  })
}

export function getProfileCompletionStep(stepKey) {
  return PROFILE_COMPLETION_STEP_MAP.get(stepKey) || null
}

export function buildPayrollProfileSyncData(account = {}) {
  const profile = getProfile(account)
  const personalInfo = getPersonalInfo(profile)
  const validDependents = getValidDependents(profile)
  const completion = getProfileCompletion(account)
  const primaryEmergencyContact = getPrimaryEmergencyContact(profile)

  return {
    personalInfo: {
      dateOfBirth: normalizeDate(personalInfo?.dateOfBirth),
      mailingAddress: {
        street: personalInfo?.mailingAddress?.street || '',
        street2: personalInfo?.mailingAddress?.street2 || '',
        city: personalInfo?.mailingAddress?.city || '',
        state: personalInfo?.mailingAddress?.state || '',
        zipCode: personalInfo?.mailingAddress?.zipCode || '',
        country: personalInfo?.mailingAddress?.country || ''
      },
      phoneNumbers: {
        mobile: personalInfo?.phoneNumbers?.mobile || '',
        home: personalInfo?.phoneNumbers?.home || '',
        work: personalInfo?.phoneNumbers?.work || ''
      },
      emergencyContacts: getEmergencyContacts(profile).map(contact => ({
        name: contact?.name || '',
        relationship: contact?.relationship || '',
        phone: contact?.phone || '',
        email: contact?.email || '',
        isPrimary: contact?.isPrimary === true
      }))
    },
    banking: {
      country: profile?.banking?.country || '',
      accounts: getActiveBankAccounts(profile).map(accountItem => ({
        country: accountItem?.country || profile?.banking?.country || '',
        bankName: accountItem?.bankName || '',
        accountNumber: accountItem?.accountNumber || '',
        routingNumber: accountItem?.routingNumber || '',
        sortCode: accountItem?.sortCode || '',
        iban: accountItem?.iban || '',
        bicSwift: accountItem?.bicSwift || '',
        bankCode: accountItem?.bankCode || '',
        accountType: accountItem?.accountType || '',
        accountHolderName: accountItem?.accountHolderName || '',
        percentage: Number(accountItem?.percentage || 100),
        isPrimary: accountItem?.isPrimary !== false
      }))
    },
    emergencyContact: primaryEmergencyContact
      ? {
          name: primaryEmergencyContact.name || '',
          relationship: primaryEmergencyContact.relationship || '',
          phone: primaryEmergencyContact.phone || '',
          email: primaryEmergencyContact.email || ''
        }
      : null,
    dependentsCount: validDependents.length,
    profileCompletion: completion
  }
}
