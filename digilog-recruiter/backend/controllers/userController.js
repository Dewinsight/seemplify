const User = require('../models/User');
const Candidate = require('../models/Candidate');
const Job = require('../models/Job');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Get current user profile
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Update user profile
exports.updateProfile = async (req, res) => {
  try {
    const {
      profile,
      preferences,
    } = req.body;

    // Validate required fields
    if (!profile) {
      return res.status(400).json({ 
        msg: 'Profile data is required',
        errors: { profile: 'Profile information is required' }
      });
    }

    // Validate profile fields
    const errors = {};
    if (profile.firstName && profile.firstName.trim().length < 2) {
      errors.firstName = 'First name must be at least 2 characters';
    }
    if (profile.lastName && profile.lastName.trim().length < 2) {
      errors.lastName = 'Last name must be at least 2 characters';
    }
    if (profile.phone && profile.phone.trim().length > 0 && profile.phone.trim().length < 10) {
      errors.phone = 'Phone number must be at least 10 characters';
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ 
        msg: 'Validation failed',
        errors 
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    // Update profile fields
    if (profile) {
      // Clean and trim string fields
      const cleanProfile = {};
      Object.keys(profile).forEach(key => {
        if (typeof profile[key] === 'string') {
          cleanProfile[key] = profile[key].trim();
        } else {
          cleanProfile[key] = profile[key];
        }
      });
      user.profile = { ...(user.profile?.toObject() || {}), ...cleanProfile };
    }

    // Update preferences
    if (preferences) {
      user.preferences = { ...(user.preferences?.toObject() || {}), ...preferences };
    }

    await user.save();

    // Return user without password
    const updatedUser = await User.findById(req.user.id).select('-password');
    res.json({
      user: updatedUser,
      msg: 'Profile updated successfully'
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    
    // Handle mongoose validation errors
    if (error.name === 'ValidationError') {
      const errors = {};
      Object.keys(error.errors).forEach(key => {
        errors[key] = error.errors[key].message;
      });
      return res.status(400).json({ 
        msg: 'Validation failed',
        errors 
      });
    }

    res.status(500).json({ 
      msg: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Get dashboard analytics
exports.getDashboardAnalytics = async (req, res) => {
  try {
    const userId = req.user.id;
    const organizationId = req.user.currentOrganization;
    
    if (!organizationId) {
      return res.status(400).json({ 
        msg: 'Organization required',
        requiresOrganizationSetup: true
      });
    }
    
    // Analytics now show all-time totals; ignore range
    const startDate = null;

    // Organization filter for all queries
    const orgFilter = { organization: organizationId };

    // Parallel data fetching for better performance
    const [
      totalCandidates,
      totalJobs,
      candidatesThisMonth,
      jobsThisMonth,
      candidatesByStatus,
      jobsByStatus,
      candidatesBySource,
      recentActivity,
      candidatesTimeline,
      jobsTimeline,
      topPerformingJobs,
      candidateSkillsDistribution
    ] = await Promise.all([
      // Total counts (filtered by organization)
      Candidate.countDocuments(orgFilter),
      Job.countDocuments(orgFilter),
      
      // Period counts (all-time to match totals)
      Candidate.countDocuments(orgFilter),
      Job.countDocuments(orgFilter),
      
      // Status distributions (filtered by organization, all-time)
      Candidate.aggregate([
        { $match: orgFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      Job.aggregate([
        { $match: orgFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      
      // Source distribution (filtered by organization, all-time)
      Candidate.aggregate([
        { $match: orgFilter },
        { $group: { _id: '$source', count: { $sum: 1 } } }
      ]),
      
      // Recent activity (last 10 items, filtered by organization)
      Promise.all([
        Candidate.find(orgFilter)
          .sort({ createdAt: -1 })
          .limit(5)
          .select('firstName lastName position createdAt status')
          .lean(),
        Job.find(orgFilter)
          .sort({ createdAt: -1 })
          .limit(5)
          .select('title department createdAt status')
          .lean()
      ]),
      
      // Timeline data for charts (filtered by organization, all-time)
      Candidate.aggregate([
        {
          $match: { ...orgFilter }
        },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
      ]),
      
      Job.aggregate([
        {
          $match: { ...orgFilter }
        },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
      ]),
      
      // Top performing jobs (by application count, filtered by organization, all-time)
      Job.aggregate([
        { $match: orgFilter },
        {
          $addFields: {
            applicantCount: { $size: '$applicants' }
          }
        },
        { $sort: { applicantCount: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: 'departments',
            localField: 'department',
            foreignField: '_id',
            as: 'departmentInfo'
          }
        },
        {
          $addFields: {
            department: { $arrayElemAt: ['$departmentInfo.name', 0] }
          }
        },
        {
          $project: {
            title: 1,
            department: 1,
            applicantCount: 1,
            status: 1
          }
        }
      ]),
      
      // Skills distribution (filtered by organization)
      Candidate.aggregate([
        { $match: { ...orgFilter, skills: { $exists: true, $ne: '' } } },
        {
          $project: {
            skillsArray: {
              $split: ['$skills', ',']
            }
          }
        },
        { $unwind: '$skillsArray' },
        {
          $group: {
            _id: { $trim: { input: { $toLower: '$skillsArray' } } },
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ])
    ]);

    // Get recent activity from notifications (organization-wide) instead of demo data
    const Notification = require('../models/Notification');
    const User = require('../models/User');
    const activityTypes = ['job_created', 'candidate_uploaded', 'interview_created'];
    
    // Get current user to find their organization
    const currentUser = await User.findById(userId);
    if (!currentUser || !currentUser.currentOrganization) {
      return res.status(400).json({ error: 'User organization not found' });
    }

    // Get all users in the same organization
    const orgUsers = await User.find({ 
      currentOrganization: currentUser.currentOrganization 
    }).select('_id');
    
    const orgUserIds = orgUsers.map(user => user._id);
    
    const recentActivities = await Notification.find({
      user: { $in: orgUserIds }, // Activities from all organization members
      type: { $in: activityTypes },
      $or: [
        { expiresAt: null },
        { expiresAt: { $gt: new Date() } }
      ]
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const combinedActivity = recentActivities.map(notification => ({
      type: notification.type.replace('_created', '').replace('_uploaded', ''),
      title: notification.title,
      subtitle: notification.message,
      timestamp: notification.createdAt,
      status: 'completed'
    }));

    // Calculate trends
    const calculateTrend = (current, previous) => {
      if (previous === 0) return { value: 0, direction: 'neutral' };
      const change = ((current - previous) / previous) * 100;
      return {
        value: Math.abs(Math.round(change)),
        direction: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral'
      };
    };

    // No previous period comparison for all-time view
    const prevCandidates = 0;
    const prevJobs = 0;

    // Compute active jobs as an all-time count (not tied to range)
    const activeJobsAllTime = await Job.countDocuments({ ...orgFilter, status: 'active' });

    // Build response
    const analytics = {
      overview: {
        totalCandidates: {
          value: totalCandidates,
          trend: { value: 0, direction: 'neutral' },
          label: 'all-time total'
        },
        totalJobs: {
          value: totalJobs,
          trend: { value: 0, direction: 'neutral' },
          label: 'all-time total'
        },
        activeJobs: {
          value: activeJobsAllTime,
          trend: { value: 0, direction: 'neutral' },
          label: 'currently active'
        },
        candidatesInReview: {
          value: candidatesByStatus.find(c => c._id === 'Screening')?.count || 0,
          trend: { value: 0, direction: 'neutral' },
          label: 'pending review'
        }
      },
      
      distributions: {
        candidatesByStatus: candidatesByStatus.map(item => ({
          name: item._id,
          value: item.count
        })),
        jobsByStatus: jobsByStatus.map(item => ({
          name: item._id,
          value: item.count
        })),
        candidatesBySource: candidatesBySource.map(item => ({
          name: item._id,
          value: item.count
        })),
        topSkills: candidateSkillsDistribution.map(item => ({
          name: item._id,
          count: item.count
        }))
      },
      
      timeline: {
        candidates: candidatesTimeline.map(item => ({
          date: `${item._id.year}-${String(item._id.month).padStart(2, '0')}-${String(item._id.day).padStart(2, '0')}`,
          count: item.count
        })),
        jobs: jobsTimeline.map(item => ({
          date: `${item._id.year}-${String(item._id.month).padStart(2, '0')}-${String(item._id.day).padStart(2, '0')}`,
          count: item.count
        }))
      },
      
      topPerformingJobs,
      recentActivity: combinedActivity,
      
      meta: {
        generatedAt: new Date(),
        range: `all-time`,
        dataPoints: {
          candidates: candidatesTimeline.length,
          jobs: jobsTimeline.length
        }
      }
    };

    res.json(analytics);
  } catch (error) {
    console.error('Error fetching dashboard analytics:', error);
    res.status(500).json({ msg: 'Server error fetching analytics' });
  }
};

// Get user statistics
exports.getUserStats = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    
    // Get user activity stats
    const stats = {
      profile: {
        completionPercentage: user.profileCompletion.percentage,
        missingFields: user.profileCompletion.missingFields,
        lastUpdated: user.profileCompletion.lastUpdated
      },
      activity: {
        loginCount: user.loginCount,
        lastLoginAt: user.lastLoginAt,
        accountAge: Math.floor((Date.now() - user.createdAt) / (1000 * 60 * 60 * 24))
      },
      permissions: user.permissions,
      features: user.features,
      subscription: user.subscription
    };

    res.json(stats);
  } catch (error) {
    console.error('Error fetching user stats:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Update user preferences
exports.updatePreferences = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    user.preferences = { ...user.preferences.toObject(), ...req.body };
    await user.save();

    res.json({ msg: 'Preferences updated successfully', preferences: user.preferences });
  } catch (error) {
    console.error('Error updating preferences:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Change password
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ msg: 'Current password and new password are required' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: 'Current password is incorrect' });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.lastPasswordChange = new Date();

    await user.save();

    res.json({ msg: 'Password changed successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Upload avatar
exports.uploadAvatar = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ msg: 'No file uploaded' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    // Update avatar URL (assuming you're using Cloudinary or similar)
    user.profile.avatar = req.file.secure_url || req.file.path;
    await user.save();

    res.json({ 
      msg: 'Avatar uploaded successfully', 
      avatarUrl: user.profile.avatar 
    });
  } catch (error) {
    console.error('Error uploading avatar:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Get profile completion suggestions
exports.getProfileSuggestions = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    
    const suggestions = [];
    
    if (!user.profile.firstName || !user.profile.lastName) {
      suggestions.push({
        type: 'profile',
        title: 'Complete your name',
        description: 'Add your first and last name to personalize your account',
        action: 'update_profile',
        priority: 'high'
      });
    }

    if (!user.profile.avatar) {
      suggestions.push({
        type: 'profile',
        title: 'Add profile picture',
        description: 'Upload a profile picture to make your account more personal',
        action: 'upload_avatar',
        priority: 'medium'
      });
    }

    if (!user.company.name) {
      suggestions.push({
        type: 'company',
        title: 'Add company information',
        description: 'Tell us about your company to better customize your experience',
        action: 'update_company',
        priority: 'high'
      });
    }

    if (!user.profile.title) {
      suggestions.push({
        type: 'profile',
        title: 'Add your job title',
        description: 'Let your team know your role in the organization',
        action: 'update_profile',
        priority: 'medium'
      });
    }

    res.json({
      suggestions,
      completionPercentage: user.profileCompletion.percentage,
      missingFields: user.profileCompletion.missingFields
    });
  } catch (error) {
    console.error('Error fetching profile suggestions:', error);
    res.status(500).json({ msg: 'Server error' });
  }
}; 