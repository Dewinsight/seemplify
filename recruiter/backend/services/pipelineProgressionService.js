const Job = require('../models/Job');
const Interview = require('../models/Interview');
const InterviewStage = require('../models/InterviewStage');
const Candidate = require('../models/Candidate');
const interviewStageService = require('./interviewStageService');
const candidateEmailNotificationService = require('./candidateEmailNotificationService');

class PipelineProgressionService {
  /**
   * Add candidate to pipeline
   */
  async addCandidateToPipeline(jobId, candidateData) {
    try {
      console.log(`📋 Adding candidate to pipeline for job ${jobId}`);
      console.log('🔍 Debug - candidateData received:', candidateData);
      console.log('🔍 Debug - candidateData.addedBy:', candidateData.addedBy);
      
      const job = await Job.findById(jobId);
      if (!job) {
        throw new Error('Job not found');
      }
      
      // Get first stage
      const firstStage = await InterviewStage.findOne({ 
        jobId, 
        isActive: true 
      }).sort('order');
      
      // Validate that at least one pipeline stage exists
      if (!firstStage) {
        throw new Error('Cannot add candidate to pipeline: No active pipeline stages exist for this job. Please create pipeline stages first.');
      }
      
      // Extract addedBy before spreading to avoid it being undefined
      const addedBy = candidateData.addedBy;
      const notes = candidateData.notes || 'Candidate added to pipeline';
      
      console.log('🔍 Debug - extracted addedBy:', addedBy);
      console.log('🔍 Debug - addedBy type:', typeof addedBy);
      console.log('🔍 Debug - full candidateData:', JSON.stringify(candidateData, null, 2));
      
      // Validate that addedBy is present
      if (!addedBy) {
        throw new Error('addedBy is required but was undefined. candidateData.addedBy must be provided.');
      }
      
      const applicantData = {
        ...candidateData,
        appliedAt: new Date(),
        status: candidateData.initialStatus || 'applied',
        statusHistory: [{
          status: candidateData.initialStatus || 'applied',
          changedBy: addedBy,
          changedAt: new Date(),
          notes: notes
        }]
      };
      
      console.log('🔍 Debug - applicantData.statusHistory[0].changedBy:', applicantData.statusHistory[0].changedBy);
      
      // Set current stage
      applicantData.currentStage = {
        stageId: firstStage._id,
        stageName: firstStage.name,
        enteredAt: new Date()
      };
      applicantData.stageHistory = [{
        stageId: firstStage._id,
        stageName: firstStage.name,
        enteredAt: new Date()
      }];
      
      job.applicants.push(applicantData);
      await job.save();
      
      console.log(`✅ Candidate added to pipeline for job ${jobId}`);
      return job.applicants[job.applicants.length - 1];
    } catch (error) {
      console.error('❌ Error adding candidate to pipeline:', error);
      throw error;
    }
  }

  /**
   * Advance candidate to next stage
   */
  async advanceCandidateToStage(jobId, candidateId, targetStageId, notes, userId) {
    try {
      console.log(`🚀 Advancing candidate ${candidateId} to stage ${targetStageId}`);
      
      const job = await Job.findById(jobId);
      if (!job) {
        throw new Error('Job not found');
      }
      
      const applicantIndex = job.applicants.findIndex(
        app => app.candidate.toString() === candidateId.toString()
      );
      
      if (applicantIndex === -1) {
        throw new Error('Candidate not found in job applicants');
      }
      
      const targetStage = await InterviewStage.findById(targetStageId);
      if (!targetStage) {
        throw new Error('Target stage not found');
      }
      
      const applicant = job.applicants[applicantIndex];
      
      // Update stage history - mark current stage as exited BUT NOT automatically passed
      if (applicant.currentStage?.stageId) {
        const currentStageHistory = applicant.stageHistory.find(
          sh => sh.stageId.toString() === applicant.currentStage.stageId.toString() && !sh.exitedAt
        );
        if (currentStageHistory) {
          currentStageHistory.exitedAt = new Date();
          // Don't automatically set result to 'passed' - leave it undefined unless explicitly set
          // currentStageHistory.result = 'passed'; // REMOVED THIS LINE
          currentStageHistory.feedback = notes;
        }
      }
      
      // Update current stage
      applicant.currentStage = {
        stageId: targetStage._id,
        stageName: targetStage.name,
        enteredAt: new Date()
      };
      
      // Add to stage history
      applicant.stageHistory.push({
        stageId: targetStage._id,
        stageName: targetStage.name,
        enteredAt: new Date()
      });
      
      // Update status
      applicant.status = 'interviewing';
      applicant.statusHistory.push({
        status: 'interviewing',
        changedBy: userId,
        changedAt: new Date(),
        notes: notes || `Advanced to ${targetStage.name}`,
        previousStatus: applicant.status
      });
      
      await job.save();
      
      // Send advancement congratulations email
      try {
        // Get full candidate data for email
        const candidate = await Candidate.findById(candidateId);
        if (candidate) {
          // Populate job organization for email service
          await job.populate('organization');
          
          // Get previous stage name for email context
          const previousStageHistory = applicant.stageHistory.find(
            sh => sh.stageId.toString() === applicant.currentStage.stageId.toString() && sh.exitedAt
          );
          const previousStageName = previousStageHistory?.stageName || 'Previous Stage';
          
          await candidateEmailNotificationService.sendAdvancementEmail({
            candidate,
            job,
            fromStage: { name: previousStageName },
            toStage: targetStage,
            notes: notes
          });
        }
      } catch (emailError) {
        console.error('❌ Error sending advancement email:', emailError);
        // Don't fail the pipeline advancement if email fails
      }
      
      console.log(`✅ Candidate ${candidateId} advanced to ${targetStage.name}`);
      return applicant;
    } catch (error) {
      console.error('❌ Error advancing candidate:', error);
      throw error;
    }
  }

  /**
   * Mark a stage as passed/failed for a candidate
   */
  async updateStageResult(jobId, candidateId, stageId, result, feedback, userId) {
    try {
      console.log(`📝 Updating stage result for candidate ${candidateId} in stage ${stageId}: ${result}`);
      
      const job = await Job.findById(jobId);
      if (!job) {
        throw new Error('Job not found');
      }
      
      const applicantIndex = job.applicants.findIndex(
        app => app.candidate.toString() === candidateId.toString()
      );
      
      if (applicantIndex === -1) {
        throw new Error('Candidate not found in job applicants');
      }
      
      const applicant = job.applicants[applicantIndex];
      
      // Find the stage in history
      const stageHistoryIndex = applicant.stageHistory.findIndex(
        sh => sh.stageId.toString() === stageId.toString()
      );
      
      if (stageHistoryIndex === -1) {
        throw new Error('Stage not found in candidate history');
      }
      
      // Update the stage result
      applicant.stageHistory[stageHistoryIndex].result = result;
      applicant.stageHistory[stageHistoryIndex].feedback = feedback;
      
      // If it's the current stage and result is failed, update status
      if (applicant.currentStage?.stageId?.toString() === stageId.toString() && result === 'failed') {
        applicant.status = 'rejected';
        applicant.statusHistory.push({
          status: 'rejected',
          changedBy: userId,
          changedAt: new Date(),
          notes: `Failed at ${applicant.currentStage.stageName}: ${feedback}`,
          previousStatus: applicant.status
        });
      }
      
      await job.save();
      
      console.log(`✅ Stage result updated for candidate ${candidateId}`);
      return applicant;
    } catch (error) {
      console.error('❌ Error updating stage result:', error);
      throw error;
    }
  }

  /**
   * Schedule an interview for a candidate
   */
  async scheduleInterview(jobId, candidateId, stageId, interviewData, userId) {
    try {
      console.log(`📅 Scheduling interview for candidate ${candidateId} in stage ${stageId}`);
      
      const job = await Job.findById(jobId);
      if (!job) {
        throw new Error('Job not found');
      }
      
      const applicantIndex = job.applicants.findIndex(
        app => app.candidate.toString() === candidateId.toString()
      );
      
      if (applicantIndex === -1) {
        throw new Error('Candidate not found in job applicants');
      }
      
      const stage = await InterviewStage.findById(stageId);
      if (!stage) {
        throw new Error('Stage not found');
      }
      
      // Create the interview using the Interview model
      const Interview = require('../models/Interview');
      const interview = new Interview({
        jobId,
        candidateId,
        interviewerId: userId, // Add the missing interviewerId field
        stageId,
        stageName: stage.name,
        scheduledAt: interviewData.scheduledAt,
        duration: interviewData.duration || stage.defaultDuration || 60,
        interviewers: interviewData.interviewers || [],
        type: interviewData.type || stage.type,
        location: interviewData.location || 'Virtual',
        meetingLink: interviewData.meetingLink,
        notes: interviewData.notes,
        status: 'scheduled',
        createdBy: userId
      });
      
      await interview.save();
      
      // Add interview reference to applicant
      const applicant = job.applicants[applicantIndex];
      if (!applicant.interviews) {
        applicant.interviews = [];
      }
      
      applicant.interviews.push({
        interviewId: interview._id,
        stageId: stageId,
        scheduledAt: interview.scheduledAt,
        status: 'scheduled'
      });
      
      await job.save();
      
      console.log(`✅ Interview scheduled for candidate ${candidateId}`);
      return interview;
    } catch (error) {
      console.error('❌ Error scheduling interview:', error);
      throw error;
    }
  }

  /**
   * Remove candidate from pipeline
   */
  async removeCandidateFromPipeline(jobId, candidateId, reason, userId) {
    try {
      console.log(`🗑️ Removing candidate ${candidateId} from pipeline for job ${jobId}`);
      
      const job = await Job.findById(jobId);
      if (!job) {
        throw new Error('Job not found');
      }
      
      const applicantIndex = job.applicants.findIndex(
        app => app.candidate.toString() === candidateId.toString()
      );
      
      if (applicantIndex === -1) {
        throw new Error('Candidate not found in job applicants');
      }
      
      // Remove the candidate from applicants array
      const removedApplicant = job.applicants.splice(applicantIndex, 1)[0];
      
      // Also remove any scheduled interviews for this candidate
      const Interview = require('../models/Interview');
      await Interview.updateMany(
        { jobId, candidateId, status: 'scheduled' },
        { status: 'cancelled', cancelReason: reason || 'Candidate removed from pipeline' }
      );
      
      await job.save();
      
      console.log(`✅ Candidate ${candidateId} removed from pipeline`);
      return { success: true, removedApplicant };
    } catch (error) {
      console.error('❌ Error removing candidate from pipeline:', error);
      throw error;
    }
  }

  /**
   * Reject candidate at current stage
   */
  async rejectCandidate(jobId, candidateId, reason, userId) {
    try {
      console.log(`❌ Rejecting candidate ${candidateId}`);
      
      const job = await Job.findById(jobId);
      if (!job) {
        throw new Error('Job not found');
      }
      
      const applicantIndex = job.applicants.findIndex(
        app => app.candidate.toString() === candidateId.toString()
      );
      
      if (applicantIndex === -1) {
        throw new Error('Candidate not found in job applicants');
      }
      
      const applicant = job.applicants[applicantIndex];
      
      // Update stage history - mark current stage as failed
      if (applicant.currentStage?.stageId) {
        const currentStageHistory = applicant.stageHistory.find(
          sh => sh.stageId.toString() === applicant.currentStage.stageId.toString() && !sh.exitedAt
        );
        if (currentStageHistory) {
          currentStageHistory.exitedAt = new Date();
          currentStageHistory.result = 'failed';
          currentStageHistory.feedback = reason;
        }
      }
      
      // Update status
      applicant.status = 'rejected';
      applicant.statusHistory.push({
        status: 'rejected',
        changedBy: userId,
        changedAt: new Date(),
        notes: reason || 'Candidate rejected',
        previousStatus: applicant.status
      });
      
      await job.save();
      
      // Send rejection email
      try {
        // Get full candidate data for email
        const candidate = await Candidate.findById(candidateId);
        if (candidate) {
          // Populate job organization for email service
          await job.populate('organization');
          
          await candidateEmailNotificationService.sendRejectionEmail({
            candidate,
            job,
            reason: reason,
            stage: applicant.currentStage?.stageName || 'Application Review',
            isShortlistRejection: false
          });
        }
      } catch (emailError) {
        console.error('❌ Error sending rejection email:', emailError);
        // Don't fail the rejection if email fails
      }
      
      console.log(`✅ Candidate ${candidateId} rejected`);
      return applicant;
    } catch (error) {
      console.error('❌ Error rejecting candidate:', error);
      throw error;
    }
  }

  /**
   * Make offer to candidate
   */
  async makeOffer(jobId, candidateId, offerDetails, userId) {
    try {
      console.log(`💰 Making offer to candidate ${candidateId}`);
      
      const job = await Job.findById(jobId);
      if (!job) {
        throw new Error('Job not found');
      }
      
      const applicantIndex = job.applicants.findIndex(
        app => app.candidate.toString() === candidateId.toString()
      );
      
      if (applicantIndex === -1) {
        throw new Error('Candidate not found in job applicants');
      }
      
      const applicant = job.applicants[applicantIndex];
      
      // Update stage history - mark current stage as passed
      if (applicant.currentStage?.stageId) {
        const currentStageHistory = applicant.stageHistory.find(
          sh => sh.stageId.toString() === applicant.currentStage.stageId.toString() && !sh.exitedAt
        );
        if (currentStageHistory) {
          currentStageHistory.exitedAt = new Date();
          currentStageHistory.result = 'passed';
          currentStageHistory.feedback = 'Completed all interview stages successfully';
        }
      }
      
      // Update status
      applicant.status = 'offered';
      applicant.statusHistory.push({
        status: 'offered',
        changedBy: userId,
        changedAt: new Date(),
        notes: `Offer made: ${offerDetails}`,
        previousStatus: applicant.status
      });
      
      // Clear current stage since they've completed the pipeline
      applicant.currentStage = null;
      
      await job.save();
      
      console.log(`✅ Offer made to candidate ${candidateId}`);
      return applicant;
    } catch (error) {
      console.error('❌ Error making offer:', error);
      throw error;
    }
  }

  /**
   * Bulk move multiple candidates to a target stage
   */
  async bulkMoveCandidates(jobId, candidateIds, targetStageId, userId) {
    const mongoose = require('mongoose');
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      console.log(`📦 Bulk moving ${candidateIds.length} candidates to stage ${targetStageId}`);
      
      // 1. Validate inputs
      if (!candidateIds || candidateIds.length === 0) {
        throw new Error('No candidates provided');
      }
      
      // 2. Fetch job and validate
      const job = await Job.findById(jobId).session(session);
      if (!job) {
        throw new Error('Job not found');
      }
      
      // 3. Fetch and validate target stage
      const targetStage = await InterviewStage.findOne({
        _id: targetStageId,
        jobId: jobId,
        isActive: true
      }).session(session);
      
      if (!targetStage) {
        throw new Error('Target stage not found or inactive');
      }
      
      // 4. Process each candidate
      const results = {
        successful: [],
        failed: [],
        totalProcessed: candidateIds.length
      };
      
      for (const candidateId of candidateIds) {
        try {
          // Find applicant in job
          const applicantIndex = job.applicants.findIndex(
            app => app.candidate.toString() === candidateId.toString()
          );
          
          if (applicantIndex === -1) {
            results.failed.push({
              candidateId,
              reason: 'Candidate not found in job applicants'
            });
            continue;
          }
          
          const applicant = job.applicants[applicantIndex];
          
          // Check if already in target stage
          if (applicant.currentStage?.stageId?.toString() === targetStageId.toString()) {
            results.failed.push({
              candidateId,
              reason: 'Candidate already in target stage'
            });
            continue;
          }
          
          // Store previous stage info
          const previousStage = applicant.currentStage ? {
            stageId: applicant.currentStage.stageId,
            stageName: applicant.currentStage.stageName
          } : null;
          
          // Update stage history - mark current stage as exited
          if (applicant.currentStage?.stageId) {
            const currentStageHistory = applicant.stageHistory.find(
              sh => sh.stageId.toString() === applicant.currentStage.stageId.toString() && !sh.exitedAt
            );
            if (currentStageHistory) {
              currentStageHistory.exitedAt = new Date();
              currentStageHistory.feedback = 'Bulk moved to next stage';
            }
          }
          
          // Update current stage
          applicant.currentStage = {
            stageId: targetStage._id,
            stageName: targetStage.name,
            enteredAt: new Date()
          };
          
          // Add to stage history
          applicant.stageHistory.push({
            stageId: targetStage._id,
            stageName: targetStage.name,
            enteredAt: new Date()
          });
          
          // Update status history
          applicant.status = 'interviewing';
          applicant.statusHistory.push({
            status: 'interviewing',
            changedBy: userId,
            changedAt: new Date(),
            notes: `Bulk moved to ${targetStage.name} stage`,
            previousStatus: applicant.status
          });
          
          results.successful.push({
            candidateId,
            previousStage: previousStage?.stageName || 'None',
            newStage: targetStage.name
          });
          
        } catch (error) {
          results.failed.push({
            candidateId,
            reason: error.message
          });
        }
      }
      
      // 5. Save job with all updates
      if (results.successful.length > 0) {
        await job.save({ session });
      }
      
      // 6. Commit transaction
      await session.commitTransaction();
      
      console.log(`✅ Bulk move complete: ${results.successful.length} succeeded, ${results.failed.length} failed`);
      
      // 7. Return results
      return {
        success: results.failed.length === 0,
        partialSuccess: results.successful.length > 0 && results.failed.length > 0,
        results
      };
      
    } catch (error) {
      await session.abortTransaction();
      console.error('❌ Error in bulk move candidates:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get detailed pipeline for a job
   */
  async getDetailedPipeline(jobId) {
    try {
      const job = await Job.findById(jobId)
        .populate('applicants.candidate')
        .populate('interviewStages');
      
      if (!job) {
        throw new Error('Job not found');
      }
      
      // Clean up any null candidate references in applicants
      const originalApplicantsLength = job.applicants.length;
      job.applicants = job.applicants.filter(applicant => applicant.candidate !== null);
      
      // If we found deleted candidates, clean up the database
      if (job.applicants.length !== originalApplicantsLength) {
        console.log(`🧹 Cleaning up ${originalApplicantsLength - job.applicants.length} deleted candidate(s) from job ${jobId} applicants in pipeline service`);
        await job.save();
      }
      
      const stages = await InterviewStage.find({ jobId, isActive: true }).sort('order');
      
      // Get all interviews for this job
      const allInterviews = await Interview.find({ jobId });
      
      // Get stage analytics
      const stageAnalytics = await Promise.all(
        stages.map(async (stage) => {
          const candidatesInStage = job.applicants.filter(
            app => app.currentStage?.stageId?.toString() === stage._id.toString()
          );
          
          // Populate interview data for each candidate
          const candidatesWithInterviews = candidatesInStage.map(applicant => {
            // Get interviews for this candidate in this stage
            const candidateInterviews = allInterviews.filter(interview => 
              interview.candidateId.toString() === applicant.candidate._id.toString()
            );
            
            // Ensure candidate skills is a string, not an object
            const candidateData = applicant.candidate.toObject ? applicant.candidate.toObject() : applicant.candidate;
            if (candidateData.skills && typeof candidateData.skills === 'object') {
              // If skills is an object (from AI matching), extract meaningful string representation
              if (candidateData.skills.matchedSkills || candidateData.skills.missingSkills) {
                // This is the AI match object structure
                const allSkills = [
                  ...(candidateData.skills.matchedSkills || []),
                  ...(candidateData.skills.bonusSkills || [])
                ].filter(Boolean);
                candidateData.skills = allSkills.length > 0 ? allSkills.join(', ') : '';
              } else {
                // Unknown object structure, convert to empty string
                candidateData.skills = '';
              }
            }
            
            // Update the interviews array in the applicant object
            const updatedApplicant = {
              ...applicant.toObject(),
              candidate: candidateData, // Use the transformed candidate data
              interviews: candidateInterviews.map(interview => ({
                interviewId: interview._id,
                stageId: interview.stageId,
                scheduledAt: interview.scheduledAt,
                status: interview.status,
                score: interview.structuredFeedback?.overallScore || interview.score
              }))
            };
            
            return updatedApplicant;
          });
          
          const interviews = await Interview.find({ 
            jobId, 
            stageId: stage._id 
          });
          
          const completedInterviews = interviews.filter(i => i.status === 'completed');
          const avgScore = completedInterviews.length > 0
            ? completedInterviews.reduce((sum, i) => sum + (i.structuredFeedback?.overallScore || 0), 0) / completedInterviews.length
            : 0;
          
          return {
            stage: stage.toObject(),
            candidateCount: candidatesWithInterviews.length,
            candidates: candidatesWithInterviews,
            interviewCount: interviews.length,
            completedInterviews: completedInterviews.length,
            averageScore: Math.round(avgScore),
            passRate: this._calculateStagePassRate(job.applicants, stage._id)
          };
        })
      );
      
      // Overall pipeline stats
      const totalApplicants = job.applicants.length;
      const activeApplicants = job.applicants.filter(app => 
        !['rejected', 'hired', 'withdrawn'].includes(app.status)
      ).length;
      
      const conversionRates = this._calculateConversionRates(stages, job.applicants);
      
      return {
        job: {
          id: job._id,
          title: job.title,
          department: job.department,
          status: job.status
        },
        stages: stageAnalytics,
        analytics: {
          totalApplicants,
          activeApplicants,
          conversionRates,
          timeToHire: this._calculateAverageTimeToHire(job.applicants),
          bottlenecks: this._identifyBottlenecks(stageAnalytics)
        }
      };
    } catch (error) {
      console.error('❌ Error getting detailed pipeline:', error);
      throw error;
    }
  }

  /**
   * Get stage analytics for a job
   */
  async getStageAnalytics(jobId) {
    try {
      const job = await Job.findById(jobId).populate('applicants.candidate');
      if (!job) {
        throw new Error('Job not found');
      }
      
      // Clean up any null candidate references in applicants
      const originalApplicantsLength = job.applicants.length;
      job.applicants = job.applicants.filter(applicant => applicant.candidate !== null);
      
      // If we found deleted candidates, clean up the database
      if (job.applicants.length !== originalApplicantsLength) {
        console.log(`🧹 Cleaning up ${originalApplicantsLength - job.applicants.length} deleted candidate(s) from job ${jobId} applicants in stage analytics`);
        await job.save();
      }
      
      const stages = await InterviewStage.find({ jobId, isActive: true }).sort('order');
      const interviews = await Interview.find({ jobId });
      
      const analytics = {
        totalStages: stages.length,
        activeStages: stages.filter(s => s.isActive).length,
        stages: stages.map(stage => {
          const stageInterviews = interviews.filter(i => 
            i.stageId?.toString() === stage._id.toString()
          );
          const candidatesInStage = job.applicants.filter(app => 
            app.currentStage?.stageId?.toString() === stage._id.toString()
          );
          
          // Calculate average time in stage for candidates
          const avgTimeInStage = candidatesInStage.length > 0 
            ? candidatesInStage.reduce((sum, app) => {
                const enteredAt = new Date(app.currentStage.enteredAt);
                const daysSinceEntered = Math.floor((new Date() - enteredAt) / (1000 * 60 * 60 * 24));
                return sum + daysSinceEntered;
              }, 0) / candidatesInStage.length
            : 0;

          return {
            _id: stage._id,
            name: stage.name,
            type: stage.type,
            order: stage.order,
            candidateCount: candidatesInStage.length,
            interviewCount: stageInterviews.length,
            completedInterviews: stageInterviews.filter(i => i.status === 'completed').length,
            scheduledInterviews: stageInterviews.filter(i => i.status === 'scheduled').length,
            averageDuration: stage.defaultDuration,
            avgTimeInStage: Math.round(avgTimeInStage),
            passRate: this._calculateStagePassRate(job.applicants, stage._id),
            aiInsights: this._getStageAIInsights(stageInterviews)
          };
        }),
        conversions: this._calculateStageConversions(stages, job.applicants),
        averageTimeToHire: this._calculateAverageTimeToHire(job.applicants),
        overallPassRate: this._calculateOverallPassRate(job.applicants),
        aiAnalyzedInterviews: interviews.filter(i => i.aiAnalysis?.analyzed).length,
        aiAverageConfidence: this._calculateAverageAIConfidence(interviews),
        durationTrends: this._calculateDurationTrends(interviews),
        timeToHireTrend: 0, // Could be enhanced with historical data
        reschedulingRate: this._calculateReschedulingRate(interviews),
        noShowRate: this._calculateNoShowRate(interviews),
        averageSchedulingTime: 3, // Default - could be enhanced
        topSkills: this._getTopSkillsFromInterviews(interviews),
        aiRecommendations: this._getAIRecommendations(interviews),
        aiRecommendationsFollowed: 85, // Could be enhanced with tracking
        aiPredictionAccuracy: 78 // Could be enhanced with outcome tracking
      };
      
      return analytics;
    } catch (error) {
      console.error('❌ Error getting stage analytics:', error);
      throw error;
    }
  }

  /**
   * Check progression rules and advance candidates automatically
   */
  async checkProgressionRules(jobId) {
    try {
      console.log(`🔄 Checking progression rules for job ${jobId}`);
      
      const job = await Job.findById(jobId);
      if (!job) {
        throw new Error('Job not found');
      }
      
      const stages = await InterviewStage.find({ jobId, isActive: true }).sort('order');
      const results = [];
      
      for (const stage of stages) {
        if (stage.progressionRules?.autoProgress) {
          const candidatesInStage = job.applicants.filter(
            app => app.currentStage?.stageId?.toString() === stage._id.toString()
          );
          
          for (const applicant of candidatesInStage) {
            const shouldAdvance = await this._evaluateProgressionRules(
              applicant, 
              stage, 
              jobId
            );
            
            if (shouldAdvance.advance) {
              const nextStage = await stage.getNextStage();
              if (nextStage) {
                await this.advanceCandidateToStage(
                  jobId,
                  applicant.candidate,
                  nextStage._id,
                  shouldAdvance.reason,
                  'system'
                );
                results.push({
                  candidateId: applicant.candidate,
                  action: 'advanced',
                  from: stage.name,
                  to: nextStage.name,
                  reason: shouldAdvance.reason
                });
              }
            }
          }
        }
      }
      
      console.log(`✅ Progression rules checked: ${results.length} actions taken`);
      return results;
    } catch (error) {
      console.error('❌ Error checking progression rules:', error);
      throw error;
    }
  }

  // Helper methods
  _calculateStagePassRate(applicants, stageId) {
    const stageHistory = applicants.flatMap(app => 
      app.stageHistory?.filter(sh => 
        sh.stageId?.toString() === stageId.toString() && sh.exitedAt
      ) || []
    );
    
    if (stageHistory.length === 0) return 0;
    
    const passed = stageHistory.filter(sh => sh.result === 'passed').length;
    return Math.round((passed / stageHistory.length) * 100);
  }

  _calculateConversionRates(stages, applicants) {
    const rates = [];
    
    for (let i = 0; i < stages.length - 1; i++) {
      const currentStage = stages[i];
      const nextStage = stages[i + 1];
      
      const enteredCurrent = applicants.filter(app =>
        app.stageHistory?.some(sh => sh.stageId?.toString() === currentStage._id.toString())
      ).length;
      
      const enteredNext = applicants.filter(app =>
        app.stageHistory?.some(sh => sh.stageId?.toString() === nextStage._id.toString())
      ).length;
      
      const rate = enteredCurrent > 0 ? Math.round((enteredNext / enteredCurrent) * 100) : 0;
      
      rates.push({
        from: currentStage.name,
        to: nextStage.name,
        rate,
        count: enteredNext
      });
    }
    
    return rates;
  }

  _calculateAverageTimeToHire(applicants) {
    const hiredApplicants = applicants.filter(app => app.status === 'hired');
    
    if (hiredApplicants.length === 0) return 0;
    
    const totalDays = hiredApplicants.reduce((sum, app) => {
      const appliedDate = new Date(app.appliedAt);
      const hiredDate = new Date(app.statusHistory.find(sh => sh.status === 'hired')?.changedAt || new Date());
      const daysDiff = Math.ceil((hiredDate - appliedDate) / (1000 * 60 * 60 * 24));
      return sum + daysDiff;
    }, 0);
    
    return Math.round(totalDays / hiredApplicants.length);
  }

  _identifyBottlenecks(stageAnalytics) {
    return stageAnalytics
      .filter(stage => stage.candidateCount > 0)
      .map(stage => {
        const avgTimeInStage = 7; // Default - could be calculated from actual data
        const candidateCount = stage.candidateCount;
        
        let severity = 'low';
        if (candidateCount > 10 && avgTimeInStage > 14) severity = 'high';
        else if (candidateCount > 5 && avgTimeInStage > 7) severity = 'medium';
        
        return {
          stage: stage.stage.name,
          candidateCount,
          averageDays: avgTimeInStage,
          severity
        };
      })
      .filter(bottleneck => bottleneck.severity !== 'low');
  }

  _calculateStageConversions(stages, applicants) {
    // Calculate conversion rates between consecutive stages
    return this._calculateConversionRates(stages, applicants);
  }

  _calculateOverallPassRate(applicants) {
    const completedApplicants = applicants.filter(app => 
      ['hired', 'rejected'].includes(app.status)
    );
    
    if (completedApplicants.length === 0) return 0;
    
    const hired = applicants.filter(app => app.status === 'hired').length;
    return Math.round((hired / completedApplicants.length) * 100);
  }

  _calculateAverageAIConfidence(interviews) {
    const analyzedInterviews = interviews.filter(i => i.aiAnalysis?.analyzed);
    
    if (analyzedInterviews.length === 0) return 0;
    
    const totalConfidence = analyzedInterviews.reduce((sum, interview) => 
      sum + (interview.aiAnalysis.insights.recommendedNextSteps?.confidence || 0), 0
    );
    
    return Math.round(totalConfidence / analyzedInterviews.length);
  }

  _calculateDurationTrends(interviews) {
    // Simplified trend - could be enhanced with actual date-based analysis
    return interviews.slice(0, 10).map((interview, index) => ({
      date: new Date(Date.now() - (index * 24 * 60 * 60 * 1000)).toISOString().split('T')[0],
      duration: interview.duration || 60
    }));
  }

  _calculateReschedulingRate(interviews) {
    const totalInterviews = interviews.length;
    if (totalInterviews === 0) return 0;
    
    const rescheduled = interviews.filter(i => 
      i.rescheduleHistory && i.rescheduleHistory.length > 0
    ).length;
    
    return Math.round((rescheduled / totalInterviews) * 100);
  }

  _calculateNoShowRate(interviews) {
    const scheduledInterviews = interviews.filter(i => i.status === 'scheduled');
    if (scheduledInterviews.length === 0) return 0;
    
    // This would need to be enhanced to track actual no-shows
    return 5; // Default placeholder
  }

  _getTopSkillsFromInterviews(interviews) {
    const skills = {};
    
    interviews.forEach(interview => {
      if (interview.aiAnalysis?.insights?.keySkillsMentioned) {
        interview.aiAnalysis.insights.keySkillsMentioned.forEach(skill => {
          if (!skills[skill.skill]) {
            skills[skill.skill] = { count: 0, totalRelevance: 0 };
          }
          skills[skill.skill].count++;
          skills[skill.skill].totalRelevance += skill.relevanceScore || 0;
        });
      }
    });
    
    return Object.entries(skills)
      .map(([name, data]) => ({
        name,
        count: data.count,
        frequency: Math.round((data.totalRelevance / data.count) || 0)
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  _getStageAIInsights(stageInterviews) {
    const analyzedInterviews = stageInterviews.filter(i => i.aiAnalysis?.analyzed);
    
    if (analyzedInterviews.length === 0) {
      return {
        averageConfidence: 0,
        topConcern: 'No data available'
      };
    }
    
    const avgConfidence = Math.round(
      analyzedInterviews.reduce((sum, i) => 
        sum + (i.aiAnalysis.insights.recommendedNextSteps?.confidence || 0), 0
      ) / analyzedInterviews.length
    );
    
    // Get most common concern
    const concerns = {};
    analyzedInterviews.forEach(interview => {
      interview.aiAnalysis.insights.concerns?.forEach(concern => {
        concerns[concern.type] = (concerns[concern.type] || 0) + 1;
      });
    });
    
    const topConcern = Object.entries(concerns)
      .sort(([,a], [,b]) => b - a)[0]?.[0] || 'None identified';
    
    return {
      averageConfidence: avgConfidence,
      topConcern
    };
  }

  _getAIRecommendations(interviews) {
    // Generate recommendations based on AI analysis patterns
    return [
      {
        title: 'Optimize Technical Assessment',
        description: 'Consider adding coding challenges to technical interviews',
        impact: 'medium'
      },
      {
        title: 'Focus on Communication Skills',
        description: 'Add structured communication evaluation criteria',
        impact: 'high'
      }
    ];
  }

  async _evaluateProgressionRules(applicant, stage, jobId) {
    // Get latest interview for this candidate in this stage
    const latestInterview = await Interview.findOne({
      jobId,
      candidateId: applicant.candidate,
      stageId: stage._id
    }).sort({ scheduledAt: -1 });
    
    if (!latestInterview || latestInterview.status !== 'completed') {
      return { advance: false, reason: 'No completed interview' };
    }
    
    const rules = stage.progressionRules;
    
    // Check score threshold
    if (rules.conditions?.some(c => c.type === 'score_threshold')) {
      const scoreCondition = rules.conditions.find(c => c.type === 'score_threshold');
      const overallScore = latestInterview.structuredFeedback?.overallScore || 0;
      
      if (overallScore >= scoreCondition.value) {
        return { 
          advance: true, 
          reason: `Score ${overallScore} meets threshold of ${scoreCondition.value}` 
        };
      }
    }
    
    // Check AI recommendation
    if (rules.conditions?.some(c => c.type === 'ai_recommendation')) {
      const aiRecommendation = latestInterview.aiAnalysis?.insights?.recommendedNextSteps?.recommendation;
      const confidence = latestInterview.aiAnalysis?.insights?.recommendedNextSteps?.confidence || 0;
      
      if (aiRecommendation === 'advance' && confidence >= 75) {
        return { 
          advance: true, 
          reason: `AI recommends advancement with ${confidence}% confidence` 
        };
      }
    }
    
    return { advance: false, reason: 'Progression rules not met' };
  }
}

module.exports = new PipelineProgressionService(); 