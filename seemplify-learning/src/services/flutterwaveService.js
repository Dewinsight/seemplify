import { SimpleLmsPlatformSetting } from '../models/SimpleLmsPlatformSetting.js'
import { decryptCredentialValue, hasEncryptedCredential } from './credentialEncryptionService.js'

const FLUTTERWAVE_BASE_URL = String(process.env.FLUTTERWAVE_BASE_URL || 'https://api.flutterwave.com/v3').replace(/\/+$/, '')

const readStoredFlutterwaveSettings = async () => {
  const settings = await SimpleLmsPlatformSetting.findOne({})
    .select('paymentGateways.flutterwave')
    .lean()
  return settings?.paymentGateways?.flutterwave || {}
}

const resolveStoredCredentialValue = ({ storedCredential, envValue = '' }) => {
  if (hasEncryptedCredential(storedCredential)) {
    try {
      const decrypted = decryptCredentialValue(storedCredential)
      if (decrypted) return String(decrypted).trim()
    } catch (error) {
      console.error('Failed to decrypt Flutterwave credential:', error)
    }
  }
  return String(envValue || '').trim()
}

const getFlutterwaveRuntimeConfig = async () => {
  const flutterwaveSettings = await readStoredFlutterwaveSettings()
  const secretKey = resolveStoredCredentialValue({
    storedCredential: flutterwaveSettings?.secretKey,
    envValue: process.env.FLUTTERWAVE_SECRET_KEY
  })
  const publicKey = resolveStoredCredentialValue({
    storedCredential: flutterwaveSettings?.publicKey,
    envValue: process.env.FLUTTERWAVE_PUBLIC_KEY
  })
  const webhookHash = resolveStoredCredentialValue({
    storedCredential: flutterwaveSettings?.webhookHash,
    envValue: process.env.FLUTTERWAVE_WEBHOOK_HASH
  })

  return {
    baseUrl: FLUTTERWAVE_BASE_URL,
    secretKey,
    publicKey,
    webhookHash
  }
}

const requestFlutterwave = async ({ method = 'GET', path, body }) => {
  const config = await getFlutterwaveRuntimeConfig()
  if (!config.secretKey) {
    throw new Error('Flutterwave secret key is not configured.')
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
  if (!response.ok) {
    const message = String(result?.message || result?.error || `Flutterwave request failed (${response.status})`)
    throw new Error(message)
  }
  return result
}

const createFlutterwavePaymentLink = async ({
  txRef,
  amountMinor,
  currency = 'NGN',
  redirectUrl,
  customerEmail,
  customerName,
  title,
  description
}) => {
  const amountMajor = (Math.max(0, Number(amountMinor || 0)) / 100).toFixed(2)
  const payload = {
    tx_ref: txRef,
    amount: amountMajor,
    currency: String(currency || 'NGN').toUpperCase(),
    redirect_url: redirectUrl,
    payment_options: 'card,banktransfer,ussd',
    customer: {
      email: customerEmail,
      name: customerName || customerEmail
    },
    customizations: {
      title: title || 'Seemplify Learning',
      description: description || 'Course payment'
    }
  }

  const result = await requestFlutterwave({
    method: 'POST',
    path: '/payments',
    body: payload
  })

  const checkoutLink = result?.data?.link
  if (!checkoutLink) {
    throw new Error('Flutterwave did not return a checkout link.')
  }

  return {
    link: checkoutLink,
    raw: result
  }
}

const verifyFlutterwaveTransaction = async (transactionId) => {
  const normalizedId = String(transactionId || '').trim()
  if (!normalizedId) {
    throw new Error('Flutterwave transaction id is required for verification.')
  }

  const result = await requestFlutterwave({
    method: 'GET',
    path: `/transactions/${encodeURIComponent(normalizedId)}/verify`
  })

  return result
}

const isFlutterwaveConfigured = async () => {
  const config = await getFlutterwaveRuntimeConfig()
  return Boolean(config.publicKey && config.secretKey)
}

const getFlutterwavePublicKey = async () => {
  const config = await getFlutterwaveRuntimeConfig()
  return config.publicKey
}

const getFlutterwaveWebhookHash = async () => {
  const config = await getFlutterwaveRuntimeConfig()
  return config.webhookHash
}

export {
  createFlutterwavePaymentLink,
  getFlutterwavePublicKey,
  getFlutterwaveRuntimeConfig,
  getFlutterwaveWebhookHash,
  isFlutterwaveConfigured,
  verifyFlutterwaveTransaction
}
