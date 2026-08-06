import { Email } from '../models/Email.js';
import NylasService from '../services/nylasService.js';
import { User } from '../models/User.js';

export const getEmails = async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const limit = parseInt(req.query.limit) || 50;
    const folder = req.query.folder || null; // inbox, sent, or null for all

    const emails = await Email.findByUserId(userId, limit, folder);

    res.json({
      success: true,
      data: {
        emails,
        count: emails.length,
        folder: folder || 'all',
      },
    });
  } catch (error) {
    console.error('Get emails error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch emails',
    });
  }
};

export const getThread = async (req, res) => {
  try {
    const { threadId } = req.params;

    const emails = await Email.findByThreadId(threadId);

    if (!emails || emails.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Thread not found',
      });
    }

    res.json({
      success: true,
      data: {
        thread: emails,
        count: emails.length,
      },
    });
  } catch (error) {
    console.error('Get thread error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch thread',
    });
  }
};

export const getEmailById = async (req, res) => {
  try {
    const { messageId } = req.params;

    const email = await Email.findByMessageId(messageId);

    if (!email) {
      return res.status(404).json({
        success: false,
        message: 'Email not found',
      });
    }

    // Mark as read
    await Email.markAsRead(messageId);

    res.json({
      success: true,
      data: {
        email,
      },
    });
  } catch (error) {
    console.error('Get email by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch email',
    });
  }
};

export const sendReply = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { body } = req.body;
    const userId = req.user._id.toString();

    if (!body || body.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Reply body is required',
      });
    }

    // Get email from database
    const email = await Email.findByMessageId(messageId);

    if (!email) {
      return res.status(404).json({
        success: false,
        message: 'Email not found',
      });
    }

    // Get user's grant ID
    const user = await User.findById(userId);

    console.log('📧 [sendReply] User details:');
    console.log('   User email (platform):', user.email);
    console.log('   Nylas email (connected):', user.nylasEmail || 'NOT SET');
    console.log('   Grant ID:', user.nylasGrantId);

    if (!user.nylasGrantId) {
      return res.status(400).json({
        success: false,
        message: 'Email not connected',
      });
    }

    // Send reply via Nylas
    const response = await NylasService.sendReply(
      user.nylasGrantId,
      messageId,
      body,
      email.from
    );

    console.log('📤 [sendReply] Nylas response - From address:', response.from?.[0]?.email);

    // Mark original email as replied
    await Email.markAsReplied(messageId);

    // Save the sent reply to our database
    try {
      // Use the from address from Nylas response if available, otherwise use nylasEmail
      const fromEmail = response.from?.[0]?.email || user.nylasEmail || user.email;
      const fromName = response.from?.[0]?.name || user.name;

      // Use the formatted HTML body that was sent to Nylas
      const formattedBody = response.formattedBody || body;

      console.log('💾 [sendReply] Saving sent email with from:', fromEmail);
      console.log('   Body format:', formattedBody.includes('<div') ? 'HTML' : 'Plain text');

      const sentEmail = new Email({
        userId,
        messageId: response.id,
        grantId: user.nylasGrantId,
        from: { 
          name: fromName, 
          email: fromEmail // Use actual from address from Nylas response
        },
        to: [email.from],
        cc: [],
        bcc: [],
        subject: email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
        body: formattedBody, // Save the formatted HTML body
        snippet: body.substring(0, 200), // Keep plain text for snippet
        receivedAt: new Date(),
        isRead: true,
        hasReplied: false,
        threadId: email.threadId,
        folder: 'sent',
        attachments: [],
      });

      await sentEmail.save();
      console.log('✅ Saved sent reply to database with from:', fromEmail);
    } catch (saveError) {
      console.error('⚠️  Error saving sent reply:', saveError);
      // Don't fail the request if saving fails - reply was already sent
    }

    res.json({
      success: true,
      message: 'Reply sent successfully',
      data: {
        sentMessage: response,
      },
    });
  } catch (error) {
    console.error('Send reply error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send reply',
    });
  }
};

export const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user._id.toString();

    const count = await Email.getUnreadCount(userId);

    res.json({
      success: true,
      data: {
        unreadCount: count,
      },
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get unread count',
    });
  }
};

