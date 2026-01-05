const BREVO_API_KEY = process.env.BREVO_API_KEY || ''

console.log('Testing Brevo API endpoints...\n')

// Test 1: List existing domains
console.log('1. Listing existing domains:')
try {
  const response = await fetch('https://api.brevo.com/v3/senders/domains', {
    method: 'GET',
    headers: {
      'accept': 'application/json',
      'api-key': BREVO_API_KEY
    }
  })
  
  const data = await response.json()
  console.log(JSON.stringify(data, null, 2))
} catch (error) {
  console.error('Error:', error.message)
}

// Test 2: Try to add domain with correct format
console.log('\n2. Trying to add seemplifyai.com domain:')
try {
  const response = await fetch('https://api.brevo.com/v3/senders/domains', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': BREVO_API_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      domain: 'seemplifyai.com'
    })
  })
  
  console.log('Status:', response.status)
  const data = await response.json()
  console.log(JSON.stringify(data, null, 2))
} catch (error) {
  console.error('Error:', error.message)
}
