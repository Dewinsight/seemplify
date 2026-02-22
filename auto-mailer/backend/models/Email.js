import { getDatabase } from '../config/database.js';
import { ObjectId } from 'mongodb';

export class Email {
  constructor(emailData) {
    this.userId = emailData.userId;
    this.messageId = emailData.messageId;
    this.grantId = emailData.grantId;
    this.from = emailData.from; // { name, email }
    this.to = emailData.to; // array of { name, email }
    this.cc = emailData.cc || []; // array of { name, email }
    this.bcc = emailData.bcc || []; // array of { name, email }
    this.subject = emailData.subject;
    this.body = emailData.body;
    this.snippet = emailData.snippet; // preview text
    this.receivedAt = emailData.receivedAt || new Date();
    this.isRead = emailData.isRead || false;
    this.hasReplied = emailData.hasReplied || false;
    this.threadId = emailData.threadId || null;
    this.folder = emailData.folder || 'inbox'; // 'inbox' or 'sent'
    this.attachments = emailData.attachments || []; // array of attachment objects
    this.createdAt = new Date();
  }

  // Save email to database
  async save() {
    const db = getDatabase();
    const emails = db.collection('emails');

    const result = await emails.insertOne({
      userId: new ObjectId(this.userId),
      messageId: this.messageId,
      grantId: this.grantId,
      from: this.from,
      to: this.to,
      cc: this.cc,
      bcc: this.bcc,
      subject: this.subject,
      body: this.body,
      snippet: this.snippet,
      receivedAt: this.receivedAt,
      isRead: this.isRead,
      hasReplied: this.hasReplied,
      threadId: this.threadId,
      folder: this.folder,
      attachments: this.attachments,
      createdAt: this.createdAt,
    });

    return result;
  }

  // Find emails by userId
  static async findByUserId(userId, limit = 50, folder = null) {
    const db = getDatabase();
    const emails = db.collection('emails');

    const query = { userId: new ObjectId(userId) };
    
    // Filter by folder if specified
    if (folder) {
      query.folder = folder;
    }

    const emailList = await emails
      .find(query)
      .sort({ receivedAt: -1 })
      .limit(limit)
      .toArray();

    return emailList;
  }

  // Find emails by thread ID
  static async findByThreadId(threadId) {
    const db = getDatabase();
    const emails = db.collection('emails');

    const emailList = await emails
      .find({ threadId })
      .sort({ receivedAt: 1 }) // Oldest first for thread view
      .toArray();

    return emailList;
  }

  // Find email by messageId
  static async findByMessageId(messageId) {
    const db = getDatabase();
    const emails = db.collection('emails');

    const email = await emails.findOne({ messageId });
    return email;
  }

  // Mark email as read
  static async markAsRead(messageId) {
    const db = getDatabase();
    const emails = db.collection('emails');

    const result = await emails.updateOne(
      { messageId },
      { $set: { isRead: true } }
    );

    return result;
  }

  // Mark email as replied
  static async markAsReplied(messageId) {
    const db = getDatabase();
    const emails = db.collection('emails');

    const result = await emails.updateOne(
      { messageId },
      { $set: { hasReplied: true } }
    );

    return result;
  }

  // Get unread count for user
  static async getUnreadCount(userId) {
    const db = getDatabase();
    const emails = db.collection('emails');

    const count = await emails.countDocuments({
      userId: new ObjectId(userId),
      isRead: false,
    });

    return count;
  }
}

