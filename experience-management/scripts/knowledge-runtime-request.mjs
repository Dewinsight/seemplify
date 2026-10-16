import crypto from 'node:crypto';

export async function signedKnowledgeRequest(baseUrl, secret, route, input, fetchImpl = fetch) {
  const body = JSON.stringify(input), timestamp = String(Date.now()), nonce = crypto.randomBytes(24).toString('base64url');
  const signature = crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\nPOST\n${route}\n${body}`).digest('base64url');
  const response = await fetchImpl(baseUrl + route, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-seemplify-timestamp': timestamp,
      'x-seemplify-nonce': nonce, 'x-seemplify-signature': signature }, body, signal: AbortSignal.timeout(30 * 60_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Nomic runtime rejected ${route}: ${result.code || response.status}`);
  return result;
}
