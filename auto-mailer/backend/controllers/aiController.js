import { Email } from '../models/Email.js';
import { User } from '../models/User.js';
import AzureOpenAIService from '../services/azureOpenAIService.js';
import NylasService from '../services/nylasService.js';

export const generateResponse = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id.toString();

    // Get email from database
    const email = await Email.findByMessageId(messageId);

    if (!email) {
      return res.status(404).json({
        success: false,
        message: 'Email not found',
      });
    }

    // Verify email belongs to user
    if (email.userId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access to email',
      });
    }

    // Generate AI response
    const aiResult = await AzureOpenAIService.generateEmailResponse(
      email.body,
      email.from?.email || '',
      email.from?.name || 'Customer'
    );

    res.json({
      success: true,
      data: {
        suggestedResponse: aiResult.response,
        needsEscalation: aiResult.needsEscalation,
        isMarketing: aiResult.isMarketing || false,
        reason: aiResult.reason || null,
        confidence: aiResult.confidence,
        warning: aiResult.needsEscalation 
          ? 'This email may require human review before responding.' 
          : null,
      },
    });
  } catch (error) {
    console.error('Generate response error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate AI response',
      error: error.message,
    });
  }
};

export const autoRespondAll = async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const user = await User.findById(userId);

    if (!user.nylasGrantId) {
      return res.status(400).json({
        success: false,
        message: 'Email not connected',
      });
    }

    // Get all unread emails
    const unreadEmails = await Email.findByUserId(userId, 100);
    const unrepliedInbox = unreadEmails.filter(e => !e.hasReplied && e.folder === 'inbox');

    if (unrepliedInbox.length === 0) {
      return res.json({
        success: true,
        message: 'No unreplied emails to respond to',
        data: {
          processed: 0,
          responded: 0,
          escalated: 0,
          errors: 0,
        },
      });
    }

    console.log(`🤖 Auto-responding to ${unrepliedInbox.length} unreplied email(s)...`);

    const results = {
      processed: 0,
      responded: 0,
      escalated: 0,
      errors: 0,
      details: [],
    };

    // Process each unreplied email
    for (const email of unrepliedInbox) {
      try {
        results.processed++;

        // Generate AI response
        const aiResult = await AzureOpenAIService.generateEmailResponse(
          email.body,
          email.from?.email || '',
          email.from?.name || 'Customer'
        );

        // Check if needs escalation
        if (aiResult.needsEscalation) {
          console.log(`⚠️  Email "${email.subject}" flagged for escalation`);
          results.escalated++;
          results.details.push({
            messageId: email.messageId,
            subject: email.subject,
            status: 'escalated',
            reason: 'Requires human review',
          });
          continue;
        }

        // Send AI-generated reply
        const response = await NylasService.sendReply(
          user.nylasGrantId,
          email.messageId,
          aiResult.response,
          email.from
        );

        // Mark original email as replied and read
        await Email.markAsReplied(email.messageId);
        await Email.markAsRead(email.messageId);

        // Save the AI-generated sent reply to database
        try {
          const sentEmail = new Email({
            userId,
            messageId: response.id,
            grantId: user.nylasGrantId,
            from: { 
              name: user.name, 
              email: user.nylasEmail || user.email // Use Nylas-connected email
            },
            to: [email.from],
            cc: [],
            subject: email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
            body: aiResult.response,
            snippet: aiResult.response.substring(0, 200),
            receivedAt: new Date(),
            isRead: true,
            threadId: email.threadId,
            folder: 'sent',
          });
          await sentEmail.save();
          console.log('✅ Saved AI-generated reply to database');
        } catch (saveError) {
          console.error('⚠️  Error saving AI reply:', saveError);
        }

        results.responded++;
        results.details.push({
          messageId: email.messageId,
          subject: email.subject,
          status: 'responded',
          response: aiResult.response.substring(0, 100) + '...',
        });

        console.log(`✅ Auto-responded to: ${email.subject}`);

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`❌ Error auto-responding to email ${email.subject}:`, error);
        results.errors++;
        results.details.push({
          messageId: email.messageId,
          subject: email.subject,
          status: 'error',
          error: error.message,
        });
      }
    }

    res.json({
      success: true,
      message: `Auto-response completed. Responded to ${results.responded} out of ${results.processed} emails.`,
      data: results,
    });
  } catch (error) {
    console.error('Auto-respond all error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to auto-respond to emails',
      error: error.message,
    });
  }
};

export const analyzeIntent = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id.toString();

    // Get email from database
    const email = await Email.findByMessageId(messageId);

    if (!email) {
      return res.status(404).json({
        success: false,
        message: 'Email not found',
      });
    }

    // Verify email belongs to user
    if (email.userId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access to email',
      });
    }

    // Analyze intent
    const intent = await AzureOpenAIService.analyzeEmailIntent(email.body);
    const needsEscalation = AzureOpenAIService.checkIfNeedsEscalation(email.body);

    res.json({
      success: true,
      data: {
        intent,
        needsEscalation,
        confidence: 'high',
      },
    });
  } catch (error) {
    console.error('Analyze intent error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze email intent',
      error: error.message,
    });
  }
};

export const getKnowledgeBase = async (req, res) => {
  try {
    const knowledge = AzureOpenAIService.getKnowledgeBase();

    res.json({
      success: true,
      data: knowledge,
    });
  } catch (error) {
    console.error('Get knowledge base error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get knowledge base',
    });
  }
};

