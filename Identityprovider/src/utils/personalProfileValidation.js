const PHONE_PATTERN = /^\+?[0-9][0-9\s().-]{5,20}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TEXT_PATTERN = /^[\p{L}][\p{L}\p{M}\s.'-]*$/u

function clean(value, maxLength = 200) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength)
}
function isValidPhone(value) {
  const phone = clean(value, 30)
  const digits = phone.replace(/\D/g, '')
  return PHONE_PATTERN.test(phone) && digits.length >= 7 && digits.length <= 15
}

function validateDateOfBirth(value, fieldErrors) {
  const raw = clean(value, 10)
  if (!raw) {
    fieldErrors.dateOfBirth = 'Enter a date of birth.'
    return null
  }
  const date = new Date(`${raw}T00:00:00.000Z`)
  const today = new Date()
  const oldest = new Date(Date.UTC(today.getUTCFullYear() - 120, today.getUTCMonth(), today.getUTCDate()))
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    fieldErrors.dateOfBirth = 'Enter a valid date of birth.'
    return null
  }
  if (date > today) fieldErrors.dateOfBirth = 'Date of birth cannot be in the future.'
  if (date < oldest) fieldErrors.dateOfBirth = 'Date of birth must be within the last 120 years.'
  return date
}

function validateAddress(input = {}, fieldErrors) {
  const address = {
    street: clean(input.street), street2: clean(input.street2), city: clean(input.city, 100),
    state: clean(input.state, 100), zipCode: clean(input.zipCode, 24), country: clean(input.country, 100),
  }
  if (address.street.length < 5 || !/[\p{L}\d]/u.test(address.street)) fieldErrors.street = 'Enter a complete street address.'
  if (address.city.length < 2 || !TEXT_PATTERN.test(address.city)) fieldErrors.city = 'Enter a valid city using letters, spaces, apostrophes, or hyphens.'
  if (!address.country || address.country.length < 2 || !TEXT_PATTERN.test(address.country)) fieldErrors.country = 'Enter a valid country name.'
  if (address.state && !TEXT_PATTERN.test(address.state)) fieldErrors.state = 'Enter a valid state, province, or region name.'
  const country = address.country.toLowerCase()
  if (['usa', 'us', 'united states', 'united states of america'].includes(country)) {
    if (!address.state) fieldErrors.state = 'Enter a US state.'
    if (!/^\d{5}(?:-\d{4})?$/.test(address.zipCode)) fieldErrors.zipCode = 'Enter a 5-digit US ZIP code, optionally followed by 4 digits.'
  } else if (['uk', 'gb', 'united kingdom', 'great britain'].includes(country)) {
    if (!/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(address.zipCode)) fieldErrors.zipCode = 'Enter a valid UK postcode.'
  } else if (['canada', 'ca'].includes(country)) {
    if (!/^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i.test(address.zipCode)) fieldErrors.zipCode = 'Enter a valid Canadian postal code.'
  } else if (address.zipCode.length < 3) fieldErrors.zipCode = 'Enter a valid postal or ZIP code.'
  return address
}

export function validatePersonalProfile(input = {}) {
  const fieldErrors = {}
  const dateOfBirth = validateDateOfBirth(input.dateOfBirth, fieldErrors)
  const mailingAddress = validateAddress(input.mailingAddress, fieldErrors)
  const phoneNumbers = {
    mobile: clean(input.phoneNumbers?.mobile, 30), home: clean(input.phoneNumbers?.home, 30), work: clean(input.phoneNumbers?.work, 30),
  }
  if (!isValidPhone(phoneNumbers.mobile)) fieldErrors.mobile = 'Enter a valid mobile number with 7 to 15 digits.'
  for (const key of ['home', 'work']) if (phoneNumbers[key] && !isValidPhone(phoneNumbers[key])) fieldErrors[key] = `Enter a valid ${key} phone number.`
  const emergencyContacts = Array.isArray(input.emergencyContacts) ? input.emergencyContacts.slice(0, 10).map((contact, index) => {
    const normalized = {
      name: clean(contact?.name, 120), relationship: clean(contact?.relationship, 80), phone: clean(contact?.phone, 30),
      email: clean(contact?.email, 160).toLowerCase(), isPrimary: index === 0 || contact?.isPrimary === true,
    }
    if (normalized.name.length < 2 || !TEXT_PATTERN.test(normalized.name)) fieldErrors[`emergencyContacts.${index}.name`] = 'Enter the contact’s full name.'
    if (normalized.relationship.length < 2 || !TEXT_PATTERN.test(normalized.relationship)) fieldErrors[`emergencyContacts.${index}.relationship`] = 'Enter a valid relationship.'
    if (!isValidPhone(normalized.phone)) fieldErrors[`emergencyContacts.${index}.phone`] = 'Enter a valid contact phone number.'
    if (normalized.email && !EMAIL_PATTERN.test(normalized.email)) fieldErrors[`emergencyContacts.${index}.email`] = 'Enter a valid email address.'
    return normalized
  }) : []
  if (emergencyContacts.length === 0) fieldErrors.emergencyContacts = 'Save at least one emergency contact.'
  return { valid: Object.keys(fieldErrors).length === 0, fieldErrors, value: { dateOfBirth, mailingAddress, phoneNumbers, emergencyContacts } }
}
