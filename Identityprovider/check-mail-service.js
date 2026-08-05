/**
 * Diagnostic for the self-hosted Seemplify mail service.
 *
 *   node check-mail-service.js                    # configuration only
 *   node check-mail-service.js --send user@example.com
 */
import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(here, '.env') })

const { MailError, mailTransportStatus, sendMail } = await import('./src/services/mailClient.js')
const status = mailTransportStatus()

console.log('Seemplify mail service check')
console.log(`  base URL: ${status.baseUrl || 'not set'}`)
console.log(`  credential: ${status.configured ? 'configured (hidden)' : 'not configured'}`)
console.log(`  sender: ${status.sender || 'not set'}`)
console.log(`  sender name: ${status.senderName || '(none)'}`)

if (!status.configured) {
  console.error(status.reason)
  process.exit(1)
}

const sendIndex = process.argv.indexOf('--send')
const recipient = sendIndex >= 0 ? String(process.argv[sendIndex + 1] || '').trim() : ''
if (!recipient) {
  console.log('Configuration resolves. No message was sent.')
  process.exit(0)
}

try {
  const result = await sendMail({
    from: status.sender,
    fromName: status.senderName,
    to: recipient,
    subject: 'Seemplify mail service check',
    text: 'This message confirms that the Identity Provider can reach the Seemplify mail service.',
    html: '<p>This message confirms that the Identity Provider can reach the Seemplify mail service.</p>',
    tag: 'diagnostic',
    idempotencyKey: `diagnostic:${recipient}:${new Date().toISOString().slice(0, 16)}`
  })
  console.log(`Accepted: status=${result.status} messageId=${result.messageId || '(none)'} replay=${result.idempotentReplay}`)
} catch (error) {
  if (error instanceof MailError) {
    console.error(`${error.message} code=${error.code} status=${error.status ?? 'n/a'} retryable=${error.retryable}`)
  } else {
    console.error(error instanceof Error ? error.message : String(error))
  }
  process.exit(1)
}
