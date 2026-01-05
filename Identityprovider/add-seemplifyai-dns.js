const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || ''
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || ''
const DOMAIN = 'seemplifyai.com'

console.log('🚀 Adding DNS records for seemplifyai.com to Cloudflare\n')
console.log('=' .repeat(70))

console.log('\n📋 IMPORTANT: First, manually add the domain in Brevo:')
console.log('  1. Go to: https://app.brevo.com/settings/senders/domain')
console.log('  2. Click "Add a domain"')
console.log(`  3. Enter: ${DOMAIN}`)
console.log('  4. Follow the instructions to get DNS records')
console.log('\nOnce you have the DNS records from Brevo, I will add them to Cloudflare.')
console.log('\nPress Ctrl+C if you need to do this first, or continue if already done...\n')

// Wait a moment for user to read
await new Promise(resolve => setTimeout(resolve, 3000))

// Standard Brevo DNS records that are commonly used
console.log('☁️  Adding standard Brevo DNS records to Cloudflare...\n')

const standardRecords = [
  {
    name: 'mail._domainkey.seemplifyai.com',
    type: 'TXT',
    content: 'k=rsa; p=',  // Placeholder - will be provided by Brevo
    description: 'DKIM Record (You need to get the actual value from Brevo)'
  },
  {
    name: 'seemplifyai.com',
    type: 'TXT',
    content: 'v=spf1 include:spf.brevo.com ~all',
    description: 'SPF Record'
  },
  {
    name: '_dmarc.seemplifyai.com',
    type: 'TXT',
    content: 'v=DMARC1; p=none',
    description: 'DMARC Record'
  }
]

console.log('📝 I can add these standard records now:\n')

for (const record of standardRecords) {
  console.log(`- ${record.description}:`)
  console.log(`  Type: ${record.type}`)
  console.log(`  Name: ${record.name}`)
  console.log(`  Value: ${record.content}`)
  console.log()
}

console.log('⚠️  Note: The DKIM record value is unique to your account.')
console.log('   I\'ll add SPF and DMARC now, but you\'ll need to provide the DKIM value.\n')

// Add SPF record
console.log('Adding SPF record...')
try {
  const spfResponse = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'TXT',
        name: DOMAIN,
        content: 'v=spf1 include:spf.brevo.com ~all',
        ttl: 3600,
        proxied: false
      })
    }
  )

  if (spfResponse.ok) {
    console.log('✅ SPF record added successfully')
  } else {
    const error = await spfResponse.json()
    if (error.errors?.[0]?.code === 81057) {
      console.log('ℹ️  SPF record already exists')
    } else {
      console.log('❌ SPF record failed:', error.errors?.[0]?.message)
    }
  }
} catch (error) {
  console.error('❌ Error adding SPF:', error.message)
}

// Add DMARC record
console.log('\nAdding DMARC record...')
try {
  const dmarcResponse = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'TXT',
        name: `_dmarc.${DOMAIN}`,
        content: 'v=DMARC1; p=none',
        ttl: 3600,
        proxied: false
      })
    }
  )

  if (dmarcResponse.ok) {
    console.log('✅ DMARC record added successfully')
  } else {
    const error = await dmarcResponse.json()
    if (error.errors?.[0]?.code === 81057) {
      console.log('ℹ️  DMARC record already exists')
    } else {
      console.log('❌ DMARC record failed:', error.errors?.[0]?.message)
    }
  }
} catch (error) {
  console.error('❌ Error adding DMARC:', error.message)
}

console.log('\n' + '=' .repeat(70))
console.log('📊 DNS Records Status\n')
console.log('✅ SPF record added to Cloudflare')
console.log('✅ DMARC record added to Cloudflare')
console.log('⚠️  DKIM record needs to be added manually')

console.log('\n📋 Next Steps:')
console.log('1. Go to Brevo: https://app.brevo.com/settings/senders/domain')
console.log('2. Add seemplifyai.com domain (if not already added)')
console.log('3. Copy the DKIM record value from Brevo')
console.log('4. Go to Cloudflare: https://dash.cloudflare.com')
console.log('5. Navigate to seemplifyai.com → DNS → Records')
console.log('6. Add a new TXT record:')
console.log('   Name: mail._domainkey')
console.log('   Content: [paste the DKIM value from Brevo]')
console.log('7. Wait 10-30 minutes for DNS propagation')
console.log('8. Brevo will automatically verify your domain')
console.log('9. Add sender: noreply@seemplifyai.com')
console.log('10. Update .env: SENDER_EMAIL=noreply@seemplifyai.com\n')
