/**
 * Campaign Send Service
 * Sends emails in batches of max 5 with random delays to avoid blocking.
 * Uses Nylas for delivery.
 */

import NylasService from './nylasService.js';

const BATCH_SIZE = 5;
const MIN_DELAY_MS = 20000;  // 20 seconds between batches
const MAX_DELAY_MS = 60000;  // 60 seconds between batches (random in range)

/**
 * Substitute {{variable}} placeholders in template with row data.
 * @param {string} template - e.g. "Hi {{firstName}}, your email is {{email}}"
 * @param {object} row - e.g. { firstName: "John", email: "john@example.com" }
 * @returns {string}
 */
function substituteVariables(template, row) {
  if (!template || typeof template !== 'string') return '';
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = row[key];
    return value !== undefined && value !== null ? String(value) : match;
  });
}

/**
 * Shuffle array randomly (Fisher-Yates).
 */
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Random delay between min and max ms.
 */
function randomDelay() {
  const ms = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send a campaign: recipients in batches of 5, random order, random delays.
 * @param {object} options
 * @param {string} options.grantId - Nylas grant ID
 * @param {Array<object>} options.recipients - [{ email, name?, ...fields }]
 * @param {string} options.subjectTemplate - e.g. "Hi {{firstName}}"
 * @param {string} options.bodyTemplate - HTML or plain text with {{vars}}
 * @param {string} options.emailField - CSV column name for email (default: 'email')
 * @param {string} options.nameField - CSV column name for name (default: 'name')
 * @param {function} options.onProgress - (sent, failed, total, lastError?) => void
 * @returns {Promise<{ sent: number, failed: number, errors: Array }>}
 */
export async function sendCampaign({
  grantId,
  recipients,
  subjectTemplate,
  bodyTemplate,
  emailField = 'email',
  nameField = 'name',
  onProgress = () => {},
}) {
  if (!recipients?.length) {
    return { sent: 0, failed: 0, errors: [] };
  }

  // Normalize field names: CSV headers may have spaces/special chars
  const normalizeKey = (k) => String(k || '').trim().toLowerCase().replace(/\s+/g, '_');

  // Shuffle recipients for random send order
  const shuffled = shuffle(recipients);

  let sent = 0;
  let failed = 0;
  const errors = [];
  const total = shuffled.length;

  for (let i = 0; i < shuffled.length; i += BATCH_SIZE) {
    const batch = shuffled.slice(i, i + BATCH_SIZE);

    // Send batch in parallel
    const results = await Promise.allSettled(
      batch.map(async (row) => {
        const normalizedRow = {};
        for (const [k, v] of Object.entries(row)) {
          normalizedRow[normalizeKey(k)] = v;
        }
        // Also support original keys for flexibility
        Object.assign(normalizedRow, row);

        const email = row[emailField] || normalizedRow.email || normalizedRow.Email;
        if (!email || !String(email).includes('@')) {
          throw new Error(`Invalid or missing email for row: ${JSON.stringify(row)}`);
        }

        const name = row[nameField] || normalizedRow.name || normalizedRow.Name || '';

        const subject = substituteVariables(subjectTemplate, normalizedRow);
        const body = substituteVariables(bodyTemplate, normalizedRow);

        await NylasService.sendMessage(grantId, [{ email, name }], subject, body);
      })
    );

    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'fulfilled') {
        sent++;
      } else {
        failed++;
        errors.push({
          row: batch[j],
          error: results[j].reason?.message || String(results[j].reason),
        });
      }
    }

    onProgress(sent, failed, total, errors[errors.length - 1]?.error);

    // Random delay before next batch (skip after last batch)
    if (i + BATCH_SIZE < shuffled.length) {
      await randomDelay();
    }
  }

  return { sent, failed, errors };
}

export default { sendCampaign };
