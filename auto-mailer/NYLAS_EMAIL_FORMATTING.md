# Nylas v3 Email Formatting & Thread Handling Guide

## Overview
This document explains how to properly handle email formatting, "from" addresses, and email threading with Nylas v3 API.

## Critical Issues Resolved

### 1. **From Email Address Issue**
**Problem**: Sent emails showed platform email instead of Nylas-connected email.

**Root Cause**: 
- Nylas v3 automatically sets the "from" field based on the grant ID
- We don't need to (and shouldn't) explicitly set the "from" field when sending
- The connected email is tied to the grant, not manually specified

**Solution**:
- Nylas v3 auto-sets "from" based on grant - removed explicit "from" in send payload
- Enhanced OAuth to properly capture and store connected email (`nylasEmail`)
- Updated saved sent emails to use actual "from" from Nylas response

### 2. **Email Formatting Issue**
**Problem**: Sent email replies had broken formatting in recipient inboxes.

**Root Cause**:
- Previous formatting used minimal HTML with inline styles that may not render consistently
- Lacked HTML escaping for user input
- No consistent email-client-safe structure

**Solution**:
- Implemented `formatReplyBody()` with proper HTML escaping
- Uses email-client-safe HTML with inline styles
- Simple div wrapper with paragraph tags for compatibility
- Follows email HTML best practices for Gmail, Outlook, etc.

---

## Nylas v3 OAuth & Email Retrieval

### Getting Connected Email Address

When a user connects their email account via OAuth, you need to retrieve their email address.

#### Method 1: From OAuth Token Exchange Response
```javascript
const response = await nylasClient.auth.exchangeCodeForToken({
  clientId: process.env.NYLAS_CLIENT_ID,
  clientSecret: process.env.NYLAS_CLIENT_SECRET,
  redirectUri: process.env.NYLAS_REDIRECT_URI,
  code,
});

// The response should contain the email
const email = response.email;
const grantId = response.grantId || response.id;
```

#### Method 2: Fetch Grant Details (Fallback)
If the email is not in the OAuth response, fetch it from the grants endpoint:

```javascript
const response = await nylasClient.grants.find({
  grantId: grantId,
});

const email = response.data?.email || response.data?.grantEmail;
```

### Our Implementation
See `backend/services/nylasService.js`:
- `exchangeCodeForGrant()` - Retrieves email from OAuth response
- `getGrantDetails()` - Fallback method to fetch grant info including email
- Stores email in User model as `nylasEmail`

---

## Sending Emails with Nylas v3

### Key Concept: Nylas Auto-Sets "From" Address

**Important**: Nylas v3 automatically sets the "from" field based on the grant ID. You do NOT need to specify it in the payload.

### Correct Send Payload Structure

```javascript
const sendPayload = {
  subject: 'Re: Subject',
  to: [{ 
    email: 'recipient@example.com',
    name: 'Recipient Name' // Optional
  }],
  body: '<div>Your HTML formatted body</div>',
  reply_to_message_id: 'original-message-id', // For threading
};

// No "from" field needed!
const response = await nylasClient.messages.send({
  identifier: grantId,  // The grant determines the "from" address
  requestBody: sendPayload,
});

// The response contains the actual "from" that was used
console.log('From:', response.data.from[0].email);
```

### Why This Works
- Each grant is tied to a specific email account
- Nylas knows which email to send from based on the grant ID
- The "from" address is automatically populated with the grant's email
- This ensures security - users can't spoof sender addresses

---

## Email Body Formatting

### HTML Formatting Best Practices

For maximum compatibility across email clients (Gmail, Outlook, Apple Mail, etc.):

1. **Use inline styles** (no external CSS)
2. **Use simple HTML** (no complex layouts)
3. **Escape user input** (prevent HTML injection)
4. **Wrap in simple containers** (div or table for structure)

### Our Implementation

See `NylasService.formatReplyBody()` in `backend/services/nylasService.js`:

```javascript
static formatReplyBody(text) {
  // 1. Escape HTML special characters
  const escapeHtml = (str) => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  // 2. Split into paragraphs (double newlines)
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
  
  // 3. Convert to HTML with inline styles
  const htmlParagraphs = paragraphs.map(para => {
    const escaped = escapeHtml(para.trim());
    const withBreaks = escaped.replace(/\n/g, '<br>');
    return `<p style="margin: 0 0 1em 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #333;">${withBreaks}</p>`;
  }).join('');

  // 4. Wrap in container with font styling
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 14px; color: #333;">
${htmlParagraphs}
</div>`;
}
```

### What NOT to Do
❌ Don't use full HTML documents with `<!DOCTYPE>`, `<html>`, `<head>`, `<body>`  
❌ Don't use external CSS or `<style>` tags  
❌ Don't use JavaScript  
❌ Don't forget to escape user input  
❌ Don't specify "from" field in Nylas v3 send payload

### What to Do
✅ Use simple HTML fragments  
✅ Use inline styles  
✅ Escape all user-generated content  
✅ Use web-safe fonts  
✅ Test across email clients  
✅ Let Nylas auto-set "from" based on grant

---

## Email Threading

### How Threading Works

Email clients use specific headers to group messages into threads:
- `Message-ID`: Unique identifier for each message
- `In-Reply-To`: References the message being replied to
- `References`: Chain of previous messages

### Nylas Threading with `reply_to_message_id`

```javascript
const sendPayload = {
  subject: message.subject.startsWith('Re:') ? message.subject : `Re: ${message.subject}`,
  to: [{ email: originalSender.email, name: originalSender.name }],
  body: formattedBody,
  reply_to_message_id: originalMessage.id, // This ensures threading
};
```

When you include `reply_to_message_id`, Nylas:
1. Sets proper `In-Reply-To` and `References` headers
2. Associates the reply with the same `thread_id`
3. Ensures email clients display messages in a conversation

### Thread Structure in Database

```javascript
{
  messageId: "msg_123",
  threadId: "thread_abc", // Same for all messages in conversation
  from: { email: "sender@example.com", name: "Sender" },
  to: [{ email: "recipient@example.com", name: "Recipient" }],
  subject: "Re: Your Email",
  body: "<div>...</div>",
  receivedAt: "2025-11-01T10:00:00Z",
  folder: "sent", // or "inbox"
}
```

### Displaying Threads in Frontend

See `frontend/src/components/EmailDetail.jsx`:

1. **Fetch thread messages**: `GET /api/emails/thread/:threadId`
2. **Sort chronologically**: Oldest to newest
3. **Display with proper sender info**: Use `from.email` for each message
4. **Expandable/collapsible**: Latest message expanded by default

---

## Diagnostic Logging

We've added comprehensive logging to track the email flow:

### OAuth Flow Logging
```javascript
console.log('🔑 Grant exchange response:', JSON.stringify(response, null, 2));
console.log('   Extracted Grant ID:', grantId);
console.log('   Extracted Email:', email);
```

### Send Reply Logging
```javascript
console.log('📧 [sendReply] User details:');
console.log('   User email (platform):', user.email);
console.log('   Nylas email (connected):', user.nylasEmail || 'NOT SET');
console.log('   Grant ID:', user.nylasGrantId);

console.log('📤 [sendReply] Nylas response - From address:', response.from?.[0]?.email);
console.log('💾 [sendReply] Saving sent email with from:', fromEmail);
```

These logs help verify:
- Email is properly captured during OAuth
- Nylas auto-sets correct "from" address
- Saved emails use actual sender email

---

## Common Issues & Solutions

### Issue: Sent emails show wrong "from" address
**Solution**: Nylas v3 auto-sets "from" based on grant. Don't specify "from" in payload.

### Issue: Email formatting broken in Outlook
**Solution**: Use inline styles, avoid complex HTML, test formatting with `formatReplyBody()`.

### Issue: Replies don't thread properly
**Solution**: Always include `reply_to_message_id` in payload.

### Issue: nylasEmail is null/undefined
**Solution**: Check OAuth callback logs, ensure email is extracted and saved during connection.

### Issue: Thread shows platform email instead of connected email
**Solution**: Use `response.from[0].email` from Nylas response when saving sent emails.

---

## Testing Checklist

When testing email functionality:

- [ ] Connect email via OAuth and verify `nylasEmail` is saved
- [ ] Send a reply and check logs for "From (auto-set by Nylas)"
- [ ] Verify sent email appears with correct sender in recipient inbox
- [ ] Check thread view shows proper sender for each message
- [ ] Test email formatting in Gmail, Outlook, Apple Mail
- [ ] Verify replies are properly threaded in conversation
- [ ] Check database saved emails have correct `from.email`

---

## Code References

### Backend Files
- `backend/services/nylasService.js` - OAuth, send, formatting logic
- `backend/controllers/nylasController.js` - OAuth callback handler
- `backend/controllers/emailController.js` - Send reply endpoint
- `backend/models/User.js` - User model with `nylasEmail` field
- `backend/models/Email.js` - Email model with `threadId` field

### Frontend Files
- `frontend/src/components/EmailDetail.jsx` - Thread display
- `frontend/src/api/emails.js` - API client for emails
- `frontend/src/api/nylas.js` - API client for Nylas

---

## Summary

### Key Takeaways

1. **Nylas v3 auto-sets "from"** - Don't specify it in send payload
2. **Capture email during OAuth** - Store as `nylasEmail` in User model
3. **Use simple HTML formatting** - Inline styles, escape user input
4. **Always set reply_to_message_id** - Ensures proper threading
5. **Save actual sender email** - Use `response.from[0].email` from Nylas
6. **Monitor logs** - Diagnostic logging helps track email flow

### Architecture Flow

```
User connects email (OAuth)
  ↓
Nylas returns grant + email
  ↓
Save grantId & nylasEmail to User model
  ↓
User sends reply
  ↓
Format body with formatReplyBody()
  ↓
Send via Nylas (grant determines "from")
  ↓
Nylas returns message with auto-set "from"
  ↓
Save sent email with actual "from" from response
  ↓
Display in thread with correct sender
```

---

**Last Updated**: November 1, 2025  
**Nylas API Version**: v3  
**Status**: ✅ Implemented and Tested

