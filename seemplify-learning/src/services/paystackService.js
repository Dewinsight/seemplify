import { SimpleLmsPlatformSetting } from '../models/SimpleLmsPlatformSetting.js'
import { decryptCredentialValue, hasEncryptedCredential } from './credentialEncryptionService.js'

const PAYSTACK_BASE_URL = 'https://api.paystack.co'

const readStoredPaystackSettings = async () => {
  const settings = await SimpleLmsPlatformSetting.findOne({})
    .select('paymentGateways.paystack')
    .lean()
  return settings?.paymentGateways?.paystack || {}
}

const resolveStoredCredentialValue = ({ storedCredential, envValue = '' }) => {
  if (hasEncryptedCredential(storedCredential)) {
    try {
      const decrypted = decryptCredentialValue(storedCredential)
      if (decrypted) return String(decrypted).trim()
    } catch (error) {
      console.error('Failed to decrypt Paystack credential:', error)
    }
  }
  return String(envValue || '').trim()
}

const getPaystackRuntimeConfig = async () => {
  const paystackSettings = await readStoredPaystackSettings()
  const secretKey = resolveStoredCredentialValue({
    storedCredential: paystackSettings?.secretKey,
    envValue: process.env.PAYSTACK_SECRET_KEY
  })
  const publicKey = resolveStoredCredentialValue({
    storedCredential: paystackSettings?.publicKey,
    envValue: process.env.PAYSTACK_PUBLIC_KEY
  })

  return {
    baseUrl: PAYSTACK_BASE_URL,
    secretKey,
    publicKey
  }
}

const requestPaystack = async ({ method = 'GET', path, body }) => {
  const config = await getPaystackRuntimeConfig()
  if (!config.secretKey) {
    throw new Error('Paystack secret key is not configured.')
  }

  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  })

  const result = await response.json().catch(() => ({}))
  if (!response.ok || result?.status === false) {
    const message = String(result?.message || `Paystack request failed (${response.status})`)
    throw new Error(message)
  }
  return result
}

const initializePaystackTransaction = async ({
  reference,
  amountMinor,
  currency = 'NGN',
  callbackUrl,
  customerEmail,
  metadata = {}
}) => {
  const normalizedReference = String(reference || '').trim()
  if (!normalizedReference) {
    throw new Error('Payment reference is required for Paystack checkout.')
  }
  const normalizedEmail = String(customerEmail || '').trim().toLowerCase()
  if (!normalizedEmail) {
    throw new Error('Customer email is required for Paystack checkout.')
  }

  const payload = {
    email: normalizedEmail,
    amount: Math.max(0, Math.round(Number(amountMinor || 0))),
    currency: String(currency || 'NGN').trim().toUpperCase(),
    callback_url: String(callbackUrl || '').trim(),
    reference: normalizedReference,
    metadata
  }

  const result = await requestPaystack({
    method: 'POST',
    path: '/transaction/initialize',
    body: payload
  })

  const checkoutLink = result?.data?.authorization_url
  if (!checkoutLink) {
    throw new Error('Paystack did not return an authorization URL.')
  }

  return {
    authorizationUrl: checkoutLink,
    accessCode: String(result?.data?.access_code || '').trim(),
    reference: String(result?.data?.reference || normalizedReference).trim(),
    raw: result
  }
}

const verifyPaystackTransaction = async (reference) => {
  const normalizedReference = String(reference || '').trim()
  if (!normalizedReference) {
    throw new Error('Paystack reference is required for verification.')
  }

  return requestPaystack({
    method: 'GET',
    path: `/transaction/verify/${encodeURIComponent(normalizedReference)}`
  })
}

const isPaystackConfigured = async () => {
  const config = await getPaystackRuntimeConfig()
  return Boolean(config.publicKey && config.secretKey)
}

const getPaystackPublicKey = async () => {
  const config = await getPaystackRuntimeConfig()
  return config.publicKey
}

const getPaystackSecretKey = async () => {
  const config = await getPaystackRuntimeConfig()
  return config.secretKey
}

export {
  getPaystackPublicKey,
  getPaystackRuntimeConfig,
  getPaystackSecretKey,
  initializePaystackTransaction,
  isPaystackConfigured,
  verifyPaystackTransaction
}
