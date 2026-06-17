const prisma = require('../db/client');

// Inlined from Notification.getUnreadCount: unread, non-expired notifications for a user.
async function getNotificationUnreadCount(userId) {
  return prisma.notification.count({
    where: {
      userId,
      read: false,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } }
      ]
    }
  });
}

// Get notifications for current user
exports.getUserNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    
    const query = {
      userId,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } }
      ]
    };

    if (unreadOnly === 'true') {
      query.read = false;
    }

    const notifications = await prisma.notification.findMany({
      where: query,
      orderBy: { createdAt: 'desc' },
      take: limit * 1,
      skip: (page - 1) * limit
    });

    const total = await prisma.notification.count({ where: query });
    const unreadCount = await getNotificationUnreadCount(userId);
    
    
    // Enrich notifications with organization context for UI badges and switching
    // Collect org IDs from notifications only (no fallback to user's current org)
    const orgIdsSet = new Set();
    for (const n of notifications) {
      const data = n.data || {};
      const organizationId = data.organizationId || data.orgId || data.organization || null;
      if (organizationId) orgIdsSet.add(organizationId.toString());
    }

    // Lookup organization names in one batch
    let orgIdToName = {};
    if (orgIdsSet.size > 0) {
      try {
        const ids = Array.from(orgIdsSet);
        const orgs = await prisma.organization.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
        orgIdToName = orgs.reduce((acc, org) => {
          acc[org.id.toString()] = org.name;
          return acc;
        }, {});
      } catch (e) {
        console.warn('Failed to batch load organization names for notifications:', e.message);
      }
    }

    const enriched = notifications.map(n => {
      const data = n.data || {};
      // DO NOT fallback to userCurrentOrg - each notification should have its own org data
      let organizationId = data.organizationId || data.orgId || data.organization || null;
      let explicitName = data.organizationName || data.orgName || null;
      
      // For older notifications without org data, try to derive from related entities
      if (!organizationId && !explicitName) {
        // For job-related notifications, we could look up the job's organization
        // For candidate-related notifications, we could look up the candidate's organization
        // For interview-related notifications, we could look up the interview's organization
        // But for now, these notifications will show without org badges (which is correct)
        console.log(`⚠️ Notification ${n._id} (${n.type}) has no organization data`);
      }
      
      const lookedUpName = organizationId ? orgIdToName[organizationId.toString()] : null;

      return {
        ...n,
        organization: {
          id: organizationId || null,
          name: explicitName || lookedUpName || null
        }
      };
    });
    
    // Debug logging to see what we're sending to frontend
    console.log('🔍 DEBUG: Sending to frontend:', enriched.map(n => ({
      id: n._id,
      type: n.type,
      title: n.title,
      organization: n.organization
    })));

    res.json({
      notifications: enriched,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      },
      unreadCount
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Get unread notification count
exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;
    const count = await getNotificationUnreadCount(userId);

    res.json({ count });
  } catch (error) {
    console.error('Error getting unread count:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Mark notification as read
exports.markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user.id;
    
    const notification = await prisma.notification.findFirst({
      where: { id: notificationId, userId }
    });

    if (!notification) {
      return res.status(404).json({ msg: 'Notification not found' });
    }

    // Inlined from Notification.markAsRead()
    await prisma.notification.update({
      where: { id: notification.id },
      data: { read: true, updatedAt: new Date() }
    });

    res.json({ msg: 'Notification marked as read' });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Mark all notifications as read
exports.markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    
    await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true }
    });

    res.json({ msg: 'All notifications marked as read' });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Delete notification
exports.deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user.id;
    
    const result = await prisma.notification.deleteMany({
      where: { id: notificationId, userId }
    });

    if (result.count === 0) {
      return res.status(404).json({ msg: 'Notification not found' });
    }
    
    res.json({ msg: 'Notification deleted' });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Create test notification (for development)
exports.createTestNotification = async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, message, type = 'general', organizationId } = req.body;
    
    // Get user's organization for embedding (allow override for testing)
    const currentUser = await prisma.user.findUnique({ where: { id: userId }, select: { currentOrganizationId: true } });
    const targetOrgId = organizationId || currentUser?.currentOrganizationId;

    let orgName = null;
    if (targetOrgId) {
      try {
        const org = await prisma.organization.findUnique({ where: { id: targetOrgId }, select: { name: true } });
        orgName = org?.name || null;
      } catch (e) {
        console.warn('Failed to get org name for test notification:', e.message);
      }
    }
    
    console.log(`🧪 Creating test notification for user ${userId} with org ${targetOrgId} (${orgName})`);
    
    const notification = await prisma.notification.create({
      data: {
        userId,
        type,
        title: title || `Test notification - ${orgName || 'No Org'}`,
        message: message || `This is a test notification from ${orgName || 'unknown organization'}`,
        data: {
          organizationId: targetOrgId || null,
          organizationName: orgName
        },
        actionUrl: '/dashboard',
        actionText: 'View Dashboard'
      }
    });
    
    console.log('🧪 Test notification created:', {
      id: notification._id,
      orgId: notification.data?.organizationId,
      orgName: notification.data?.organizationName
    });
    
    res.json(notification);
  } catch (error) {
    console.error('Error creating test notification:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Get recent activities for dashboard (organization-wide)
exports.getRecentActivities = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 10 } = req.query;
    
    // Get current user to find their organization
    const currentUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!currentUser || !currentUser.currentOrganizationId) {
      return res.status(400).json({ msg: 'User organization not found' });
    }

    // Get all users in the same organization
    const orgUsers = await prisma.user.findMany({
      where: { currentOrganizationId: currentUser.currentOrganizationId },
      select: { id: true }
    });

    const orgUserIds = orgUsers.map(user => user.id);

    // Get activity notifications from all organization members
    const activityTypes = ['job_created', 'candidate_uploaded', 'interview_created'];

    const activities = await prisma.notification.findMany({
      where: {
        userId: { in: orgUserIds }, // Activities from all organization members
        type: { in: activityTypes },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit)
    });
    
    // Transform notifications into activity format for dashboard
    const formattedActivities = activities.map(notification => ({
      type: notification.type.replace('_', ''), // job_created -> jobcreated
      title: notification.title,
      subtitle: notification.message,
      timestamp: notification.createdAt,
      status: 'completed', // All past activities are completed
      data: notification.data
    }));
    
    res.json({
      activities: formattedActivities,
      count: formattedActivities.length
    });
  } catch (error) {
    console.error('Error fetching recent activities:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};