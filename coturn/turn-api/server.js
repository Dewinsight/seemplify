/**
 * TURN Credentials API (TURN REST API style)
 * Returns time-limited username/credential for Coturn (use-auth-secret / lt-cred-mech).
 * Algorithm: username = timestamp:ttl, password = base64(HMAC-SHA1(secret, username))
 */

const express = require('express');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TURN_AUTH_SECRET = process.env.TURN_AUTH_SECRET;
const TURN_HOST = process.env.TURN_HOST || 'turn.seemplifyai.com';
const TURN_PORT = parseInt(process.env.TURN_PORT || '3478', 10);
const TURN_TTL = parseInt(process.env.TURN_TTL || '86400', 10); // 24h default

if (!TURN_AUTH_SECRET) {
  console.error('Missing TURN_AUTH_SECRET');
  process.exit(1);
}

function generateTurnCredentials() {
  const ttl = TURN_TTL;
  const timestamp = Math.floor(Date.now() / 1000);
  const username = `${timestamp}:${ttl}`;
  const hmac = crypto.createHmac('sha1', TURN_AUTH_SECRET);
  hmac.setEncoding('base64');
  hmac.write(username);
  hmac.end();
  const credential = hmac.read();
  return { username, credential };
}

// GET /api/turn-credentials — returns ICE server config for WebRTC
app.get('/api/turn-credentials', (req, res) => {
  const { username, credential } = generateTurnCredentials();
  const urls = [
    `turn:${TURN_HOST}:${TURN_PORT}?transport=udp`,
    `turn:${TURN_HOST}:${TURN_PORT}?transport=tcp`,
  ];
  res.json({
    urls,
    username,
    credential,
    ttl: TURN_TTL,
  });
});

// GET /api/health — for Traefik/load balancer health checks
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'turn-api' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Turn API listening on port ${PORT}`);
});
