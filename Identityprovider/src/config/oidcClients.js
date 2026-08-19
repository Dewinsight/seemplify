export function applyOidcClientSecretOverrides(clients = [], env = process.env) {
  const learningSecret = String(env.SEEMPLIFY_LEARNING_OIDC_CLIENT_SECRET || '').trim()
  const messagingSecret = String(env.MESSAGING_OIDC_CLIENT_SECRET || '').trim()
  const communitySecret = String(env.COMMUNITY_OIDC_CLIENT_SECRET || '').trim()
  const experienceSecret = String(env.EXPERIENCE_OIDC_CLIENT_SECRET || '').trim()
  return (Array.isArray(clients) ? clients : []).map((client) => {
    if (client?.client_id === 'seemplify-learning' && learningSecret) {
      return { ...client, client_secret: learningSecret }
    }
    if (client?.client_id === 'messaging' && messagingSecret) {
      return { ...client, client_secret: messagingSecret }
    }
    if (client?.client_id === 'community' && communitySecret) {
      return { ...client, client_secret: communitySecret }
    }
    if (client?.client_id === 'experience-management' && experienceSecret) {
      return { ...client, client_secret: experienceSecret }
    }
    return client
  })
}
