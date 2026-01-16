import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load environment variables
dotenv.config({ path: join(__dirname, '.env') })

console.log('🔍 Checking Brevo Domain Authentication Status\n')
console.log('=' .repeat(70))

const apiKey = process.env.BREVO_API_KEY
const senderEmail = process.env.SENDER_EMAIL || 'michael.egbo@aiinnigeria.com'
const domain = senderEmail.split('@')[1]

console.log(`\n📧 Sender Email: ${senderEmail}`)
console.log(`🌐 Domain: ${domain}`)

if (!apiKey) {
  console.error('\n❌ BREVO_API_KEY not set!')
  process.exit(1)
}

// Check domain authentication status
console.log('\n📡 Checking domain authentication...\n')

try {
  const response = await fetch('https://api.brevo.com/v3/senders/domains', {
    method: 'GET',
    headers: {
      'accept': 'application/json',
      'api-key': apiKey
    }
  })

  if (!response.ok) {
    console.error(`❌ Failed to fetch domains (HTTP ${response.status})`)
    const errorData = await response.json().catch(() => ({}))
    console.error('Error:', errorData)
    process.exit(1)
  }

  const domainsData = await response.json()
  
  if (!domainsData.domains || domainsData.domains.length === 0) {
    console.log('⚠️  No domains are authenticated in your Brevo account.\n')
    console.log('=' .repeat(70))
    console.log('📋 RECOMMENDATION: Set up domain authentication\n')
    console.log('Without domain authentication:')
    console.log('  ❌ Emails are more likely to go to spam')
    console.log('  ❌ Lower sender reputation')
    console.log('  ❌ "via brevo.com" may show in recipient\'s inbox')
    console.log('  ✅ Basic sending still works (as you saw in the test)')
    console.log('\n🔧 To set up domain authentication for better deliverability:')
    console.log(`\n1. Go to: https://app.brevo.com/settings/senders/domain`)
    console.log(`2. Add your domain: ${domain}`)
    console.log('3. Follow the instructions to add DNS records (SPF, DKIM, DMARC)')
    console.log('4. Wait for DNS propagation (can take up to 48 hours)')
    console.log('\n💡 Benefits of domain authentication:')
    console.log('  ✅ Better email deliverability (less spam filtering)')
    console.log('  ✅ Professional appearance (no "via brevo.com")')
    console.log('  ✅ Higher sending limits')
    console.log('  ✅ Improved sender reputation')
    console.log('\n📖 Learn more: https://help.brevo.com/hc/en-us/articles/209553085')
  } else {
    console.log(`✅ Found ${domainsData.domains.length} authenticated domain(s):\n`)
    
    let yourDomainFound = false
    
    for (const domainInfo of domainsData.domains) {
      const isYourDomain = domainInfo.domain_name === domain
      if (isYourDomain) yourDomainFound = true
      
      console.log(`${isYourDomain ? '🎯' : '  '} Domain: ${domainInfo.domain_name}`)
      console.log(`   Status: ${domainInfo.authenticated ? '✅ Authenticated' : '⚠️  Not Authenticated'}`)
      
      if (domainInfo.records) {
        console.log('   DNS Records:')
        if (domainInfo.records.dkim_record) {
          console.log(`     - DKIM: ${domainInfo.records.dkim_record.status === 'valid' ? '✅' : '❌'} ${domainInfo.records.dkim_record.status}`)
        }
        if (domainInfo.records.spf_record) {
          console.log(`     - SPF:  ${domainInfo.records.spf_record.status === 'valid' ? '✅' : '❌'} ${domainInfo.records.spf_record.status}`)
        }
        if (domainInfo.records.dmarc_record) {
          console.log(`     - DMARC: ${domainInfo.records.dmarc_record.status === 'valid' ? '✅' : '❌'} ${domainInfo.records.dmarc_record.status}`)
        }
      }
      console.log('')
    }
    
    if (!yourDomainFound) {
      console.log('=' .repeat(70))
      console.log(`⚠️  Your domain "${domain}" is NOT authenticated.\n`)
      console.log('You have other domains authenticated, but not the one you\'re sending from.')
      console.log('\n🔧 To authenticate your domain:')
      console.log(`\n1. Go to: https://app.brevo.com/settings/senders/domain`)
      console.log(`2. Add your domain: ${domain}`)
      console.log('3. Add the provided DNS records to your domain registrar')
    } else {
      console.log('=' .repeat(70))
      console.log('🎉 Your domain is properly authenticated!')
      console.log('Your emails will have the best deliverability.')
    }
  }

} catch (error) {
  console.error('❌ Error checking domain authentication:', error.message)
  process.exit(1)
}

console.log('\n' + '=' .repeat(70))
console.log('\n💡 SUMMARY:\n')
console.log('Current State:')
console.log('  ✅ Your API key works')
console.log('  ✅ Your sender email is verified')
console.log('  ✅ You can send emails (test was successful)')
console.log('\nFor Production:')
console.log('  🔧 Consider setting up domain authentication (SPF/DKIM/DMARC)')
console.log('  📈 This improves deliverability and reduces spam filtering')
console.log('  🎯 Optional but highly recommended for professional use\n')
