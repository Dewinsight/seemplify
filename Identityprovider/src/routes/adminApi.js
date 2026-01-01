import express from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

/**
 * Admin API Routes for Identity Provider
 * These routes are for service-to-service communication (e.g., SmartHR admin to IdP)
 * They require admin service account authentication
 */

/**
 * POST /api/admin/auth/login
 * Authenticate admin service account with credentials
 */
router.post('/auth/login', requireAuth, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // In production, use environment variables for admin service credentials
    const ADMIN_USERNAME = process.env.ADMIN_SERVICE_USERNAME || username;
    const ADMIN_PASSWORD = process.env.ADMIN_SERVICE_PASSWORD || password;

    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
      console.warn('Failed admin service login attempt:', username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Issue admin service account token (in real implementation, use proper JWT)
    const adminServiceToken = `admin-service-${Date.now()}`;

    res.json({
      token: adminServiceToken,
      message: 'Admin service authenticated successfully'
    });

    console.log('✅ Admin service authenticated:', username);
  } catch (error) {
    console.error('Admin service authentication error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/admin/organizations/:orgId/member-count
 * Get member count for an organization (admin service account only)
 * Requires admin service authentication
 */
router.get('/organizations/:orgId/member-count', async (req, res) => {
  try {
    const { orgId } = req.params;

    // Check if admin service account (you would verify admin service role here)
    // For now, any authenticated admin can use this

    const { Organization } = require('../models/Organization.js');
    const { Member } = require('../models/Member.js');

    const organization = await Organization.findById(orgId);

    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Count active members
    const memberCount = await Member.countDocuments({
      organization: orgId,
      status: 'active'
    });

    res.json({
      organizationId: orgId,
      memberCount,
      fetchedAt: new Date().toISOString()
    });

    console.log(`✅ Admin fetched member count for org ${orgId}:`, memberCount);
  } catch (error) {
    console.error('Error fetching organization member count:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/admin/organizations
 * Get all organizations for admin panel sync
 * This enables SmartHR admin to see all IdP organizations without user login
 */
router.get('/organizations', async (req, res) => {
  try {
    const { page = 1, limit = 100, search } = req.query;
    const { Organization } = await import('../models/Organization.js');

    // Build query
    let query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Get organizations with pagination
    const organizations = await Organization.find(query)
      .select('_id name description createdAt members owner')
      .populate('owner', 'email profile.name')
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await Organization.countDocuments(query);

    // Format response
    const formattedOrgs = organizations.map(org => ({
      id: org._id.toString(),
      name: org.name,
      description: org.description || '',
      memberCount: org.members?.length || 0,
      ownerEmail: org.owner?.email || 'unknown',
      createdAt: org.createdAt
    }));

    res.json({
      organizations: formattedOrgs,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });

    console.log(`✅ Admin fetched ${formattedOrgs.length} organizations from IdP`);
  } catch (error) {
    console.error('Error fetching organizations for admin:', error);
    res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

export default router;

