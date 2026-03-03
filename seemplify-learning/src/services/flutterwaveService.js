const FLUTTERWAVE_BASE_URL = String(process.env.FLUTTERWAVE_BASE_URL || 'https://api.flutterwave.com/v3').replace(/\/+$/, '')

const getSecretKey = () => String(process.env.FLUTTERWAVE_SECRET_KEY || '').trim()
const getPublicKey = () => String(process.env.FLUTTERWAVE_PUBLIC_KEY || '').trim()

const requestFlutterwave = async ({ method = 'GET', path, body }) => {
  const secretKey = getSecretKey()
  if (!secretKey) {
    throw new Error('Flutterwave secret key is not configured.')
  }

  const response = await fetch(`${FLUTTERWAVE_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
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

const isFlutterwaveConfigured = () => Boolean(getPublicKey() && getSecretKey())

const getFlutterwavePublicKey = () => getPublicKey()

export {
  createFlutterwavePaymentLink,
  verifyFlutterwaveTransaction,
  isFlutterwaveConfigured,
  getFlutterwavePublicKey
}
