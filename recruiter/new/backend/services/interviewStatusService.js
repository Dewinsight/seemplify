/**
 * Interview Status Management Service
 * Handles automatic status updates for interviews based on time and conditions
 */

const Interview = require('../models/Interview');
const Job = require('../models/Job');
const User = require('../models/User');

class InterviewStatusService {
  constructor() {
    // Run every hour to check for missed interviews
    this.startStatusUpdateScheduler();
  }

  /**
   * Start the automated status update scheduler
   */
  startStatusUpdateScheduler() {
    // Run immediately on service start
    this.checkAndUpdateMissedInterviews();
    
    // Then run every hour (3600000 ms)
    setInterval(() => {
      this.checkAndUpdateMissedInterviews();
    }, 3600000); // 1 hour

    console.log('🕐 Interview Status Service: Scheduler started (checks every hour)');
  }

  /**
   * Check for scheduled interviews older than 5 days and mark them as missed
   */
  async checkAndUpdateMissedInterviews() {
    try {
      const fiveDaysAgo = new Date(Date.now() - (5 * 24 * 60 * 60 * 1000));
      
      console.log('🔍 [INTERVIEW-STATUS] Checking for missed interviews older than 5 days...');
      
      // Find scheduled interviews older than 5 days
      const overdueInterviews = await Interview.find({
        status: 'scheduled',
        scheduledAt: { $lt: fiveDaysAgo }
      }).populate([
        { path: 'candidateId', select: 'firstName lastName email' },
        { path: 'interviewerId', select: 'firstName lastName email' },
        { path: 'jobId', select: 'title' }
      ]);

      if (overdueInterviews.length === 0) {
        console.log('✅ [INTERVIEW-STATUS] No missed interviews found');
        return { updated: 0, interviews: [] };
      }

      console.log(`⚠️ [INTERVIEW-STATUS] Found ${overdueInterviews.length} overdue scheduled interviews`);

      const updatedInterviews = [];
      
      for (const interview of overdueInterviews) {
        const daysPast = Math.floor((Date.now() - interview.scheduledAt.getTime()) / (1000 * 60 * 60 * 24));
        
        console.log(`📅 [INTERVIEW-STATUS] Updating interview ${interview._id}:`);
        console.log(`   • Candidate: ${interview.candidateId?.firstName} ${interview.candidateId?.lastName}`);
        console.log(`   • Job: ${interview.jobId?.title}`);
        console.log(`   • Scheduled: ${interview.scheduledAt.toISOString()}`);
        console.log(`   • Days overdue: ${daysPast}`);
        
        // Update interview status
        interview.status = 'missed';
        interview.missedAt = new Date();
        
        // Add system note explaining the automatic status change
        if (!interview.notes || !Array.isArray(interview.notes)) {
          interview.notes = [];
        }
        
        interview.notes.push({
          note: `Interview automatically marked as missed after ${daysPast} days. Original schedule: ${interview.scheduledAt.toLocaleDateString()} at ${interview.scheduledAt.toLocaleTimeString()}`,
          addedBy: 'system',
          addedAt: new Date()
        });

        await interview.save();
        updatedInterviews.push({
          interviewId: interview._id,
          candidateName: `${interview.candidateId?.firstName} ${interview.candidateId?.lastName}`,
          jobTitle: interview.jobId?.title,
          originalScheduledAt: interview.scheduledAt,
          daysPast
        });

        console.log(`✅ [INTERVIEW-STATUS] Interview ${interview._id} marked as missed`);
      }

      console.log(`🎯 [INTERVIEW-STATUS] Successfully updated ${updatedInterviews.length} interviews to 'missed' status`);
      
      return {
        updated: updatedInterviews.length,
        interviews: updatedInterviews
      };

    } catch (error) {
      console.error('❌ [INTERVIEW-STATUS] Error updating missed interviews:', error);
      // Don't throw - this is a background service
      return { updated: 0, interviews: [], error: error.message };
    }
  }

  /**
   * Manually trigger missed interview check (for testing or manual runs)
   */
  async manualCheckMissedInterviews() {
    console.log('🔧 [INTERVIEW-STATUS] Manual check triggered');
    return await this.checkAndUpdateMissedInterviews();
  }

  /**
   * Get statistics about interview statuses
   */
  async getInterviewStatusStats() {
    try {
      const stats = await Interview.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);

      const statusCounts = {};
      stats.forEach(stat => {
        statusCounts[stat._id] = stat.count;
      });

      // Get overdue scheduled interviews count
      const fiveDaysAgo = new Date(Date.now() - (5 * 24 * 60 * 60 * 1000));
      const overdueCount = await Interview.countDocuments({
        status: 'scheduled',
        scheduledAt: { $lt: fiveDaysAgo }
      });

      return {
        statusCounts,
        overdueScheduled: overdueCount,
        lastChecked: new Date()
      };

    } catch (error) {
      console.error('❌ [INTERVIEW-STATUS] Error getting status stats:', error);
      return { error: error.message };
    }
  }
}

// Export singleton instance
module.exports = new InterviewStatusService();
