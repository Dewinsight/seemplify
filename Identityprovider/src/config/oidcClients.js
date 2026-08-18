import { readFileSync } from 'node:fs'

function resolveSecret(name, env, readSecretFile) {
  const file = String(env[`${name}_FILE`] || '').trim()
  if (file) return String(readSecretFile(file, 'utf8')).trim()
  return String(env[name] || '').trim()
}

export function applyOidcClientSecretOverrides(clients = [], env = process.env, readSecretFile = readFileSync) {
  const learningSecret = String(env.SEEMPLIFY_LEARNING_OIDC_CLIENT_SECRET || '').trim()
  const messagingSecret = String(env.MESSAGING_OIDC_CLIENT_SECRET || '').trim()
  const experienceSecret = String(env.EXPERIENCE_OIDC_CLIENT_SECRET || '').trim()
  const automationHubSecret = resolveSecret('AUTOMATION_HUB_OIDC_CLIENT_SECRET', env, readSecretFile)
  return (Array.isArray(clients) ? clients : []).map((client) => {
    if (client?.client_id === 'seemplify-learning' && learningSecret) {
      return { ...client, client_secret: learningSecret }
    }
    if (client?.client_id === 'messaging' && messagingSecret) {
      return { ...client, client_secret: messagingSecret }
    }
    if (client?.client_id === 'experience-management' && experienceSecret) {
      return { ...client, client_secret: experienceSecret }
    }
    if (client?.client_id === 'automation-hub' && automationHubSecret) {
      return { ...client, client_secret: automationHubSecret }
    }
    return client
  })
}
