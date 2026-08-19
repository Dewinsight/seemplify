/**
 * Build the production client catalog from protected deployment secrets.
 * Clients without a non-empty secret are omitted so development placeholders
 * can never leak into a generated production configuration.
 */
export function materializeProductionOidcClients(clients = [], secrets = {}) {
  const secretByClient = new Map(
    Object.entries(secrets)
      .map(([clientId, secret]) => [clientId, String(secret || '').trim()])
      .filter(([, secret]) => Boolean(secret))
  )

  return (Array.isArray(clients) ? clients : [])
    .filter(client => secretByClient.has(client?.client_id))
    .map(client => ({
      ...client,
      client_secret: secretByClient.get(client.client_id)
    }))
}
