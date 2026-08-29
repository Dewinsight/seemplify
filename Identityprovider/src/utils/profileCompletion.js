import { validatePersonalProfile } from './personalProfileValidation.js'

const PROFILE_COMPLETION_STEPS = [
  {
    key: 'personal',
    label: 'Personal Info',
    route: '/profile/personal',
    description: 'Add your date of birth, address, phone number, and emergency contact.'
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

function getEmergencyContacts(profile = {}) {
  return Array.isArray(getPersonalInfo(profile)?.emergencyContacts)
    ? getPersonalInfo(profile).emergencyContacts
    : []
}

function getPrimaryEmergencyContact(profile = {}) {
  const contacts = getEmergencyContacts(profile).filter(contact => hasText(contact?.name) && hasText(contact?.phone))
  if (contacts.length === 0) return null
  return contacts.find(contact => contact?.isPrimary === true) || contacts[0]
}

function toDateInput(value) {
  const date = normalizeDate(value)
  return date ? date.toISOString().slice(0, 10) : String(value || '')
}

function getPersonalProfileValidation(personalInfo = {}) {
  return validatePersonalProfile({
    dateOfBirth: toDateInput(personalInfo?.dateOfBirth),
    mailingAddress: personalInfo?.mailingAddress || {},
    phoneNumbers: personalInfo?.phoneNumbers || {},
    emergencyContacts: Array.isArray(personalInfo?.emergencyContacts) ? personalInfo.emergencyContacts : []
  })
}

function hasAnyError(fieldErrors, keys) {
  return Object.keys(fieldErrors).some(key => keys.some(candidate => key === candidate || key.startsWith(`${candidate}.`)))
}

function getPersonalRequirements(fieldErrors = {}) {
  return [
    {
      key: 'identity',
      label: 'Date of birth',
      complete: !hasAnyError(fieldErrors, ['dateOfBirth'])
    },
    {
      key: 'address',
      label: 'Mailing address',
      complete: !hasAnyError(fieldErrors, ['street', 'city', 'state', 'zipCode', 'country'])
    },
    {
      key: 'phone',
      label: 'Phone number',
      complete: !hasAnyError(fieldErrors, ['mobile', 'home', 'work'])
    },
    {
      key: 'emergency-contact',
      label: 'Emergency contact',
      complete: !hasAnyError(fieldErrors, ['emergencyContacts'])
    }
  ]
}

export function getProfileCompletion(account = {}, options = {}) {
  const profile = getProfile(account)
  const personalInfo = getPersonalInfo(profile)
  const primaryEmergencyContact = getPrimaryEmergencyContact(profile)
  const reminder = profile?.completionReminders || {}
  const onboarding = EMPTY_ONBOARDING_COMPLETION
  const personalValidation = getPersonalProfileValidation(personalInfo)
  const personalRequirements = getPersonalRequirements(personalValidation.fieldErrors)

  const completionByKey = {
    personal: personalValidation.valid
  }

  const steps = PROFILE_COMPLETION_STEPS.map(step => ({
    ...step,
    complete: completionByKey[step.key] === true,
    requirements: step.key === 'personal' ? personalRequirements : []
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
    emergencyContact: primaryEmergencyContact
      ? {
          name: primaryEmergencyContact.name || '',
          relationship: primaryEmergencyContact.relationship || '',
          phone: primaryEmergencyContact.phone || '',
          email: primaryEmergencyContact.email || ''
        }
      : null,
    profileCompletion: completion
  }
}
