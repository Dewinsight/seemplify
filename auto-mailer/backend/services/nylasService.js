import Nylas from 'nylas';
import dotenv from 'dotenv';

dotenv.config();

const resolveEnv = (...keys) => {
  for (const key of keys) {
    const value = process.env[key];
    if (value && String(value).trim().length > 0) {
      return value;
    }
  }
  return undefined;
};

const NYLAS_API_KEY = resolveEnv('AUTO_MAILER_NYLAS_API_KEY', 'NYLAS_API_KEY');
const NYLAS_API_URI = resolveEnv('AUTO_MAILER_NYLAS_API_URI', 'NYLAS_API_URI') || 'https://api.us.nylas.com';
const NYLAS_CLIENT_ID = resolveEnv('AUTO_MAILER_NYLAS_CLIENT_ID', 'NYLAS_CLIENT_ID');
const NYLAS_CLIENT_SECRET = resolveEnv('AUTO_MAILER_NYLAS_CLIENT_SECRET', 'NYLAS_CLIENT_SECRET');
const NYLAS_REDIRECT_URI = resolveEnv('AUTO_MAILER_NYLAS_REDIRECT_URI', 'NYLAS_REDIRECT_URI');

if (!NYLAS_API_KEY) {
  console.warn('⚠️  Missing Nylas API key. Set AUTO_MAILER_NYLAS_API_KEY or NYLAS_API_KEY.');
}

// Initialize Nylas client
const nylasClient = new Nylas({
  apiKey: NYLAS_API_KEY,
  apiUri: NYLAS_API_URI,
});

export class NylasService {
  // Get authorization URL for OAuth
  static getAuthorizationUrl(redirectUri, state) {
    const authUrl = `https://api.us.nylas.com/v3/connect/auth?client_id=${NYLAS_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&access_type=offline&state=${state}`;
    return authUrl;
  }

  // Exchange authorization code for grant
  static async exchangeCodeForGrant(code) {
    try {
      const response = await nylasClient.auth.exchangeCodeForToken({
        clientId: NYLAS_CLIENT_ID,
        clientSecret: NYLAS_CLIENT_SECRET,
        redirectUri: NYLAS_REDIRECT_URI,
        code,
      });

      console.log('🔑 Grant exchange response:', JSON.stringify(response, null, 2));

      const grantId = response.grantId || response.id;
      let email = response.email;

      // If email is not in the response, fetch grant details to get it
      if (!email && grantId) {
        console.log('   Email not in response, fetching grant details...');
        const grantDetails = await this.getGrantDetails(grantId);
        email = grantDetails.email;
      }

      console.log('   Extracted Grant ID:', grantId);
      console.log('   Extracted Email:', email);

      return {
        grantId,
        email,
      };
    } catch (error) {
      console.error('Error exchanging code for grant:', error);
      throw error;
    }
  }

  // Get grant details including connected email address
  static async getGrantDetails(grantId) {
    try {
      const response = await nylasClient.grants.find({
        grantId,
      });

      console.log('📧 Grant details:', JSON.stringify(response, null, 2));
      
      return {
        email: response.data?.email || response.data?.grantEmail || response.data?.emailAddress,
        provider: response.data?.provider,
        status: response.data?.grantStatus,
      };
    } catch (error) {
      console.error('Error fetching grant details:', error);
      throw error;
    }
  }

  // Fetch messages from inbox (polling)
  static async fetchMessages(grantId, lastCheckTime = null) {
    try {
      console.log(`📬 Fetching messages for grant: ${grantId}`);
      
      const queryParams = {
        limit: 20,
        select: 'id,subject,from,to,cc,bcc,date,thread_id,snippet,body,attachments,folders,labels',
      };

      // Only fetch emails received after last check (timestamp in seconds)
      if (lastCheckTime) {
        const timestamp = Math.floor(new Date(lastCheckTime).getTime() / 1000);
        queryParams.received_after = timestamp;
        console.log(`   ⏰ Checking emails after: ${new Date(lastCheckTime).toISOString()}`);
      }

      const response = await nylasClient.messages.list({
        identifier: grantId,
        queryParams,
      });

      console.log(`   📧 Found ${response.data?.length || 0} message(s)`);

      if (!response.data || response.data.length === 0) {
        return [];
      }

      // Filter out spam and promotional emails
      const filteredMessages = response.data.filter((msg) => {
        const folders = msg.folders || [];
        
        // Check system labels for Gmail
        const systemLabels = msg.system_labels || [];
        
        // Skip spam, trash, and promotional
        const isSpam = systemLabels.includes('spam') || systemLabels.includes('trash');
        const isPromo = systemLabels.includes('promotions') || systemLabels.includes('category_promotions');
        
        // Also check folders
        const isSpamFolder = folders.some(f => f.name && (
          f.name.toLowerCase().includes('spam') ||
          f.name.toLowerCase().includes('trash') ||
          f.name.toLowerCase().includes('junk')
        ));
        
        return !isSpam && !isPromo && !isSpamFolder;
      });

      console.log(`   ✅ After filtering: ${filteredMessages.length} message(s)`);
      return filteredMessages;
    } catch (error) {
      console.error('❌ Error fetching messages:', error.message);
      console.error('   Grant ID:', grantId);
      throw error;
    }
  }

  // Get single message details
  static async getMessage(grantId, messageId) {
    try {
      const message = await nylasClient.messages.find({
        identifier: grantId,
        messageId,
      });

      return message.data;
    } catch (error) {
      console.error('Error getting message:', error);
      throw error;
    }
  }

  // Send a new email (not a reply) - for campaigns
  static async sendMessage(grantId, to, subject, body) {
    try {
      console.log('📤 Preparing to send message...');

      const formattedBody = typeof body === 'string' && body.trim().length > 0
        ? (body.includes('<') ? body : this.formatReplyBody(body))
        : '';

      const sendPayload = {
        subject: subject || '(No Subject)',
        to: Array.isArray(to) ? to.map(r => ({
          email: r.email,
          name: r.name || '',
        })) : [{ email: to.email, name: to.name || '' }],
        body: formattedBody,
      };

      console.log('📧 Sending with payload:');
      console.log('   To:', sendPayload.to[0]?.email);
      console.log('   Subject:', sendPayload.subject);

      const response = await nylasClient.messages.send({
        identifier: grantId,
        requestBody: sendPayload,
      });

      console.log('✅ Message sent successfully!');
      return {
        ...response.data,
        formattedBody,
      };
    } catch (error) {
      console.error('❌ Error sending message:', error.message);
      if (error.response?.data) {
        console.error('   API Error:', JSON.stringify(error.response.data, null, 2));
      }
      throw error;
    }
  }

  // Send reply to a message
  static async sendReply(grantId, messageId, replyBody, replyTo) {
    try {
      console.log('📤 Preparing to send reply...');
      
      const message = await this.getMessage(grantId, messageId);
      console.log('   Original subject:', message.subject);

      // Prepare email with proper formatting
      const replySubject = message.subject?.startsWith('Re:') 
        ? message.subject 
        : `Re: ${message.subject || 'Your Email'}`;

      // Format body with email-safe HTML
      // Use simple div wrapper with basic formatting
      const formattedBody = this.formatReplyBody(replyBody);

      const sendPayload = {
        subject: replySubject,
        to: [{ 
          email: replyTo.email,
          name: replyTo.name || ''
        }],
        body: formattedBody,
        reply_to_message_id: messageId,
      };
      // Note: Nylas v3 automatically sets "from" based on grant, no need to specify

      console.log('📧 Sending with payload:');
      console.log('   To:', sendPayload.to[0].email);
      console.log('   Subject:', sendPayload.subject);
      console.log('   Body (first 150 chars):', formattedBody.substring(0, 150));
      console.log('   Reply to message:', messageId);

      const response = await nylasClient.messages.send({
        identifier: grantId,
        requestBody: sendPayload,
      });

      console.log('✅ Reply sent successfully!');
      console.log('   Message ID:', response.data?.id);
      console.log('   From (auto-set by Nylas):', response.data?.from?.[0]?.email);
      
      // Return the response with the formatted HTML body included
      return {
        ...response.data,
        formattedBody: formattedBody, // Include formatted HTML for database storage
      };
    } catch (error) {
      console.error('❌ Error sending reply:', error.message);
      if (error.response?.data) {
        console.error('   API Error:', JSON.stringify(error.response.data, null, 2));
      }
      throw error;
    }
  }

  // Format reply body with email-safe HTML
  static formatReplyBody(text) {
    if (!text || text.trim().length === 0) {
      return '';
    }

    // Escape HTML special characters to prevent injection
    const escapeHtml = (str) => {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    // Split by double newlines to get paragraphs
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
    
    // Convert each paragraph to HTML
    const htmlParagraphs = paragraphs.map(para => {
      // Within each paragraph, convert single newlines to <br>
      const escaped = escapeHtml(para.trim());
      const withBreaks = escaped.replace(/\n/g, '<br>');
      return `<p style="margin: 0 0 1em 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #333;">${withBreaks}</p>`;
    }).join('');

    // Wrap in a simple div for consistent styling
    return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 14px; color: #333;">
${htmlParagraphs}
</div>`;
  }

  // Format email body with proper HTML
  static formatEmailBody(text) {
    if (!text) return '';

    // Convert plain text to HTML
    // 1. Escape HTML special characters
    let formatted = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 2. Convert line breaks to <br> tags
    formatted = formatted.replace(/\n/g, '<br>');

    // 3. Preserve multiple spaces
    formatted = formatted.replace(/  /g, '&nbsp;&nbsp;');

    // 4. Wrap in proper HTML structure
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0;
      padding: 20px;
    }
    .signature {
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
      color: #666;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div>${formatted}</div>
</body>
</html>`;

    return html;
  }

  // Fetch sent messages
  static async fetchSentMessages(grantId, limit = 50) {
    try {
      console.log(`📤 Fetching sent messages for grant: ${grantId}`);
      
      // For Gmail, use SENT label; for others, try different approaches
      const response = await nylasClient.messages.list({
        identifier: grantId,
        queryParams: {
          limit,
          search_query_native: 'in:sent', // Gmail native search
        },
      });

      console.log(`   📧 Found ${response.data?.length || 0} sent message(s)`);
      return response.data || [];
    } catch (error) {
      console.error('❌ Error fetching sent messages:', error.message);
      // Return empty array instead of throwing - sent folder is optional
      return [];
    }
  }

  // Format message for storage
  static formatMessage(message, folder = 'inbox') {
    // Convert body to HTML if it's plain text
    let bodyHtml = message.body || '';
    
    // Check if body is already HTML (contains HTML tags)
    const isHtml = bodyHtml.includes('<div') || bodyHtml.includes('<p') || bodyHtml.includes('<html');
    
    // If it's plain text, convert it to HTML for proper display
    if (!isHtml && bodyHtml.trim().length > 0) {
      bodyHtml = this.formatReplyBody(bodyHtml);
    }
    
    return {
      messageId: message.id,
      threadId: message.thread_id || message.threadId,
      from: message.from && message.from.length > 0 
        ? { name: message.from[0].name || '', email: message.from[0].email }
        : { name: '', email: '' },
      to: message.to || [],
      cc: message.cc || [],
      bcc: message.bcc || [],
      subject: message.subject || '(No Subject)',
      body: bodyHtml, // Use formatted HTML body
      snippet: message.snippet || '',
      receivedAt: new Date(message.date * 1000),
      folder,
      attachments: message.attachments || [],
    };
  }
}

export default NylasService;

