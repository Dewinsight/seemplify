import { User } from '../models/User.js';
import { Email } from '../models/Email.js';
import NylasService from './nylasService.js';

class EmailPollingService {
  constructor(io) {
    this.io = io;
    this.pollingInterval = null;
    this.isPolling = false;
  }

  // Start polling for new emails
  start() {
    if (this.isPolling) {
      console.log('⏰ Email polling is already running');
      return;
    }

    console.log('🚀 Starting email polling service (10-second intervals)');
    this.isPolling = true;

    // Poll immediately
    this.pollAllUsers();

    // Then poll every 10 seconds
    this.pollingInterval = setInterval(() => {
      this.pollAllUsers();
    }, 10000); // 10 seconds
  }

  // Stop polling
  stop() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      this.isPolling = false;
      console.log('⏸️  Email polling service stopped');
    }
  }

  // Poll all connected users for new emails
  async pollAllUsers() {
    try {
      const db = await import('../config/database.js').then(m => m.getDatabase());
      const users = db.collection('users');

      // Find all users with connected email
      const connectedUsers = await users.find({
        emailConnected: true,
        nylasGrantId: { $ne: null },
      }).toArray();

      if (connectedUsers.length === 0) {
        return;
      }

      console.log(`📧 Polling ${connectedUsers.length} connected user(s) for new emails...`);

      // Poll each user
      for (const user of connectedUsers) {
        await this.pollUserEmails(user);
      }
    } catch (error) {
      console.error('❌ Error polling users:', error);
    }
  }

  // Poll single user for new emails
  async pollUserEmails(user) {
    try {
      const grantId = user.nylasGrantId;
      const userId = user._id.toString();
      
      // Check if this is first time polling (no lastEmailCheck)
      if (!user.lastEmailCheck) {
        console.log(`🔄 Initial sync for ${user.email} - loading last 50 emails`);
        await this.initialSync(userId, grantId);
        
        // Set lastEmailCheck to now
        await User.updateById(userId, {
          lastEmailCheck: new Date(),
        });
        return;
      }

      const lastCheck = new Date(user.lastEmailCheck);

      // Fetch new inbox messages
      const newMessages = await NylasService.fetchMessages(grantId, lastCheck);

      let latestEmailTime = lastCheck;

      if (newMessages.length > 0) {
        console.log(`📬 Found ${newMessages.length} new email(s) for ${user.email}`);

        for (const message of newMessages) {
          await this.processNewEmail(message, userId, grantId, 'inbox');
          
          // Track the latest email timestamp
          const msgDate = new Date(message.date * 1000);
          if (msgDate > latestEmailTime) {
            latestEmailTime = msgDate;
          }
        }

        // Only update lastEmailCheck if we actually found emails
        // Use the latest email's timestamp, not current time
        await User.updateById(userId, {
          lastEmailCheck: latestEmailTime,
        });
      }

      // Also check sent folder (less frequently - every 30 seconds)
      const shouldCheckSent = !user.lastSentCheck || 
        (new Date() - new Date(user.lastSentCheck)) > 30000;
      
      if (shouldCheckSent) {
        const sentMessages = await NylasService.fetchSentMessages(grantId, 5);
        for (const message of sentMessages) {
          await this.processNewEmail(message, userId, grantId, 'sent');
        }
        
        await User.updateById(userId, {
          lastSentCheck: new Date(),
        });
      }
    } catch (error) {
      console.error(`❌ Error polling emails for user ${user.email}:`, error);
    }
  }

  // Initial sync - load last 50 emails from inbox and sent
  async initialSync(userId, grantId) {
    try {
      console.log('   📥 Syncing inbox...');
      const inboxMessages = await NylasService.fetchMessages(grantId, null);
      
      for (const message of inboxMessages) {
        await this.processNewEmail(message, userId, grantId, 'inbox');
      }

      console.log('   📤 Syncing sent folder...');
      const sentMessages = await NylasService.fetchSentMessages(grantId, 50);
      
      for (const message of sentMessages) {
        await this.processNewEmail(message, userId, grantId, 'sent');
      }

      console.log('   ✅ Initial sync complete');
    } catch (error) {
      console.error('❌ Error in initial sync:', error);
    }
  }

  // Process and store new email
  async processNewEmail(message, userId, grantId, folder = 'inbox') {
    try {
      // Check if email already exists
      const existing = await Email.findByMessageId(message.id);
      if (existing) {
        return; // Skip if already processed
      }

      // If body is missing or empty, fetch the full message
      let fullMessage = message;
      if (!message.body || message.body.trim().length === 0) {
        try {
          console.log(`   📖 Fetching full message body for: ${message.subject}`);
          fullMessage = await NylasService.getMessage(grantId, message.id);
        } catch (err) {
          console.error('   ⚠️  Could not fetch full message:', err.message);
          // Continue with what we have
        }
      }

      // Format and save email
      const formattedEmail = NylasService.formatMessage(fullMessage, folder);
      
      const newEmail = new Email({
        userId,
        grantId,
        ...formattedEmail,
      });

      await newEmail.save();

      // Emit real-time event to frontend (only for inbox)
      if (folder === 'inbox') {
        this.io.to(userId).emit('new-email', {
          email: {
            _id: newEmail._id,
            messageId: newEmail.messageId,
            from: newEmail.from,
            subject: newEmail.subject,
            snippet: newEmail.snippet,
            receivedAt: newEmail.receivedAt,
            isRead: false,
            folder: newEmail.folder,
          },
        });
      }

      console.log(`✉️  Saved ${folder} email: ${newEmail.subject}`);
    } catch (error) {
      console.error('❌ Error processing new email:', error);
    }
  }
}

export default EmailPollingService;

