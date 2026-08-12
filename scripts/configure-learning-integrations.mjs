const required = (name) => {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

const dokployOrigin = required('DOKPLOY_URL').replace(/\/$/, '')
const apiBase = dokployOrigin.endsWith('/api') ? dokployOrigin : `${dokployOrigin}/api`
const token = required('DOKPLOY_TOKEN')
const identityProviderAppId = required('IDENTITY_PROVIDER_APP_ID')
const learningAppId = required('SEEMPLIFY_LEARNING_APP_ID')
const performanceAppId = required('PERFORMANCE_BACKEND_APP_ID')
const learningOidcSecret = required('SEEMPLIFY_LEARNING_OIDC_CLIENT_SECRET')
const performanceWebhookSecret = required('PERFORMANCE_MANAGEMENT_WEBHOOK_SECRET')
const headers = {
  'x-api-key': token,
  'content-type': 'application/json',
  accept: 'application/json'
}

function mergeEnvironment(current, updates) {
  const entries = new Map()
  const passthrough = []
  for (const line of String(current || '').split(/\r?\n/)) {
    if (!line.trim()) continue
    const separator = line.indexOf('=')
    if (separator < 1) {
      passthrough.push(line)
      continue
    }
    entries.set(line.slice(0, separator), line.slice(separator + 1))
  }
  for (const [key, value] of Object.entries(updates)) entries.set(key, value)
  return [...entries].map(([key, value]) => `${key}=${value}`).concat(passthrough).join('\n')
}

async function request(pathname, options = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  })
  const responseText = await response.text()
  if (!response.ok) {
    throw new Error(`Dokploy ${pathname} returned ${response.status}: ${responseText.slice(0, 300)}`)
  }
  return responseText ? JSON.parse(responseText) : null
}

async function saveEnvironment(applicationId, updates) {
  const application = await request(`/application.one?applicationId=${encodeURIComponent(applicationId)}`)
  const nextEnvironment = mergeEnvironment(application.env, updates)
  if (nextEnvironment === String(application.env || '')) return false
  await request('/application.saveEnvironment', {
    method: 'POST',
    body: JSON.stringify({
      applicationId,
      env: nextEnvironment,
      buildArgs: application.buildArgs ?? '',
      buildSecrets: application.buildSecrets ?? '',
      createEnvFile: application.createEnvFile === true
    })
  })
  return true
}

async function deploy(applicationId) {
  await request('/application.deploy', {
    method: 'POST',
    body: JSON.stringify({ applicationId })
  })
}

const configurations = [
  {
    name: 'Identity Provider',
    applicationId: identityProviderAppId,
    environment: {
      SEEMPLIFY_LEARNING_OIDC_CLIENT_SECRET: learningOidcSecret,
      SEEMPLIFY_LEARNING_URL: 'https://learning.seemplifyai.com'
    }
  },
  {
    name: 'Seemplify Learning',
    applicationId: learningAppId,
    environment: {
      NODE_ENV: 'production',
      APP_BASE_URL: 'https://learning.seemplifyai.com',
      IDP_ISSUER_URL: 'https://auth.seemplifyai.com',
      OIDC_CLIENT_ID: 'seemplify-learning',
      OIDC_CLIENT_SECRET: learningOidcSecret,
      OIDC_REDIRECT_URI: 'https://learning.seemplifyai.com/auth/seemplify/callback',
      PERFORMANCE_MANAGEMENT_URL: 'https://api-performance.seemplifyai.com',
      PERFORMANCE_MANAGEMENT_WEBHOOK_SECRET: performanceWebhookSecret
    }
  },
  {
    name: 'Performance backend',
    applicationId: performanceAppId,
    environment: {
      PERFORMANCE_MANAGEMENT_WEBHOOK_SECRET: performanceWebhookSecret,
      LEARNING_APP_URL: 'https://learning.seemplifyai.com'
    }
  }
]

for (const configuration of configurations) {
  const changed = await saveEnvironment(configuration.applicationId, configuration.environment)
  console.log(`${configuration.name} environment ${changed ? 'updated' : 'already current'}.`)
}

for (const configuration of configurations) {
  await deploy(configuration.applicationId)
  console.log(`${configuration.name} deployment triggered.`)
}
