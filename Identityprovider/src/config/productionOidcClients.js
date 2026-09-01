/**
 * Build the production client catalog from protected deployment secrets.
 * Confidential clients without a non-empty secret are omitted so development
 * placeholders can never leak into production. Explicit public clients use
 * PKCE and carry no client secret.
 */
export function materializeProductionOidcClients(clients = [], secrets = {}) {
  const secretByClient = new Map(
    Object.entries(secrets)
      .map(([clientId, secret]) => [clientId, String(secret || '').trim()])
      .filter(([, secret]) => Boolean(secret))
  )

  return (Array.isArray(clients) ? clients : [])
    .filter(client => (
      client?.token_endpoint_auth_method === 'none'
      || secretByClient.has(client?.client_id)
    ))
    .map(client => {
      const publicClient = client.token_endpoint_auth_method === 'none'
      const productionBoundary = client.client_id === 'n8n-workspace-node'
        ? {
            redirect_uri_patterns: [
              'https://automations.seemplifyai.com/rest/oauth2-credential/callback'
            ],
            allowed_origins: ['https://automations.seemplifyai.com']
          }
        : {}
      if (publicClient) {
        const publicDefinition = { ...client }
        delete publicDefinition.client_secret
        return { ...publicDefinition, ...productionBoundary }
      }
      return {
        ...client,
        ...productionBoundary,
        client_secret: secretByClient.get(client.client_id)
      }
    })
}
