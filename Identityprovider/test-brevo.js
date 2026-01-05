import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load environment variables
dotenv.config({ path: join(__dirname, '.env') })

console.log('🧪 Testing Brevo Email Configuration\n')
console.log('=' .repeat(60))

// Step 1: Check environment variables
console.log('\n📋 Step 1: Checking environment variables...')
const apiKey = process.env.BREVO_API_KEY
const senderEmail = process.env.SENDER_EMAIL || 'michael.egbo@aiinnigeria.com'
const senderName = process.env.SENDER_NAME || 'AIIN Identity'

console.log(`  ✓ BREVO_API_KEY: ${apiKey ? '✅ Set (' + apiKey.substring(0, 10) + '...)' : '❌ NOT SET'}`)
console.log(`  ✓ SENDER_EMAIL: ${senderEmail}`)
console.log(`  ✓ SENDER_NAME: ${senderName}`)

if (!apiKey) {
  console.error('\n❌ ERROR: BREVO_API_KEY is not set in .env file!')
  console.log('\n💡 To fix this:')
  console.log('  1. Open Identityprovider/.env')
  console.log('  2. Set BREVO_API_KEY=your_actual_api_key')
  console.log('  3. Set SENDER_EMAIL=michael.egbo@aiinnigeria.com')
  process.exit(1)
}

// Step 2: Test API Key validity by getting account info
console.log('\n📡 Step 2: Testing API key validity...')
try {
  const accountResponse = await fetch('https://api.brevo.com/v3/account', {
    method: 'GET',
    headers: {
      'accept': 'application/json',
      'api-key': apiKey
    }
  })

  if (!accountResponse.ok) {
    const errorData = await accountResponse.json().catch(() => ({}))
    console.error(`  ❌ API Key Invalid (HTTP ${accountResponse.status})`)
    console.error(`  Error:`, errorData)
    
    if (accountResponse.status === 401) {
      console.log('\n💡 Your API key is invalid or expired.')
      console.log('  Get a new key from: https://app.brevo.com/settings/keys/api')
    }
    process.exit(1)
  }

  const accountData = await accountResponse.json()
  console.log(`  ✅ API Key Valid`)
  console.log(`  Account: ${accountData.email}`)
  console.log(`  Plan: ${accountData.plan?.[0]?.type || 'Unknown'}`)
  
  // Check email credits/limits
  if (accountData.plan?.[0]) {
    const plan = accountData.plan[0]
    console.log(`  Email Credits: ${plan.credits !== undefined ? plan.credits : 'Unlimited'}`)
  }

} catch (error) {
  console.error(`  ❌ Failed to connect to Brevo API:`, error.message)
  process.exit(1)
}

// Step 3: Validate sender email
console.log('\n📧 Step 3: Validating sender email...')
try {
  const sendersResponse = await fetch('https://api.brevo.com/v3/senders', {
    method: 'GET',
    headers: {
      'accept': 'application/json',
      'api-key': apiKey
    }
  })

  if (!sendersResponse.ok) {
    console.error(`  ⚠️  Could not fetch senders list (HTTP ${sendersResponse.status})`)
  } else {
    const sendersData = await sendersResponse.json()
    const senders = sendersData.senders || []
    
    console.log(`  Found ${senders.length} verified sender(s):`)
    senders.forEach(sender => {
      console.log(`    - ${sender.email} (${sender.name})${sender.active ? ' ✅ Active' : ' ⚠️ Inactive'}`)
    })

    // Check if our sender email is in the list
    const isSenderVerified = senders.some(s => s.email.toLowerCase() === senderEmail.toLowerCase())
    
    if (isSenderVerified) {
      console.log(`\n  ✅ Sender email "${senderEmail}" is verified in Brevo`)
    } else {
      console.log(`\n  ⚠️  Sender email "${senderEmail}" is NOT verified in Brevo`)
      console.log(`\n💡 To add this sender:`)
      console.log(`  1. Go to: https://app.brevo.com/settings/senders`)
      console.log(`  2. Add "${senderEmail}" as a sender`)
      console.log(`  3. Verify it by clicking the link in the verification email`)
      console.log(`\n  Note: You can still test sending, but it will use a default verified sender.`)
    }
  }
} catch (error) {
  console.error(`  ⚠️  Could not validate sender:`, error.message)
}

// Step 4: Send a test email
console.log('\n📮 Step 4: Sending test email...')
const testRecipient = senderEmail // Send to yourself for testing

try {
  const emailPayload = {
    sender: {
      name: senderName,
      email: senderEmail
    },
    to: [{ email: testRecipient }],
    subject: '🧪 Brevo Test Email - Identity Provider',
    htmlContent: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 40px auto; padding: 30px; background: #f8f9fa; border-radius: 12px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 8px; color: white; text-align: center; margin-bottom: 30px; }
          .content { background: white; padding: 30px; border-radius: 8px; }
          .success { background: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 8px; color: #155724; margin: 20px 0; }
          .info { background: #d1ecf1; border: 1px solid #bee5eb; padding: 15px; border-radius: 8px; color: #0c5460; margin: 20px 0; }
          .footer { text-align: center; color: #6c757d; font-size: 12px; margin-top: 30px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0; font-size: 28px;">✅ Email Test Successful!</h1>
          </div>
          <div class="content">
            <h2>Brevo Configuration Test</h2>
            <div class="success">
              <strong>✓ Success!</strong> Your Brevo email service is properly configured.
            </div>
            <div class="info">
              <h3 style="margin-top: 0;">Configuration Details:</h3>
              <ul style="margin: 10px 0;">
                <li><strong>Sender:</strong> ${senderEmail}</li>
                <li><strong>Sender Name:</strong> ${senderName}</li>
                <li><strong>Service:</strong> Brevo (Sendinblue)</li>
              </ul>
            </div>
            <p>This test email confirms that your Identity Provider can successfully send emails through Brevo.</p>
            <p><strong>What this means:</strong></p>
            <ul>
              <li>User invitations will be sent successfully ✅</li>
              <li>Organization invites will be delivered ✅</li>
              <li>Email notifications are working ✅</li>
            </ul>
          </div>
          <div class="footer">
            <p>Sent from Identity Provider Test Script</p>
            <p>${new Date().toLocaleString()}</p>
          </div>
        </div>
      </body>
      </html>
    `,
    textContent: `
EMAIL TEST SUCCESSFUL!

Your Brevo email service is properly configured.

Configuration Details:
- Sender: ${senderEmail}
- Sender Name: ${senderName}
- Service: Brevo (Sendinblue)

This test email confirms that your Identity Provider can successfully send emails through Brevo.

Sent: ${new Date().toLocaleString()}
    `
  }

  console.log(`  Sending test email to: ${testRecipient}`)
  
  const sendResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json'
    },
    body: JSON.stringify(emailPayload)
  })

  if (!sendResponse.ok) {
    const errorData = await sendResponse.json().catch(() => ({}))
    console.error(`  ❌ Failed to send email (HTTP ${sendResponse.status})`)
    console.error(`  Error:`, JSON.stringify(errorData, null, 2))
    
    if (errorData.code === 'unauthorized_sender' || errorData.message?.includes('sender')) {
      console.log(`\n💡 Sender email "${senderEmail}" needs to be verified in Brevo:`)
      console.log(`  1. Go to: https://app.brevo.com/settings/senders`)
      console.log(`  2. Add and verify "${senderEmail}"`)
    }
    process.exit(1)
  }

  const sendResult = await sendResponse.json()
  console.log(`  ✅ Email sent successfully!`)
  console.log(`  Message ID: ${sendResult.messageId}`)
  
} catch (error) {
  console.error(`  ❌ Error sending test email:`, error.message)
  process.exit(1)
}

// Final Summary
console.log('\n' + '='.repeat(60))
console.log('✅ ALL TESTS PASSED!')
console.log('='.repeat(60))
console.log('\n📧 Your Brevo email configuration is working correctly.')
console.log(`\n📬 Check your inbox at: ${testRecipient}`)
console.log('   (Check spam folder if you don\'t see it)')
console.log('\n🎉 You can now send invitation emails from the Identity Provider!\n')
