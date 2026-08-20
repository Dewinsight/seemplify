const PROFILE_COMPLETION_STEPS = [
  {
    key: 'personal',
    label: 'Personal Info',
    route: '/profile/personal',
    description: 'Add your date of birth, address, phone number, and emergency contact.'
  },
  {
    key: 'dependents',
    label: 'Dependents',
    route: '/profile/dependents',
    description: 'Add your dependents or confirm that you do not have any to add.'
  }
]

const PROFILE_COMPLETION_STEP_MAP = new Map(
  PROFILE_COMPLETION_STEPS.map(step => [step.key, step])
)

const EMPTY_ONBOARDING_COMPLETION = Object.freeze({
  required: false,
  complete: true,
  status: 'not_started',
  latestAssignment: null,
  assignmentCount: 0,
  pendingCount: 0,
  completedCount: 0
})

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
      count: Math.max(0, Number(profile?.dependentsDeclaration?.count || 0)),
      confirmedAt: normalizeDate(profile?.dependentsDeclaration?.confirmedAt),
      lastUpdated: normalizeDate(profile?.dependentsDeclaration?.lastUpdated)
    }
  }

  return {
    status: 'pending',
    count: 0,
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

function getPrimaryEmergencyContact(profile = {}) {
  const contacts = getEmergencyContacts(profile).filter(contact => hasText(contact?.name) && hasText(contact?.phone))
  if (contacts.length === 0) return null
  return contacts.find(contact => contact?.isPrimary === true) || contacts[0]
}

function isCompleteAddress(address = {}) {
  return hasText(address?.street) && hasText(address?.city) && hasText(address?.country)
}

export function getProfileCompletion(account = {}, options = {}) {
  const profile = getProfile(account)
  const personalInfo = getPersonalInfo(profile)
  const mailingAddress = getMailingAddress(profile)
  const phoneNumbers = getPhoneNumbers(profile)
  const primaryEmergencyContact = getPrimaryEmergencyContact(profile)
  const validDependents = getValidDependents(profile)
  const dependentsDeclaration = getDependentsDeclaration(profile)
  const reminder = profile?.completionReminders || {}
  const onboarding = EMPTY_ONBOARDING_COMPLETION

  const personalComplete = Boolean(
    normalizeDate(personalInfo?.dateOfBirth) &&
    isCompleteAddress(mailingAddress) &&
    hasText(phoneNumbers?.mobile) &&
    primaryEmergencyContact
  )
  const dependentsComplete = validDependents.length > 0
    || dependentsDeclaration.status === 'none'
    || (dependentsDeclaration.status === 'provided' && dependentsDeclaration.count > 0)

  const completionByKey = {
    personal: personalComplete,
    dependents: dependentsComplete
  }

  const steps = PROFILE_COMPLETION_STEPS.map(step => ({
    ...step,
    complete: completionByKey[step.key] === true
  }))

  const completedCount = steps.filter(step => step.complete).length
  const nextIncompleteStep = steps.find(step => !step.complete) || null

  return {
    complete: completedCount === steps.length,
    completedCount,
    totalSteps: steps.length,
    percent: Math.round((completedCount / steps.length) * 100),
    steps,
    nextIncompleteStep,
    dependentsCount: validDependents.length || dependentsDeclaration.count,
    hasDeclaredNoDependents: dependentsDeclaration.status === 'none',
    reminder: {
      lastSentAt: normalizeDate(reminder?.lastSentAt),
      sendCount: Number(reminder?.sendCount || 0),
      lastCompletedAt: normalizeDate(reminder?.lastCompletedAt),
      lastMissingSteps: Array.isArray(reminder?.lastMissingSteps) ? reminder.lastMissingSteps : []
    },
    onboarding: {
      ...onboarding,
      isAssigned: false,
      requiresAction: false,
      isActionableStatus: false
    },
    summary: {
      primaryEmergencyContact,
      onboarding: null
    }
  }
}

export async function getProfileCompletionForAccount(account = {}, options = {}) {
  return getProfileCompletion(account, options)
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
    taxInfo: {
      taxId: profile?.taxInfo?.taxId || '',
    },
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
    dependentsCount: validDependents.length || getDependentsDeclaration(profile).count,
    profileCompletion: completion
  }
}
