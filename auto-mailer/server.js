/**
 * Auto-mailer - Minimal health-check server for deployment verification
 * Full mailer functionality to be added later.
 */
const express = require('express');
const app = express();
const PORT = process.env.PORT || 5012;

// Health check endpoint (required for Dokploy/load balancers)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'auto-mailer', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ service: 'auto-mailer', status: 'running', version: '1.0.0' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Auto-mailer listening on port ${PORT}`);
});
