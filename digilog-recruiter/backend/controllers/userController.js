const prisma = require('../db/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Replaces a Mongo $group on { $year/$month/$dayOfMonth: '$createdAt' }.
// Returns rows shaped { _id: { year, month, day }, count } sorted ascending by
// year, then month, then day — matching the original aggregation pipeline.
// Date parts use UTC to match MongoDB's default date-operator behavior.
function buildDateTimeline(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const d = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const key = `${year}-${month}-${day}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      buckets.set(key, { _id: { year, month, day }, count: 1 });
    }
  }
  return [...buckets.values()].sort((a, b) =>
    a._id.year - b._id.year || a._id.month - b._id.month || a._id.day - b._id.day
  );
}

// Get current user profile
exports.getProfile = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }
    if (user.password !== undefined) delete user.password;

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

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    const updateData = {};

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
      updateData.profile = { ...(user.profile || {}), ...cleanProfile };
    }

    // Update preferences
    if (preferences) {
      updateData.preferences = { ...(user.preferences || {}), ...preferences };
    }

    await prisma.user.update({ where: { id: user.id }, data: updateData });

    // Return user without password
    const updatedUser = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (updatedUser && updatedUser.password !== undefined) delete updatedUser.password;
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

    // Organization filter for all queries (Prisma where clause)
    const orgFilter = { organizationId };

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
      prisma.candidate.count({ where: orgFilter }),
      prisma.job.count({ where: orgFilter }),

      // Period counts (all-time to match totals)
      prisma.candidate.count({ where: orgFilter }),
      prisma.job.count({ where: orgFilter }),

      // Status distributions (filtered by organization, all-time)
      prisma.candidate.groupBy({ by: ['status'], where: orgFilter, _count: { _all: true } })
        .then(rows => rows.map(r => ({ _id: r.status, count: r._count._all }))),
      prisma.job.groupBy({ by: ['status'], where: orgFilter, _count: { _all: true } })
        .then(rows => rows.map(r => ({ _id: r.status, count: r._count._all }))),

      // Source distribution (filtered by organization, all-time)
      prisma.candidate.groupBy({ by: ['source'], where: orgFilter, _count: { _all: true } })
        .then(rows => rows.map(r => ({ _id: r.source, count: r._count._all }))),

      // Recent activity (last 10 items, filtered by organization)
      Promise.all([
        prisma.candidate.findMany({
          where: orgFilter,
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { firstName: true, lastName: true, position: true, createdAt: true, status: true }
        }),
        prisma.job.findMany({
          where: orgFilter,
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { title: true, departmentId: true, createdAt: true, status: true }
        })
      ]),

      // Timeline data for charts (filtered by organization, all-time) — computed in JS
      prisma.candidate.findMany({ where: orgFilter, select: { createdAt: true } })
        .then(rows => buildDateTimeline(rows)),

      prisma.job.findMany({ where: orgFilter, select: { createdAt: true } })
        .then(rows => buildDateTimeline(rows)),

      // Top performing jobs (by application count, filtered by organization, all-time)
      (async () => {
        const jobs = await prisma.job.findMany({
          where: orgFilter,
          select: { id: true, title: true, departmentId: true, status: true, applicants: true }
        });
        const ranked = jobs
          .map(j => ({
            _id: j.id,
            title: j.title,
            departmentId: j.departmentId,
            status: j.status,
            applicantCount: Array.isArray(j.applicants) ? j.applicants.length : 0
          }))
          .sort((a, b) => b.applicantCount - a.applicantCount)
          .slice(0, 5);
        // Stitch department name (Mongo $lookup on departments by _id)
        const deptIds = [...new Set(ranked.map(j => j.departmentId).filter(Boolean))];
        const depts = deptIds.length
          ? await prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } })
          : [];
        const deptNameById = Object.fromEntries(depts.map(d => [d.id, d.name]));
        return ranked.map(j => ({
          _id: j._id,
          title: j.title,
          department: j.departmentId ? deptNameById[j.departmentId] : undefined,
          applicantCount: j.applicantCount,
          status: j.status
        }));
      })(),

      // Skills distribution (filtered by organization) — computed in JS
      prisma.candidate.findMany({
        where: { ...orgFilter, skills: { not: null } },
        select: { skills: true }
      }).then(rows => {
        const counts = new Map();
        for (const row of rows) {
          if (!row.skills || row.skills === '') continue;
          for (const raw of String(row.skills).split(',')) {
            const skill = raw.toLowerCase().trim();
            if (!skill) continue;
            counts.set(skill, (counts.get(skill) || 0) + 1);
          }
        }
        return [...counts.entries()]
          .map(([_id, count]) => ({ _id, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);
      })
    ]);

    // Get recent activity from notifications (organization-wide) instead of demo data
    const activityTypes = ['job_created', 'candidate_uploaded', 'interview_created'];

    // Get current user to find their organization
    const currentUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!currentUser || !currentUser.currentOrganizationId) {
      return res.status(400).json({ error: 'User organization not found' });
    }

    // Get all users in the same organization
    const orgUsers = await prisma.user.findMany({
      where: { currentOrganizationId: currentUser.currentOrganizationId },
      select: { id: true }
    });

    const orgUserIds = orgUsers.map(user => user.id);

    const recentActivities = await prisma.notification.findMany({
      where: {
        userId: { in: orgUserIds }, // Activities from all organization members
        type: { in: activityTypes },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

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
    const activeJobsAllTime = await prisma.job.count({ where: { ...orgFilter, status: 'active' } });

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
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (user && user.password !== undefined) delete user.password;

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
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    const preferences = { ...(user.preferences || {}), ...req.body };
    await prisma.user.update({ where: { id: user.id }, data: { preferences } });

    res.json({ msg: 'Preferences updated successfully', preferences });
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

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
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
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, lastPasswordChange: new Date() }
    });

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

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    // Update avatar URL (assuming you're using Cloudinary or similar)
    const profile = { ...(user.profile || {}) };
    profile.avatar = req.file.secure_url || req.file.path;
    await prisma.user.update({ where: { id: user.id }, data: { profile } });

    res.json({
      msg: 'Avatar uploaded successfully',
      avatarUrl: profile.avatar
    });
  } catch (error) {
    console.error('Error uploading avatar:', error);
    res.status(500).json({ msg: 'Server error' });
  }
};

// Get profile completion suggestions
exports.getProfileSuggestions = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (user && user.password !== undefined) delete user.password;

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