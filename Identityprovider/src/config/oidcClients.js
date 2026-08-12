export function applyOidcClientSecretOverrides(clients = [], env = process.env) {
  const learningSecret = String(env.SEEMPLIFY_LEARNING_OIDC_CLIENT_SECRET || '').trim()
  return (Array.isArray(clients) ? clients : []).map((client) => {
    if (client?.client_id !== 'seemplify-learning' || !learningSecret) return client
    return {
      ...client,
      client_secret: learningSecret
    }
  })
}
