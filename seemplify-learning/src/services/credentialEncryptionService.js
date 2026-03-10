import crypto from 'crypto'

const normalizeMasterKeyHex = (value) => String(value || '').trim().toLowerCase()

const getMasterKeyBuffer = () => {
  const keyHex = normalizeMasterKeyHex(process.env.CREDENTIALS_ENCRYPTION_KEY)
  if (!keyHex) return null
  if (!/^[a-f0-9]{64}$/.test(keyHex)) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).')
  }
  return Buffer.from(keyHex, 'hex')
}

const hasEncryptedCredential = (credential = null) => {
  if (!credential || typeof credential !== 'object') return false
  const ciphertext = String(credential.ciphertext || '').trim()
  const iv = String(credential.iv || '').trim()
  const authTag = String(credential.authTag || '').trim()
  return Boolean(ciphertext && iv && authTag)
}

const getLastFour = (value) => {
  const normalized = String(value || '').trim()
  if (!normalized) return ''
  return normalized.slice(-4)
}

const maskKey = (lastFour = '') => {
  const tail = String(lastFour || '').trim().slice(-4)
  if (!tail) return 'Not set'
  return `****${tail}`
}

const encryptCredentialValue = (plaintext) => {
  const normalizedPlaintext = String(plaintext || '').trim()
  if (!normalizedPlaintext) {
    throw new Error('Credential value is required.')
  }
  const masterKey = getMasterKeyBuffer()
  if (!masterKey) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY is required to store credentials.')
  }

  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv)
  let ciphertext = cipher.update(normalizedPlaintext, 'utf8', 'hex')
  ciphertext += cipher.final('hex')

  return {
    ciphertext,
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
    lastFour: getLastFour(normalizedPlaintext),
    updatedAt: new Date()
  }
}

const decryptCredentialValue = (encryptedCredential = null) => {
  if (!hasEncryptedCredential(encryptedCredential)) return ''
  const masterKey = getMasterKeyBuffer()
  if (!masterKey) {
    return ''
  }

  const iv = Buffer.from(String(encryptedCredential.iv || ''), 'hex')
  const authTag = Buffer.from(String(encryptedCredential.authTag || ''), 'hex')
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(String(encryptedCredential.ciphertext || ''), 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

const isCredentialEncryptionConfigured = () => /^[a-f0-9]{64}$/.test(normalizeMasterKeyHex(process.env.CREDENTIALS_ENCRYPTION_KEY))

export {
  decryptCredentialValue,
  encryptCredentialValue,
  getLastFour,
  hasEncryptedCredential,
  isCredentialEncryptionConfigured,
  maskKey
}

export default {
  decryptCredentialValue,
  encryptCredentialValue,
  getLastFour,
  hasEncryptedCredential,
  isCredentialEncryptionConfigured,
  maskKey
}
