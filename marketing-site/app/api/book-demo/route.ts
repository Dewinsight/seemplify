import { NextResponse } from 'next/server'

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const { name, email, company, role, message } = body

        if (!name || !email) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        const apiKey = process.env.BREVO_API_KEY
        const senderEmail = process.env.BREVO_SENDER_EMAIL || 'hello@seemplifyai.com'
        const senderName = process.env.BREVO_SENDER_NAME || 'Seemplify Demo'

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

        // Send Admin Email
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
            console.error('Failed to send admin email', await adminRes.text())
        }

        // Send Confirmation (Fire and forget, or await)
        await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': apiKey!,
                'content-type': 'application/json'
            },
            body: JSON.stringify(leadEmailData)
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Demo booking error:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
