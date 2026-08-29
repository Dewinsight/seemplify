(() => {
  const configNode = document.getElementById('profilePersonalConfig')
  const form = document.getElementById('personalForm')
  if (!configNode || !form) return

  const config = JSON.parse(configNode.textContent || '{}')
  let emergencyContacts = Array.isArray(config.emergencyContacts) ? config.emergencyContacts : []
  let contactStatusTimer = null
  const byId = id => document.getElementById(id)
  const clean = value => String(value || '').trim().replace(/\s+/g, ' ')
  const validPhone = value => {
    const phone = clean(value)
    const digits = phone.replace(/\D/g, '')
    return /^\+?[0-9][0-9\s().-]{5,20}$/.test(phone) && digits.length >= 7 && digits.length <= 15
  }
  const validText = value => /^[\p{L}][\p{L}\p{M}\s.'-]*$/u.test(clean(value))

  function setFieldError(key, message) {
    const errorNode = document.querySelector(`[data-error-for="${key}"]`)
    if (errorNode) {
      errorNode.textContent = message || ''
      errorNode.classList.toggle('is-visible', Boolean(message))
    }
    const input = byId(key)
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false')
    if (key === 'emergencyContacts') {
      const section = byId('emergencyContactSection')
      section?.classList.toggle('has-error', Boolean(message))
      section?.setAttribute('aria-invalid', message ? 'true' : 'false')
    }
  }

  function setContactError(key, message) {
    const errorNode = document.querySelector(`[data-contact-error="${key}"]`)
    if (errorNode) {
      errorNode.textContent = message || ''
      errorNode.classList.toggle('is-visible', Boolean(message))
    }
    const input = byId(`contact${key[0].toUpperCase()}${key.slice(1)}`)
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false')
  }

  function clearErrors() {
    document.querySelectorAll('.field-error').forEach(node => {
      node.textContent = ''
      node.classList.remove('is-visible')
    })
    document.querySelectorAll('[aria-invalid="true"]').forEach(node => node.setAttribute('aria-invalid', 'false'))
    document.querySelectorAll('.profile-form-section.has-error').forEach(node => node.classList.remove('has-error'))
  }

  function escapeHtml(value) {
    const node = document.createElement('div')
    node.textContent = value
    return node.innerHTML
  }

  function renderContacts() {
    const list = byId('emergencyContactsList')
    if (!list) return
    list.innerHTML = emergencyContacts.length
      ? emergencyContacts.map((contact, index) => `
          <article class="contact-card">
            <div>
              <div class="contact-name">${escapeHtml(contact.name)}</div>
              <div class="contact-meta">${escapeHtml(contact.relationship)} · ${escapeHtml(contact.phone)}</div>
              ${contact.email ? `<div class="contact-meta">${escapeHtml(contact.email)}</div>` : ''}
            </div>
            <button type="button" class="btn btn-secondary" data-remove-contact="${index}" aria-label="Remove ${escapeHtml(contact.name)}">Remove</button>
          </article>`).join('')
      : '<div class="empty-contacts">No emergency contact added yet.</div>'

    list.querySelectorAll('[data-remove-contact]').forEach(button => {
      button.addEventListener('click', () => {
        emergencyContacts.splice(Number(button.dataset.removeContact), 1)
        renderContacts()
        setFieldError('emergencyContacts', emergencyContacts.length ? '' : 'Add at least one emergency contact.')
        updateChecklist()
      })
    })
  }

  function showContactStatus() {
    const status = byId('contactSaved')
    if (!status) return
    clearTimeout(contactStatusTimer)
    status.classList.add('is-visible')
    contactStatusTimer = setTimeout(() => status.classList.remove('is-visible'), 4000)
  }

  function saveContact() {
    for (const key of ['name', 'relationship', 'phone', 'email']) setContactError(key, '')
    const contact = {
      name: clean(byId('contactName').value),
      relationship: clean(byId('contactRelationship').value),
      phone: clean(byId('contactPhone').value),
      email: clean(byId('contactEmail').value).toLowerCase()
    }
    let invalid = false
    if (contact.name.length < 2 || !validText(contact.name)) { setContactError('name', 'Enter the contact’s full name.'); invalid = true }
    if (contact.relationship.length < 2 || !validText(contact.relationship)) { setContactError('relationship', 'Enter a valid relationship.'); invalid = true }
    if (!validPhone(contact.phone)) { setContactError('phone', 'Enter a valid phone number with 7 to 15 digits.'); invalid = true }
    if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) { setContactError('email', 'Enter a valid email address.'); invalid = true }
    if (invalid) {
      document.querySelector('[data-contact-error].is-visible')?.previousElementSibling?.focus()
      return
    }

    emergencyContacts.push({ ...contact, isPrimary: emergencyContacts.length === 0 })
    for (const id of ['contactName', 'contactRelationship', 'contactPhone', 'contactEmail']) byId(id).value = ''
    setFieldError('emergencyContacts', '')
    renderContacts()
    updateChecklist()
    showContactStatus()
  }

  function collectData() {
    return {
      dateOfBirth: byId('dateOfBirth').value,
      mailingAddress: {
        street: clean(byId('street').value), street2: clean(byId('street2').value), city: clean(byId('city').value),
        state: clean(byId('state').value), zipCode: clean(byId('zipCode').value), country: clean(byId('country').value)
      },
      phoneNumbers: { mobile: clean(byId('mobile').value), home: clean(byId('home').value), work: clean(byId('work').value) },
      emergencyContacts
    }
  }

  function clientErrors(data) {
    const errors = {}
    const rawDate = data.dateOfBirth
    const date = new Date(`${rawDate}T00:00:00.000Z`)
    const today = new Date()
    const oldest = new Date(Date.UTC(today.getUTCFullYear() - 120, today.getUTCMonth(), today.getUTCDate()))
    if (!rawDate || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== rawDate) errors.dateOfBirth = 'Enter a valid date of birth.'
    else if (date > today) errors.dateOfBirth = 'Date of birth cannot be in the future.'
    else if (date < oldest) errors.dateOfBirth = 'Date of birth must be within the last 120 years.'

    if (data.mailingAddress.street.length < 5 || !/[\p{L}\d]/u.test(data.mailingAddress.street)) errors.street = 'Enter a complete street address.'
    if (data.mailingAddress.city.length < 2 || !validText(data.mailingAddress.city)) errors.city = 'Enter a valid city.'
    if (!data.mailingAddress.country || data.mailingAddress.country.length < 2 || !validText(data.mailingAddress.country)) errors.country = 'Enter a valid country name.'
    if (data.mailingAddress.state && !validText(data.mailingAddress.state)) errors.state = 'Enter a valid state, province, or region name.'
    const country = data.mailingAddress.country.toLowerCase()
    if (['usa', 'us', 'united states', 'united states of america'].includes(country)) {
      if (!data.mailingAddress.state) errors.state = 'Enter a US state.'
      if (!/^\d{5}(?:-\d{4})?$/.test(data.mailingAddress.zipCode)) errors.zipCode = 'Enter a 5-digit US ZIP code, optionally followed by 4 digits.'
    } else if (['uk', 'gb', 'united kingdom', 'great britain'].includes(country)) {
      if (!/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(data.mailingAddress.zipCode)) errors.zipCode = 'Enter a valid UK postcode.'
    } else if (['canada', 'ca'].includes(country)) {
      if (!/^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i.test(data.mailingAddress.zipCode)) errors.zipCode = 'Enter a valid Canadian postal code.'
    } else if (data.mailingAddress.zipCode.length < 3) errors.zipCode = 'Enter a valid postal or ZIP code.'

    if (!validPhone(data.phoneNumbers.mobile)) errors.mobile = 'Enter a valid mobile number with 7 to 15 digits.'
    for (const key of ['home', 'work']) if (data.phoneNumbers[key] && !validPhone(data.phoneNumbers[key])) errors[key] = `Enter a valid ${key} phone number.`
    if (!data.emergencyContacts.length) {
      const hasContactDraft = ['contactName', 'contactRelationship', 'contactPhone', 'contactEmail']
        .some(id => clean(byId(id)?.value))
      errors.emergencyContacts = hasContactDraft
        ? 'Select “Add contact” to add these contact details, then save your profile.'
        : 'Add at least one emergency contact.'
    } else {
      data.emergencyContacts.forEach((contact, index) => {
        if (clean(contact?.name).length < 2 || !validText(contact?.name)) errors[`emergencyContacts.${index}.name`] = 'Enter the contact’s full name.'
        if (clean(contact?.relationship).length < 2 || !validText(contact?.relationship)) errors[`emergencyContacts.${index}.relationship`] = 'Enter a valid relationship.'
        if (!validPhone(contact?.phone)) errors[`emergencyContacts.${index}.phone`] = 'Enter a valid contact phone number.'
        if (contact?.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(contact.email))) errors[`emergencyContacts.${index}.email`] = 'Enter a valid email address.'
      })
    }
    return errors
  }

  const requirementErrorKeys = {
    identity: ['dateOfBirth'],
    address: ['street', 'city', 'state', 'zipCode', 'country'],
    phone: ['mobile', 'home', 'work'],
    'emergency-contact': ['emergencyContacts']
  }

  function renderRequirementState(key, complete) {
    const requirement = document.querySelector(`[data-requirement="${key}"]`)
    if (!requirement) return
    requirement.classList.toggle('is-complete', complete)
    const index = [...document.querySelectorAll('[data-requirement]')].indexOf(requirement) + 1
    requirement.querySelector('.profile-requirement__icon').textContent = complete ? '✓' : String(index)
    requirement.querySelector('.profile-requirement__state').textContent = complete ? 'Ready' : 'Required'
  }

  function updateChecklist(errors) {
    let completed = 0
    const validationErrors = errors && !(errors instanceof Event)
      ? errors
      : clientErrors(collectData())
    const errorKeys = Object.keys(validationErrors)
    for (const [key, fields] of Object.entries(requirementErrorKeys)) {
      const complete = !errorKeys.some(errorKey => fields.some(field => errorKey === field || errorKey.startsWith(`${field}.`)))
      renderRequirementState(key, complete)
      if (complete) completed += 1
    }
    byId('profileChecklistCount').textContent = `${completed} of ${Object.keys(requirementErrorKeys).length} ready`
  }

  function applyServerCompletion(completion) {
    const requirements = completion?.steps?.find(step => step.key === 'personal')?.requirements || []
    if (!requirements.length) return
    let completed = 0
    for (const requirement of requirements) {
      renderRequirementState(requirement.key, requirement.complete === true)
      if (requirement.complete) completed += 1
    }
    byId('profileChecklistCount').textContent = `${completed} of ${requirements.length} ready`
    const navStatus = document.querySelector('.profile-nav-status')
    if (navStatus && completion.complete) {
      navStatus.classList.remove('is-required')
      navStatus.classList.add('is-complete')
      navStatus.innerHTML = '<span aria-hidden="true">✓</span> Complete'
    }
  }

  function showErrors(errors) {
    const normalized = new Map()
    for (const [key, message] of Object.entries(errors || {})) {
      const normalizedKey = key.startsWith('emergencyContacts.') ? 'emergencyContacts' : key
      if (!normalized.has(normalizedKey)) normalized.set(normalizedKey, normalizedKey === 'emergencyContacts' && key !== normalizedKey
        ? 'A saved emergency contact has invalid details. Remove it and add it again.' : message)
    }
    for (const [key, message] of normalized) setFieldError(key, message)
    const firstInvalid = document.querySelector('input[aria-invalid="true"]') || document.querySelector('.profile-form-section[aria-invalid="true"]')
    firstInvalid?.focus()
    firstInvalid?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    return {
      count: normalized.size,
      firstMessage: [...normalized.values()][0] || 'Review the required information below.',
      firstInvalid
    }
  }

  function setErrorAlert(message, action = null) {
    byId('alertErrorMessage').textContent = message
    const actionNode = byId('alertErrorAction')
    actionNode.hidden = !action
    if (action) {
      actionNode.href = action.href
      actionNode.textContent = action.label
    }
    byId('alertError').classList.add('show')
  }

  function clearErrorAlert() {
    byId('alertError').classList.remove('show')
    byId('alertErrorMessage').textContent = ''
    byId('alertErrorAction').hidden = true
  }

  function setSuccessAlert(message) {
    byId('alertSuccess').textContent = message
    byId('alertSuccess').classList.add('show')
  }

  async function readJsonResponse(response) {
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) return null
    try {
      return await response.json()
    } catch {
      return null
    }
  }

  function saveFailureForStatus(status, result) {
    if (status === 401) {
      return {
        message: 'Your session expired before the profile could be saved. Sign in again, then return to finish your profile.',
        action: { href: '/login', label: 'Sign in again' }
      }
    }
    if (status === 403) return { message: 'You do not have permission to update this profile. Ask your organization administrator for access.' }
    if (status === 429) return { message: 'Too many save attempts. Wait a minute, then try again. Your entries are still on this page.' }
    if (status >= 500) return { message: 'Seemplify Identity could not save your profile right now. Your entries are still on this page—please try again.' }
    return { message: result?.error || 'Your profile could not be saved. Review the information and try again.' }
  }

  function setSaving(saving) { byId('saveBtn').disabled = saving; byId('btnText').hidden = saving; byId('btnSpinner').hidden = !saving }

  async function submitPersonal(event) {
    event.preventDefault()
    clearErrors()
    byId('alertSuccess').classList.remove('show')
    clearErrorAlert()
    const data = collectData()
    const errors = clientErrors(data)
    updateChecklist(errors)
    if (Object.keys(errors).length) {
      const summary = showErrors(errors)
      setErrorAlert(`${summary.count} ${summary.count === 1 ? 'field needs' : 'fields need'} attention. Start with: ${summary.firstMessage}`)
      return
    }

    setSaving(true)
    try {
      const response = await fetch('/api/profile/personal', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      const result = await readJsonResponse(response)
      if (!response.ok) {
        if (result?.fieldErrors && Object.keys(result.fieldErrors).length) {
          const summary = showErrors(result.fieldErrors)
          updateChecklist(result.fieldErrors)
          setErrorAlert(`${summary.count} ${summary.count === 1 ? 'field needs' : 'fields need'} attention. Start with: ${summary.firstMessage}`)
          return
        }
        const failure = saveFailureForStatus(response.status, result)
        setErrorAlert(failure.message, failure.action)
        byId('alertError').focus()
        return
      }
      if (!result?.profileCompletion) throw new Error('The profile save response was incomplete.')
      applyServerCompletion(result.profileCompletion)
      if (config.setupMode && result.profileCompletion?.complete) {
        setSuccessAlert('Profile complete. Taking you to Seemplify…')
        byId('alertSuccess').focus()
        setTimeout(() => window.location.assign('/'), 650)
      } else {
        setSuccessAlert(result.profileCompletion?.complete
          ? 'Personal information saved. Your required profile is complete.'
          : 'Personal information saved. Finish the remaining required items.')
        byId('alertSuccess').focus()
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    } catch (error) {
      const message = error instanceof TypeError
        ? 'Seemplify Identity could not be reached. Check your connection and try again. Your entries are still on this page.'
        : 'Seemplify Identity returned an unexpected response. Your entries are still on this page—please try again.'
      setErrorAlert(message)
      byId('alertError').focus()
    } finally {
      setSaving(false)
    }
  }

  byId('saveContactBtn')?.addEventListener('click', saveContact)
  form.addEventListener('submit', submitPersonal)
  form.addEventListener('input', event => {
    const contactErrorKey = {
      contactName: 'name',
      contactRelationship: 'relationship',
      contactPhone: 'phone',
      contactEmail: 'email'
    }[event.target?.id]
    if (contactErrorKey) setContactError(contactErrorKey, '')
    else if (event.target?.id) setFieldError(event.target.id, '')
    clearErrorAlert()
    updateChecklist()
  })
  form.addEventListener('change', () => updateChecklist())
  renderContacts()
  updateChecklist()
})()
