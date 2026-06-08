const mongoose = require('mongoose');
const { decodeHtmlEntities } = require('../utils/htmlDecode');

const NotificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: [
      'organization_invite',
      'interview_scheduled',
      'candidate_applied',
      'job_posted',
      'general',
      'job_created',
      'candidate_uploaded',
      'interview_created',
      'people_transition_started',
      'people_transition_action',
      'people_transition_completed',
      'people_transition_task_assigned',
      'people_transition_due_soon',
      'people_transition_overdue'
    ],
    required: true
  },
  title: {
    type: String,
    required: true,
    maxlength: 200
  },
  message: {
    type: String,
    required: true,
    maxlength: 500
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  read: {
    type: Boolean,
    default: false
  },
  actionUrl: {
    type: String,
    default: null
  },
  actionText: {
    type: String,
    default: null
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  expiresAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for better performance
NotificationSchema.index({ user: 1, read: 1 });
NotificationSchema.index({ user: 1, createdAt: -1 });
NotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Virtual for checking if notification is expired
NotificationSchema.virtual('isExpired').get(function() {
  return this.expiresAt && this.expiresAt < new Date();
});

// Methods
NotificationSchema.methods.markAsRead = function() {
  this.read = true;
  this.updatedAt = Date.now();
  return this;
};

NotificationSchema.methods.markAsUnread = function() {
  this.read = false;
  this.updatedAt = Date.now();
  return this;
};

// Static method to create organization invite notification
NotificationSchema.statics.createOrganizationInviteNotification = function(userId, inviteData) {
  return this.create({
    user: userId,
    type: 'organization_invite',
    title: decodeHtmlEntities(`Invitation to join ${inviteData.organizationName}`),
    message: decodeHtmlEntities(`${inviteData.inviterName} has invited you to join ${inviteData.organizationName} as a ${inviteData.role}.`),
    data: {
      inviteToken: inviteData.token,
      organizationId: inviteData.organizationId,
      organizationName: inviteData.organizationName,
      role: inviteData.role,
      inviterName: inviteData.inviterName,
      inviterId: inviteData.inviterId
    },
    actionUrl: `/settings/invitations`,
    actionText: 'View Invitations',
    priority: 'high',
    expiresAt: inviteData.expiresAt
  });
};

// Static method to clean up expired notifications
NotificationSchema.statics.cleanupExpired = async function() {
  const result = await this.deleteMany({
    expiresAt: { $lt: new Date() }
  });
  return result.deletedCount;
};

// Static method to get unread count for user
NotificationSchema.statics.getUnreadCount = function(userId) {
  return this.countDocuments({
    user: userId,
    read: false,
    $or: [
      { expiresAt: null },
      { expiresAt: { $gt: new Date() } }
    ]
  });
};

// Static method to create job creation activity notification for all org members
NotificationSchema.statics.createJobCreatedNotification = async function(userId, jobData, creatorName = null) {
  try {
    const User = require('./User');
    const Organization = require('./Organization');
    const creator = await User.findById(userId);
    if (!creator) return;

    // Get organization info for embedding
    let orgName = null;
    if (creator.currentOrganization) {
      try {
        const org = await Organization.findById(creator.currentOrganization).select('name').lean();
        orgName = org?.name || null;
      } catch (e) {
        console.warn('Failed to get org name for job notification:', e.message);
      }
    }

    // Get all users who are members of this organization (not just those with it as currentOrganization)
    const orgDoc = await Organization.findById(creator.currentOrganization);
    const orgMemberIds = orgDoc ? orgDoc.members.filter(m => m.status === 'active' && m.user.toString() !== userId.toString()).map(m => m.user) : [];
    const orgUsers = await User.find({ _id: { $in: orgMemberIds } });

    const notifications = [];

    // Create notification for the creator (different message)
    notifications.push({
      user: userId,
      type: 'job_created',
      title: decodeHtmlEntities(`Job created: ${jobData.title}`),
      message: decodeHtmlEntities(`You created a new job posting for ${jobData.title} in ${jobData.department}`),
      data: {
        jobId: jobData._id,
        jobTitle: decodeHtmlEntities(jobData.title),
        department: decodeHtmlEntities(jobData.department),
        location: decodeHtmlEntities(jobData.location),
        type: decodeHtmlEntities(jobData.type),
        creatorId: userId,
        creatorName: creator.name || creator.email,
        organizationId: creator.currentOrganization,
        organizationName: orgName
      },
      actionUrl: `/jobs/${jobData._id}`,
      actionText: 'View Job',
      priority: 'medium'
    });

    // Create notifications for all other org members
    for (const orgUser of orgUsers) {
      notifications.push({
        user: orgUser._id,
        type: 'job_created',
        title: decodeHtmlEntities(`New job posted: ${jobData.title}`),
        message: decodeHtmlEntities(`${creator.name || creator.email} created a new job posting for ${jobData.title} in ${jobData.department}`),
        data: {
          jobId: jobData._id,
          jobTitle: decodeHtmlEntities(jobData.title),
          department: decodeHtmlEntities(jobData.department),
          location: decodeHtmlEntities(jobData.location),
          type: decodeHtmlEntities(jobData.type),
          creatorId: userId,
          creatorName: creator.name || creator.email,
          organizationId: creator.currentOrganization,
          organizationName: orgName
        },
        actionUrl: `/jobs/${jobData._id}`,
        actionText: 'View Job',
        priority: 'medium'
      });
    }

    return this.insertMany(notifications);
  } catch (error) {
    console.error('Error creating job notifications:', error);
    throw error;
  }
};

// Static method to create candidate upload activity notification for all org members
NotificationSchema.statics.createCandidateUploadedNotification = async function(userId, candidateData) {
  try {
    const User = require('./User');
    const Organization = require('./Organization');
    const creator = await User.findById(userId);
    if (!creator) return;

    // Get organization info for embedding
    let orgName = null;
    if (creator.currentOrganization) {
      try {
        const org = await Organization.findById(creator.currentOrganization).select('name').lean();
        orgName = org?.name || null;
      } catch (e) {
        console.warn('Failed to get org name for candidate notification:', e.message);
      }
    }

    // Get all users who are members of this organization (not just those with it as currentOrganization)
    const orgDoc = await Organization.findById(creator.currentOrganization);
    const orgMemberIds = orgDoc ? orgDoc.members.filter(m => m.status === 'active' && m.user.toString() !== userId.toString()).map(m => m.user) : [];
    const orgUsers = await User.find({ _id: { $in: orgMemberIds } });

    const notifications = [];
    
    // Create a proper display name, handling N/A cases
    const getDisplayName = (candidate) => {
      const firstName = candidate.firstName && candidate.firstName !== 'N/A' ? candidate.firstName : '';
      const lastName = candidate.lastName && candidate.lastName !== 'N/A' ? candidate.lastName : '';
      
      if (firstName && lastName) {
        return `${firstName} ${lastName}`;
      } else if (firstName) {
        return firstName;
      } else if (lastName) {
        return lastName;
      } else if (candidate.email && candidate.email !== 'candidate-' && !candidate.email.includes('@temp.com')) {
        return candidate.email.split('@')[0]; // Use email username as fallback
      } else if (candidate.position && candidate.position !== 'N/A') {
        return `Candidate (${candidate.position})`;
      } else {
        return 'New Candidate';
      }
    };
    
    const candidateName = getDisplayName(candidateData);

    // Create notification for the creator (different message)
    notifications.push({
      user: userId,
      type: 'candidate_uploaded',
      title: decodeHtmlEntities(`Candidate added: ${candidateName}`),
      message: decodeHtmlEntities(`You added ${candidateName} to the candidate database`),
      data: {
        candidateId: candidateData._id,
        candidateName: candidateName,
        position: candidateData.position,
        email: candidateData.email,
        source: candidateData.source,
        creatorId: userId,
        creatorName: creator.name || creator.email,
        organizationId: creator.currentOrganization,
        organizationName: orgName
      },
      actionUrl: `/candidates/${candidateData._id}`,
      actionText: 'View Candidate',
      priority: 'medium'
    });

    // Create notifications for all other org members
    for (const orgUser of orgUsers) {
      notifications.push({
        user: orgUser._id,
        type: 'candidate_uploaded',
        title: decodeHtmlEntities(`New candidate: ${candidateName}`),
        message: decodeHtmlEntities(`${creator.name || creator.email} added ${candidateName} to the candidate database`),
        data: {
          candidateId: candidateData._id,
          candidateName: candidateName,
          position: candidateData.position,
          email: candidateData.email,
          source: candidateData.source,
          creatorId: userId,
          creatorName: creator.name || creator.email,
          organizationId: creator.currentOrganization,
          organizationName: orgName
        },
        actionUrl: `/candidates/${candidateData._id}`,
        actionText: 'View Candidate',
        priority: 'medium'
      });
    }

    return this.insertMany(notifications);
  } catch (error) {
    console.error('Error creating candidate notifications:', error);
    throw error;
  }
};

// Static method to create interview created activity notification for all org members
NotificationSchema.statics.createInterviewCreatedNotification = async function(userId, interviewData) {
  try {
    const User = require('./User');
    const Organization = require('./Organization');
    const creator = await User.findById(userId);
    if (!creator) return;

    // Get organization info for embedding
    let orgName = null;
    if (creator.currentOrganization) {
      try {
        const org = await Organization.findById(creator.currentOrganization).select('name').lean();
        orgName = org?.name || null;
      } catch (e) {
        console.warn('Failed to get org name for interview notification:', e.message);
      }
    }

    // Get all users who are members of this organization (not just those with it as currentOrganization)
    const orgDoc = await Organization.findById(creator.currentOrganization);
    const orgMemberIds = orgDoc ? orgDoc.members.filter(m => m.status === 'active' && m.user.toString() !== userId.toString()).map(m => m.user) : [];
    const orgUsers = await User.find({ _id: { $in: orgMemberIds } });

    const notifications = [];
    const scheduledDate = new Date(interviewData.scheduledAt).toLocaleDateString();

    // Create notification for the creator (different message)
    notifications.push({
      user: userId,
      type: 'interview_created',
      title: decodeHtmlEntities(`Interview scheduled: ${interviewData.candidateName}`),
      message: decodeHtmlEntities(`You scheduled an interview with ${interviewData.candidateName} for ${scheduledDate}`),
      data: {
        interviewId: interviewData._id,
        candidateId: interviewData.candidateId,
        candidateName: interviewData.candidateName,
        jobTitle: interviewData.jobTitle,
        scheduledAt: interviewData.scheduledAt,
        duration: interviewData.duration,
        type: interviewData.type,
        creatorId: userId,
        creatorName: creator.name || creator.email,
        organizationId: creator.currentOrganization,
        organizationName: orgName
      },
      actionUrl: `/interviews/${interviewData._id}`,
      actionText: 'View Interview',
      priority: 'high'
    });

    // Create notifications for all other org members
    for (const orgUser of orgUsers) {
      notifications.push({
        user: orgUser._id,
        type: 'interview_created',
        title: decodeHtmlEntities(`Interview scheduled: ${interviewData.candidateName}`),
        message: decodeHtmlEntities(`${creator.name || creator.email} scheduled an interview with ${interviewData.candidateName} for ${scheduledDate}`),
        data: {
          interviewId: interviewData._id,
          candidateId: interviewData.candidateId,
          candidateName: interviewData.candidateName,
          jobTitle: interviewData.jobTitle,
          scheduledAt: interviewData.scheduledAt,
          duration: interviewData.duration,
          type: interviewData.type,
          creatorId: userId,
          creatorName: creator.name || creator.email,
          organizationId: creator.currentOrganization,
          organizationName: orgName
        },
        actionUrl: `/interviews/${interviewData._id}`,
        actionText: 'View Interview',
        priority: 'high'
      });
    }

    return this.insertMany(notifications);
  } catch (error) {
    console.error('Error creating interview notifications:', error);
    throw error;
  }
};

// Static method to create interview cancelled activity notification for all org members
NotificationSchema.statics.createInterviewCancelledNotification = async function(userId, interviewData, cancellationReason) {
  try {
    console.log('Creating interview cancelled notifications with data:', {
      userId,
      interviewId: interviewData._id,
      candidateName: interviewData.candidateName,
      reason: cancellationReason
    });
    
    const User = require('./User');
    const Organization = require('./Organization');
    const canceller = await User.findById(userId);
    if (!canceller) {
      console.error(`Canceller user ${userId} not found for notifications`);
      return [];
    }

    // Get organization info for embedding
    let orgName = null;
    if (canceller.currentOrganization) {
      try {
        const org = await Organization.findById(canceller.currentOrganization).select('name').lean();
        orgName = org?.name || null;
      } catch (e) {
        console.warn('Failed to get org name for interview cancellation notification:', e.message);
      }
    }
    
    console.log('Found canceller:', {
      id: canceller._id,
      name: canceller.name || canceller.email,
      organization: canceller.currentOrganization
    });

    // Get all users who are members of this organization (not just those with it as currentOrganization)
    const orgDoc = await Organization.findById(canceller.currentOrganization);
    const orgMemberIds = orgDoc ? orgDoc.members.filter(m => m.status === 'active' && m.user.toString() !== userId.toString()).map(m => m.user) : [];
    const orgUsers = await User.find({ _id: { $in: orgMemberIds } });
    
    console.log(`Found ${orgUsers.length} other organization members for notifications`);

    const notifications = [];
    const scheduledDate = new Date(interviewData.scheduledAt).toLocaleDateString();

    // Create notification for the canceller (different message)
    notifications.push({
      user: userId,
      type: 'interview_cancelled',
      title: `Interview cancelled: ${interviewData.candidateName}`,
      message: `You cancelled the interview with ${interviewData.candidateName} scheduled for ${scheduledDate}`,
      data: {
        interviewId: interviewData._id,
        candidateId: interviewData.candidateId,
        candidateName: interviewData.candidateName,
        jobTitle: interviewData.jobTitle,
        scheduledAt: interviewData.scheduledAt,
        duration: interviewData.duration,
        type: interviewData.type,
        cancellerId: userId,
        cancellerName: canceller.name || canceller.email,
        cancellationReason: cancellationReason,
        organizationId: canceller.currentOrganization,
        organizationName: orgName
      },
      actionUrl: `/calendar`,
      actionText: 'View Calendar',
      priority: 'medium'
    });

    // Create notifications for all other org members
    for (const orgUser of orgUsers) {
      notifications.push({
        user: orgUser._id,
        type: 'interview_cancelled',
        title: `Interview cancelled: ${interviewData.candidateName}`,
        message: `${canceller.name || canceller.email} cancelled the interview with ${interviewData.candidateName} scheduled for ${scheduledDate}${cancellationReason ? `. Reason: ${cancellationReason}` : ''}`,
        data: {
          interviewId: interviewData._id,
          candidateId: interviewData.candidateId,
          candidateName: interviewData.candidateName,
          jobTitle: interviewData.jobTitle,
          scheduledAt: interviewData.scheduledAt,
          duration: interviewData.duration,
          type: interviewData.type,
          cancellerId: userId,
          cancellerName: canceller.name || canceller.email,
          cancellationReason: cancellationReason,
          organizationId: canceller.currentOrganization,
          organizationName: orgName
        },
        actionUrl: `/calendar`,
        actionText: 'View Calendar',
        priority: 'medium'
      });
    }

    console.log(`Creating ${notifications.length} interview cancellation notifications`);
    if (notifications.length === 0) {
      console.warn('No notifications to create');
      return [];
    }
    
    const result = await this.insertMany(notifications);
    console.log(`Successfully created ${result.length} cancellation notifications`);
    return result;
  } catch (error) {
    console.error('Error creating interview cancellation notifications:', error);
    console.error('Error details:', error);
    return []; // Return empty array instead of throwing to prevent cancellation failure
  }
};

// Ensure virtual fields are serialized
NotificationSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Notification', NotificationSchema);
