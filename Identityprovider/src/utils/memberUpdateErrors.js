const DOMAIN_ERRORS = [
  {
    pattern: /^Member not found$/i,
    status: 404,
    code: 'MEMBER_NOT_FOUND',
    publicMessage: 'This member could not be found in the organization.'
  },
  {
    pattern: /^Cannot demote the last owner\b/i,
    status: 409,
    code: 'LAST_OWNER_CONFLICT',
    publicMessage: 'The last organization owner cannot be demoted. Transfer ownership first.'
  },
  {
    pattern: /^Cannot remove the last owner\b/i,
    status: 409,
    code: 'LAST_OWNER_CONFLICT',
    publicMessage: 'The last organization owner cannot be removed. Transfer ownership first.'
  },
  {
    pattern: /^Only current owner can assign owner role$/i,
    status: 403,
    code: 'OWNER_ROLE_REQUIRED',
    publicMessage: 'Only a current organization owner can assign the owner role.'
  }
]

function hasTransactionLabel(error, label) {
  if (typeof error?.hasErrorLabel === 'function') {
    try {
      return error.hasErrorLabel(label)
    } catch {
      return false
    }
  }
  return Array.isArray(error?.errorLabels) && error.errorLabels.includes(label)
}

export function classifyMemberUpdateError(error) {
  const message = String(error?.message || '').trim()
  const domainError = DOMAIN_ERRORS.find(({ pattern }) => pattern.test(message))
  if (domainError) {
    return {
      status: domainError.status,
      code: domainError.code,
      publicMessage: domainError.publicMessage
    }
  }

  if (error?.name === 'ValidationError' || error?.name === 'CastError') {
    return {
      status: 422,
      code: 'MEMBER_UPDATE_INVALID',
      publicMessage: 'The member update contains invalid information.'
    }
  }

  if (Number(error?.code) === 11000) {
    return {
      status: 409,
      code: 'MEMBER_UPDATE_CONFLICT',
      publicMessage: 'The member was changed elsewhere. Refresh the page and try again.'
    }
  }

  if (hasTransactionLabel(error, 'TransientTransactionError')
      || hasTransactionLabel(error, 'UnknownTransactionCommitResult')) {
    return {
      status: 503,
      code: 'MEMBER_UPDATE_RETRY',
      publicMessage: 'The member change could not be completed just now. Please try again.'
    }
  }

  return {
    status: 500,
    code: 'MEMBER_UPDATE_FAILED',
    publicMessage: 'The member update could not be completed. Please try again.'
  }
}

export function serializeMemberUpdateError(error) {
  return {
    name: String(error?.name || 'Error'),
    message: String(error?.message || 'Unknown member update error'),
    code: error?.code ?? null,
    labels: Array.isArray(error?.errorLabels) ? error.errorLabels : [],
    stack: typeof error?.stack === 'string' ? error.stack : undefined
  }
}
