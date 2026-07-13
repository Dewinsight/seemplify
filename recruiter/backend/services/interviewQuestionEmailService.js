const cron = require('node-cron');
const Interview = require('../models/Interview');
const InterviewQuestion = require('../models/InterviewQuestion');
const User = require('../models/User');
const Candidate = require('../models/Candidate');
const emailService = require('./emailService');
const { decodeHtmlEntities } = require('../utils/htmlDecode');
const { resolveOrganizationForEmail } = require('../utils/organizationEmailContext');

class InterviewFeedbackEmailService {
  constructor() {
    this.isRunning = false;
    this.scheduledTasks = new Map();
  }

  /**
   * Start the scheduler for sending interview feedback access to all participants
   */
  start() {
    console.log('🔄 Starting interview feedback email scheduler...');
    
    // Run every minute to check for interviews needing feedback emails
    cron.schedule('* * * * *', async () => {
      if (this.isRunning) {
        console.log('⏭️ Feedback email job already running, skipping...');
        return;
      }

      this.isRunning = true;
      console.log('🔍 Checking for interview feedback emails to send...');
      
      try {
        await this.checkAndSendFeedbackEmails();
      } catch (error) {
        console.error('❌ Error in feedback email scheduler:', error);
      } finally {
        this.isRunning = false;
      }
    });

    console.log('✅ Interview feedback email scheduler started');
  }

  /**
   * Stop the scheduler (for graceful shutdown)
   */
  stop() {
    console.log('🛑 Stopping interview feedback email scheduler...');
    // Any cleanup needed
    this.isRunning = false;
  }

  /**
   * Check for interviews with questions that need feedback access sent to all participants
   */
  async checkAndSendFeedbackEmails() {
    try {
      const now = new Date();
      
      console.log('🔍 Checking for interviews needing feedback access emails at', now.toISOString());
      
      // Find interviews where:
      // 1. sendQuestionsToInterviewers is true
      // 2. Questions haven't been sent yet (questionsSentAt is null)
      // 3. The interview is in the future
      // 4. The time to send is now (based on questionsSendTime minutes before interview)
      const interviews = await Interview.find({
        'notifications.sendQuestionsToInterviewers': true,
        'notifications.questionsSentAt': null,
        'status': { $in: ['scheduled', 'confirmed'] },
        'scheduledAt': { $gt: now }
      })
      .populate('candidateId')
      .populate('jobId')
      .populate('notifications.selectedQuestions');
      
      console.log(`📊 Found ${interviews.length} interviews to check for sending questions`);
      
      // Log details about each interview found
      for (const interview of interviews) {
        console.log(`Interview ${interview._id}:`, {
          scheduledAt: interview.scheduledAt,
          questionsSendTime: interview.notifications?.questionsSendTime,
          selectedQuestionsCount: interview.notifications?.selectedQuestions?.length || 0,
          sendQuestionsToInterviewers: interview.notifications?.sendQuestionsToInterviewers
        });
      }
      
      for (const interview of interviews) {
        try {
          const sendTime = new Date(interview.scheduledAt);
          // Subtract the minutes before interview setting
          sendTime.setMinutes(sendTime.getMinutes() - interview.notifications.questionsSendTime);
          
          // Check if it's time to send
          if (now >= sendTime) {
            const sent = await this.sendQuestionEmail(interview);
            if (sent) {
              // Update only when send actually succeeded.
              interview.notifications.questionsSentAt = now;
              await interview.save();
              
              console.log(`✅ Sent question email for interview ${interview._id}`);
            } else {
              console.warn(`⚠️ Question email not sent for interview ${interview._id}; leaving questionsSentAt unset for retry`);
            }
          }
        } catch (error) {
          console.error(`❌ Error sending question email for interview ${interview._id}:`, error);
        }
      }
    } catch (error) {
      console.error('Error checking for interviews to send questions:', error);
    }
  }

  /**
   * Send questions email to interviewers
   */
  async sendQuestionEmail(interview) {
    try {
      console.log(`📧 Attempting to send question email for interview ${interview._id}`);
      
      // Check if questions are selected
      if (!interview.notifications?.selectedQuestions || interview.notifications.selectedQuestions.length === 0) {
        console.log(`❌ No questions selected for interview ${interview._id}, skipping email`);
        return false;
      }
      
      console.log(`✅ Found ${interview.notifications.selectedQuestions.length} questions for feedback access`);

      // Get ALL interview participants (main interviewer + ALL additional participants, excluding candidates)
      const participants = [];
      const emailsSeen = new Set(); // Track emails to prevent duplicates
      
      // Add main interviewer
      const mainInterviewer = await User.findById(interview.interviewerId);
      if (mainInterviewer && mainInterviewer.email) {
        participants.push(mainInterviewer);
        emailsSeen.add(mainInterviewer.email.toLowerCase()); // Track this email
      }
      
      // Add ALL additional participants (regardless of role - interviewer, observer, etc.)
      // We exclude candidates who should not receive feedback links AND avoid duplicates
      if (interview.participants && interview.participants.length > 0) {
        const additionalParticipants = interview.participants.filter(p => 
          p.email && 
          p.email.trim() !== '' && 
          p.role !== 'candidate' &&
          !emailsSeen.has(p.email.toLowerCase()) // ✅ PREVENT DUPLICATES
        );
        
        additionalParticipants.forEach(participant => {
          participants.push({
            email: participant.email,
            name: participant.name || participant.email.split('@')[0],
            role: participant.role || 'observer'
          });
          emailsSeen.add(participant.email.toLowerCase()); // Track this email
        });
      }
      
      console.log(`📧 Sending feedback emails to ${participants.length} unique participants:`, 
        participants.map(p => `${p.email} (${p.role || 'interviewer'})`));
      
      if (participants.length === 0) {
        console.log(`No participants found for interview ${interview._id}, skipping email`);
        return;
      }
      
      // Get candidate data
      const candidate = interview.candidateId;
      if (!candidate) {
        console.log(`No candidate found for interview ${interview._id}, skipping email`);
        return;
      }
      
      // Get job data (decode HTML entities)
      const job = interview.jobId;
      const jobTitle = job ? decodeHtmlEntities(job.title) : 'Position';
      const organization = await resolveOrganizationForEmail({ job, interview });
      const organizationName = decodeHtmlEntities(organization.name);
      
      // Format interview date/time
      const interviewDate = new Date(interview.scheduledAt).toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
      
      const interviewTime = new Date(interview.scheduledAt).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      
      // Generate public feedback link (same as used in transcript UI)
      // Make sure to use the correct frontend URL for your deployment
      const frontendUrl = process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://smarthr.aiinnigeria.com';
      const feedbackUrl = `${frontendUrl}/public/feedback/${interview._id}`;
      
      console.log(`🔗 Generated feedback URL: ${feedbackUrl}`);
      const questionsHtml = `
        <div style="text-align: center; margin: 30px 0; padding: 25px; background-color: #f3f4f6; border-radius: 8px;">
          <h3 style="color: #4338ca; margin-bottom: 15px;">Interview Questions & Feedback</h3>
          <p style="margin-bottom: 20px; color: #6b7280;">Access the interview questions and provide feedback using the link below:</p>
          <a href="${feedbackUrl}" 
             style="background-color: #4f46e5; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 500; font-size: 16px; margin: 10px 0;">
            View Questions & Submit Feedback
          </a>
          <p style="font-size: 14px; color: #6b7280; margin-top: 15px;">
            This link provides access to the selected interview questions and allows you to submit feedback after the interview.
          </p>
        </div>
      `;
      
      // Create resume link
      let resumeLink = '';
      if (candidate.cvUrl) {
        resumeLink = `<p style="margin: 15px 0;"><a href="${candidate.cvUrl}" style="background-color: #4f46e5; color: white; padding: 10px 15px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: 500;">View Resume</a></p>`;
      }
      
      // Create candidate profile summary
      const candidateInfo = `
        <div style="margin-bottom: 25px; padding: 20px; background-color: #f3f4f6; border-radius: 8px;">
          <h3 style="margin-top: 0; color: #111827; border-bottom: 1px solid #d1d5db; padding-bottom: 10px; margin-bottom: 15px;">Candidate Profile</h3>
          <p><strong>Name:</strong> ${candidate.firstName} ${candidate.lastName}</p>
          <p><strong>Position:</strong> ${jobTitle}</p>
          ${candidate.currentRole ? `<p><strong>Current Role:</strong> ${candidate.currentRole}</p>` : ''}
          ${candidate.yearsOfExperience ? `<p><strong>Experience:</strong> ${candidate.yearsOfExperience} years</p>` : ''}
          ${resumeLink}
        </div>
      `;
      
      // Send feedback email to each participant
      for (const participant of participants) {
        const htmlContent = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Interview Questions</title>
            <style>
              body { 
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                color: #333;
                line-height: 1.6;
                margin: 0;
                padding: 0;
              }
              .container {
                max-width: 650px;
                margin: 0 auto;
                padding: 20px;
              }
              .header {
                background-color: #4f46e5;
                color: white;
                padding: 20px;
                text-align: center;
                border-radius: 8px 8px 0 0;
              }
              .content {
                background-color: white;
                padding: 30px;
                border: 1px solid #e5e7eb;
                border-top: none;
                border-radius: 0 0 8px 8px;
              }
              .interview-details {
                background-color: #f3f4f6;
                padding: 15px;
                border-radius: 8px;
                margin-bottom: 25px;
              }
              .questions-section {
                margin-top: 30px;
              }
              .footer {
                text-align: center;
                padding: 15px;
                font-size: 14px;
                color: #6b7280;
                margin-top: 30px;
              }
              h2 {
                color: #4338ca;
                margin-top: 0;
              }
              h3 {
                color: #4338ca;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Interview Feedback Access</h1>
              </div>
              <div class="content">
                <h2>Hello ${participant.name || 'Team Member'},</h2>
                <p>Here is the candidate information and feedback access for your upcoming interview:</p>
                
                <div class="interview-details">
                  <h3>Interview Details</h3>
                  <p><strong>Candidate:</strong> ${candidate.firstName} ${candidate.lastName}</p>
                  <p><strong>Position:</strong> ${jobTitle}</p>
                  <p><strong>Date:</strong> ${interviewDate}</p>
                  <p><strong>Time:</strong> ${interviewTime}</p>
                  <p><strong>Duration:</strong> ${interview.duration} minutes</p>
                  ${interview.location ? `<p><strong>Location/Link:</strong> ${interview.location}</p>` : ''}
                </div>
                
                ${candidateInfo}
                
                <div class="questions-section">
                  <h3>Feedback Access</h3>
                  ${questionsHtml}
                </div>
                
                <p style="margin-top: 30px;">Good luck with the interview!</p>
              </div>
              <div class="footer">
                <p>This email was automatically generated by ${organizationName}. Please do not reply.</p>
              </div>
            </div>
          </body>
          </html>
        `;
        
        // Send the email using emailService
        await emailService.sendUserNotification(
          participant.email,
          `${organizationName} - Interview Feedback Access for ${candidate.firstName} ${candidate.lastName} - ${interviewDate}`,
          "Access interview questions and provide feedback for your upcoming interview.",
          {
            senderName: organizationName,
            htmlContent
          }
        );
        
        console.log(`✅ Sent feedback email to ${participant.email} (${participant.role || 'participant'}) for interview ${interview._id}`);
      }
      
      return true;
    } catch (error) {
      console.error(`Error sending feedback access email for interview ${interview._id}:`, error);
      throw error;
    }
  }
}

module.exports = new InterviewFeedbackEmailService();
