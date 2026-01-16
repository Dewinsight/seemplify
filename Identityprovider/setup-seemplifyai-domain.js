import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load environment variables
dotenv.config({ path: join(__dirname, '.env') })

// Configuration
const BREVO_API_KEY = process.env.BREVO_API_KEY || ''
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || ''
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || ''
const DOMAIN = 'seemplifyai.com'
const SENDER_EMAIL = 'noreply@seemplifyai.com'
const SENDER_NAME = 'Seemplify'

console.log('🚀 Setting up seemplifyai.com domain for email sending\n')
console.log('=' .repeat(70))

// Step 1: Add domain to Brevo for authentication (must be done FIRST)
console.log('\n🌐 Step 1: Adding domain to Brevo for authentication...')
try {
  const addDomainResponse = await fetch('https://api.brevo.com/v3/senders/domains', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': BREVO_API_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      domain: DOMAIN  // Correct parameter name is 'domain', not 'domain_name'
    })
  })

  if (!addDomainResponse.ok) {
    const errorData = await addDomainResponse.json().catch(() => ({}))
    if (addDomainResponse.status === 400 && (errorData.code === 'duplicate_parameter' || errorData.message?.includes('already'))) {
      console.log(`  ℹ️  Domain ${DOMAIN} already exists in Brevo`)
    } else {
      console.error(`  ⚠️  Could not add domain (HTTP ${addDomainResponse.status}):`, errorData)
      console.log(`  ℹ️  Continuing anyway - domain may already exist...`)
    }
  } else {
    const result = await addDomainResponse.json()
    console.log(`  ✅ Domain added: ${DOMAIN}`)
    console.log(`     Domain ID: ${result.id}`)
  }
} catch (error) {
  console.error(`  ❌ Error adding domain:`, error.message)
  console.log(`  ℹ️  Continuing anyway...`)
}

// Step 2: Get DNS records from Brevo
console.log('\n📋 Step 2: Getting DNS records from Brevo...')
let dnsRecords = []
try {
  const domainsResponse = await fetch('https://api.brevo.com/v3/senders/domains', {
    method: 'GET',
    headers: {
      'accept': 'application/json',
      'api-key': BREVO_API_KEY
    }
  })

  if (!domainsResponse.ok) {
    throw new Error(`Failed to fetch domains (HTTP ${domainsResponse.status})`)
  }

  const domainsData = await domainsResponse.json()
  const domainInfo = domainsData.domains?.find(d => d.domain_name === DOMAIN)

  if (!domainInfo) {
    throw new Error(`Domain ${DOMAIN} not found in Brevo`)
  }

  console.log(`  ✅ Found domain: ${DOMAIN}`)
  console.log(`     Status: ${domainInfo.authenticated ? '✅ Authenticated' : '⚠️  Not Authenticated'}`)

  // Extract DNS records
  if (domainInfo.dns_records) {
    console.log('\n  📝 DNS Records to add:')
    
    // DKIM Record
    if (domainInfo.dns_records.dkim_record) {
      const dkim = domainInfo.dns_records.dkim_record
      dnsRecords.push({
        type: 'TXT',
        name: dkim.record_name || `mail._domainkey.${DOMAIN}`,
        content: dkim.record_value,
        recordType: 'DKIM'
      })
      console.log(`\n  🔐 DKIM Record:`)
      console.log(`     Type: TXT`)
      console.log(`     Name: ${dkim.record_name || 'mail._domainkey'}`)
      console.log(`     Value: ${dkim.record_value?.substring(0, 50)}...`)
    }

    // SPF Record
    if (domainInfo.dns_records.spf_record) {
      const spf = domainInfo.dns_records.spf_record
      dnsRecords.push({
        type: 'TXT',
        name: DOMAIN,
        content: spf.record_value,
        recordType: 'SPF'
      })
      console.log(`\n  📬 SPF Record:`)
      console.log(`     Type: TXT`)
      console.log(`     Name: @`)
      console.log(`     Value: ${spf.record_value}`)
    }

    // DMARC Record
    if (domainInfo.dns_records.dmarc_record) {
      const dmarc = domainInfo.dns_records.dmarc_record
      dnsRecords.push({
        type: 'TXT',
        name: `_dmarc.${DOMAIN}`,
        content: dmarc.record_value,
        recordType: 'DMARC'
      })
      console.log(`\n  🛡️  DMARC Record:`)
      console.log(`     Type: TXT`)
      console.log(`     Name: _dmarc`)
      console.log(`     Value: ${dmarc.record_value}`)
    }
  }

} catch (error) {
  console.error(`  ❌ Error getting DNS records:`, error.message)
  process.exit(1)
}

// Step 3: Add DNS records to Cloudflare
console.log('\n☁️  Step 3: Adding DNS records to Cloudflare...')
const cloudflareResults = []

for (const record of dnsRecords) {
  try {
    console.log(`\n  Adding ${record.recordType} record...`)
    
    // Check if record already exists
    const existingResponse = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records?type=${record.type}&name=${record.name}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    )

    if (existingResponse.ok) {
      const existingData = await existingResponse.json()
      if (existingData.result && existingData.result.length > 0) {
        // Record exists, update it
        const existingRecord = existingData.result[0]
        const updateResponse = await fetch(
          `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${existingRecord.id}`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              type: record.type,
              name: record.name,
              content: record.content,
              ttl: 3600,
              proxied: false
            })
          }
        )

        if (updateResponse.ok) {
          console.log(`  ✅ ${record.recordType} record updated`)
          cloudflareResults.push({ type: record.recordType, status: 'updated' })
        } else {
          const errorData = await updateResponse.json()
          console.error(`  ❌ Failed to update ${record.recordType}:`, errorData.errors?.[0]?.message || 'Unknown error')
          cloudflareResults.push({ type: record.recordType, status: 'failed', error: errorData.errors?.[0]?.message })
        }
        continue
      }
    }

    // Record doesn't exist, create it
    const createResponse = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: record.type,
          name: record.name,
          content: record.content,
          ttl: 3600,
          proxied: false
        })
      }
    )

    if (createResponse.ok) {
      console.log(`  ✅ ${record.recordType} record created`)
      cloudflareResults.push({ type: record.recordType, status: 'created' })
    } else {
      const errorData = await createResponse.json()
      console.error(`  ❌ Failed to create ${record.recordType}:`, errorData.errors?.[0]?.message || 'Unknown error')
      cloudflareResults.push({ type: record.recordType, status: 'failed', error: errorData.errors?.[0]?.message })
    }

  } catch (error) {
    console.error(`  ❌ Error adding ${record.recordType}:`, error.message)
    cloudflareResults.push({ type: record.recordType, status: 'error', error: error.message })
  }
}

// Step 4: Add sender email to Brevo (after DNS setup)
console.log('\n📧 Step 4: Adding sender email to Brevo...')
console.log('  ℹ️  Waiting 10 seconds for DNS propagation before adding sender...')
await new Promise(resolve => setTimeout(resolve, 10000))

try {
  const addSenderResponse = await fetch('https://api.brevo.com/v3/senders', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': BREVO_API_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      name: SENDER_NAME,
      email: SENDER_EMAIL
    })
  })

  if (!addSenderResponse.ok) {
    const errorData = await addSenderResponse.json().catch(() => ({}))
    if (addSenderResponse.status === 400 && errorData.code === 'duplicate_parameter') {
      console.log(`  ℹ️  Sender ${SENDER_EMAIL} already exists in Brevo`)
    } else {
      console.error(`  ⚠️  Could not add sender (HTTP ${addSenderResponse.status}):`, errorData)
      console.log(`  💡 DNS records may need more time to propagate`)
      console.log(`  💡 You can manually add this sender later at: https://app.brevo.com/settings/senders`)
    }
  } else {
    const result = await addSenderResponse.json()
    console.log(`  ✅ Sender added: ${SENDER_EMAIL}`)
    console.log(`     Verification email sent to: ${SENDER_EMAIL}`)
    console.log(`     ⚠️  You must verify this email before sending!`)
  }
} catch (error) {
  console.error(`  ❌ Error adding sender:`, error.message)
}

// Summary
console.log('\n' + '=' .repeat(70))
console.log('📊 SUMMARY\n')
console.log('Domain Authentication:')
console.log(`  ✅ ${DOMAIN} added to Brevo`)
console.log('\nDNS Records (Added to Cloudflare):')
cloudflareResults.forEach(result => {
  const icon = result.status === 'created' || result.status === 'updated' ? '✅' : '❌'
  console.log(`  ${icon} ${result.type}: ${result.status}`)
  if (result.error) {
    console.log(`      Error: ${result.error}`)
  }
})

console.log('\nSender Email:')
console.log(`  📧 ${SENDER_EMAIL}`)

console.log('\n⏱️  Next Steps:')
console.log('  1. Wait 10-30 minutes for DNS propagation to complete')
console.log('  2. Check Brevo dashboard: https://app.brevo.com/settings/senders/domain')
console.log('  3. Verify sender email by clicking link in your inbox')
console.log('  4. Update .env files to use noreply@seemplifyai.com:')
console.log('     - Identityprovider/.env: SENDER_EMAIL=noreply@seemplifyai.com')
console.log('  5. Test by running: node test-brevo.js')

console.log('\n🎉 Setup complete!\n')
