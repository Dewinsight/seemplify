import express from 'express'
import { emailService } from '../services/emailService.js'

const router = express.Router()

// POST /api/public/book-demo
router.post('/book-demo', async (req, res) => {
    try {
        const { name, email, company, role, message } = req.body

        if (!name || !email) {
            return res.status(400).json({ error: 'Missing required fields' })
        }

        const senderEmail = process.env.BREVO_SENDER_EMAIL || 'no-reply@seemplifyai.com'
        const senderName = process.env.BREVO_SENDER_NAME || 'Seemplify'

        // Admin Notification Logic
        const adminEmailData = {
            to: 'michael.egbo@aiinnigeria.com',
            subject: `New Demo Request: ${company || 'Unknown Company'}`,
            html: `
        <html>
          <body>
            <h2>New Demo Request</h2>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Company:</strong> ${company || 'N/A'}</p>
            <p><strong>Role:</strong> ${role || 'N/A'}</p>
            <p><strong>Message:</strong></p>
            <p>${message || 'No additional message.'}</p>
          </body>
        </html>
      `
        }

        // Lead Confirmation Logic
        const leadEmailData = {
            to: email,
            subject: `Received: Your Seemplify Demo Request`,
            html: `
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

        console.log(`📨 Processing Demo Request for ${email}`)

        // Send emails in parallel (ignoring user email failure for the response success)
        const adminPromise = emailService.sendEmail(adminEmailData)
            .catch(err => {
                console.error('❌ Failed to send admin notification:', err)
                // We throw here to potentially fail the request if admin email is critical, 
                // or we can swallow it if we want to show success to user.
                // Let's log but return success to user if at least their details are logged.
            })

        const leadPromise = emailService.sendEmail(leadEmailData)
            .catch(err => console.error('❌ Failed to send lead confirmation:', err))

        // Wait for admin email at least, to ensure we have the data? 
        // Actually, best to just await both settlements.
        await Promise.allSettled([adminPromise, leadPromise])

        return res.status(200).json({ success: true, message: 'Demo request received' })

    } catch (error) {
        console.error('❌ Error in /book-demo:', error)
        return res.status(500).json({ error: 'Internal server error' })
    }
})

export default router
