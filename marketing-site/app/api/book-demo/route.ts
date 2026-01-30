import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { name, email, company, role, message } = body

    if (!name || !email) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const apiKey = process.env.BREVO_API_KEY
    const senderEmail = process.env.BREVO_SENDER_EMAIL || 'no-reply@seemplifyai.com'
    const senderName = process.env.BREVO_SENDER_NAME || 'Seemplify'

    // Email to Michael (Admin)
    const adminEmailData = {
      sender: { name: senderName, email: senderEmail },
      to: [{ email: 'michael.egbo@aiinnigeria.com', name: 'Michael Egbo' }],
      subject: `New Demo Request: ${company}`,
      htmlContent: `
        <html>
          <body>
            <h2>New Demo Request</h2>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Company:</strong> ${company}</p>
            <p><strong>Role:</strong> ${role}</p>
            <p><strong>Message:</strong></p>
            <p>${message || 'No additional message.'}</p>
          </body>
        </html>
      `
    }

    // Confirmation email to Lead
    const leadEmailData = {
      sender: { name: 'Seemplify Team', email: senderEmail },
      to: [{ email: email, name: name }],
      subject: `Received: Your Seemplify Demo Request`,
      htmlContent: `
        <html>
          <body>
            <h2>Hi ${name},</h2>
            <p>Thanks for requesting a demo of Seemplify. We've received your details and will be in touch shortly to schedule a walkthrough.</p>
            <br>
            <p>Best,</p>
            <p>The Seemplify Team</p>
          </body>
        </html>
      `
    }

    console.log(`Preparing to send emails. API Key length: ${apiKey?.length || 0}, Sender: ${senderEmail}`)

    // Send Admin Email
    console.log('Sending admin email to michael.egbo@aiinnigeria.com...')
    const adminRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey!,
        'content-type': 'application/json'
      },
      body: JSON.stringify(adminEmailData)
    })

    if (!adminRes.ok) {
      const errorText = await adminRes.text()
      console.error('FAILED to send admin email. Status:', adminRes.status, 'Body:', errorText)
      return NextResponse.json({ error: 'Failed to send admin email', details: errorText }, { status: 500 })
    } else {
      console.log('Admin email sent successfully.')
    }

    // Send Confirmation
    console.log(`Sending confirmation email to ${email}...`)
    const leadRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey!,
        'content-type': 'application/json'
      },
      body: JSON.stringify(leadEmailData)
    })

    if (!leadRes.ok) {
      const errorText = await leadRes.text()
      console.error('FAILED to send lead email. Status:', leadRes.status, 'Body:', errorText)
    } else {
      console.log('Confirmation email sent successfully.')
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Demo booking error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
