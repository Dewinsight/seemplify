import { getDatabase } from '../config/database.js';
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';

export class User {
  constructor(userData) {
    this.name = userData.name;
    this.email = userData.email;
    this.password = userData.password;
    this.createdAt = userData.createdAt || new Date();
    this.updatedAt = userData.updatedAt || new Date();
    this.isActive = userData.isActive !== undefined ? userData.isActive : true;
    this.nylasGrantId = userData.nylasGrantId || null;
    this.nylasEmail = userData.nylasEmail || null; // The actual Nylas-connected email
    this.emailConnected = userData.emailConnected || false;
    this.connectedAt = userData.connectedAt || null;
    this.lastEmailCheck = userData.lastEmailCheck || null;
    this.lastSentCheck = userData.lastSentCheck || null;
  }

  // Create a new user
  async save() {
    const db = getDatabase();
    const users = db.collection('users');

    // Hash password before saving
    if (this.password) {
      this.password = await bcrypt.hash(this.password, 12);
    }

    const result = await users.insertOne({
      name: this.name,
      email: this.email.toLowerCase(),
      password: this.password,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      isActive: this.isActive,
      nylasGrantId: this.nylasGrantId,
      nylasEmail: this.nylasEmail,
      emailConnected: this.emailConnected,
      connectedAt: this.connectedAt,
      lastEmailCheck: this.lastEmailCheck,
      lastSentCheck: this.lastSentCheck,
    });

    return result;
  }

  // Find user by email
  static async findByEmail(email) {
    const db = getDatabase();
    const users = db.collection('users');
    
    const user = await users.findOne({ 
      email: email.toLowerCase(),
      isActive: true 
    });
    
    return user;
  }

  // Find user by ID
  static async findById(id) {
    const db = getDatabase();
    const users = db.collection('users');
    
    const user = await users.findOne({ 
      _id: new ObjectId(id),
      isActive: true 
    });
    
    return user;
  }

  // Verify password
  static async verifyPassword(plainPassword, hashedPassword) {
    return await bcrypt.compare(plainPassword, hashedPassword);
  }

  // Update user
  static async updateById(id, updateData) {
    const db = getDatabase();
    const users = db.collection('users');
    
    updateData.updatedAt = new Date();
    
    const result = await users.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );
    
    return result;
  }

  // Delete user (soft delete)
  static async deleteById(id) {
    const db = getDatabase();
    const users = db.collection('users');
    
    const result = await users.updateOne(
      { _id: new ObjectId(id) },
      { 
        $set: { 
          isActive: false,
          updatedAt: new Date()
        }
      }
    );
    
    return result;
  }

  // Get user stats
  static async getStats() {
    const db = getDatabase();
    const users = db.collection('users');
    
    const totalUsers = await users.countDocuments({ isActive: true });
    const recentUsers = await users.countDocuments({
      isActive: true,
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    });
    
    return {
      totalUsers,
      recentUsers
    };
  }

  // Sanitize user data (remove sensitive fields)
  static sanitize(user) {
    if (!user) return null;
    
    const { password, ...sanitizedUser } = user;
    return sanitizedUser;
  }
}
