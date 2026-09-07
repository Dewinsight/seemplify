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
    .filter(client => !RETIRED_AUTOMATION_CLIENT_IDS.has(client?.client_id))
    .filter(client => (
      client?.token_endpoint_auth_method === 'none'
      || secretByClient.has(client?.client_id)
    ))
    .map(client => {
      const publicClient = client.token_endpoint_auth_method === 'none'
      if (publicClient) {
        const publicDefinition = { ...client }
        delete publicDefinition.client_secret
        return publicDefinition
      }
      return {
        ...client,
        client_secret: secretByClient.get(client.client_id)
      }
    })
}
import { RETIRED_AUTOMATION_CLIENT_IDS } from '../middleware/retiredAutomations.js'
