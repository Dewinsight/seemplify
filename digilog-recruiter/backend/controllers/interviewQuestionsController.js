const Interview = require('../models/Interview');
const InterviewQuestion = require('../models/InterviewQuestion');
const interviewQuestionEmailService = require('../services/interviewQuestionEmailService');

// Manually send interview questions to interviewers
exports.sendInterviewQuestions = async (req, res) => {
  try {
    const { interviewId } = req.params;
    
    // Find the interview and populate required references
    const interview = await Interview.findById(interviewId)
      .populate('candidateId')
      .populate('jobId')
      .populate('notifications.selectedQuestions');
    
    if (!interview) {
      return res.status(404).json({ error: 'INTERVIEW_NOT_FOUND', message: 'Interview not found' });
    }
    
    // Send the questions email
    const result = await interviewQuestionEmailService.sendQuestionEmail(interview);
    
    if (result) {
      // Mark the questions as sent
      interview.notifications.questionsSentAt = new Date();
      await interview.save();
      
      return res.status(200).json({
        success: true,
        message: 'Interview questions sent successfully'
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Could not send interview questions'
      });
    }
  } catch (error) {
    console.error('Error sending interview questions:', error);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      message: error.message
    });
  }
};

// Get selected interview questions for an interview
exports.getSelectedQuestions = async (req, res) => {
  try {
    const { interviewId } = req.params;
    
    const interview = await Interview.findById(interviewId)
      .populate('notifications.selectedQuestions');
      
    if (!interview) {
      return res.status(404).json({ error: 'INTERVIEW_NOT_FOUND', message: 'Interview not found' });
    }
    
    // Check if questions are enabled and selected
    const questionsEnabled = interview.notifications?.sendQuestionsToInterviewers || false;
    const selectedQuestions = interview.notifications?.selectedQuestions || [];
    const questionsSentAt = interview.notifications?.questionsSentAt;
    
    return res.status(200).json({
      success: true,
      questionsEnabled,
      questionsSendTime: interview.notifications?.questionsSendTime || 60,
      questionsSentAt,
      questions: selectedQuestions,
      count: selectedQuestions.length
    });
  } catch (error) {
    console.error('Error getting selected interview questions:', error);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      message: error.message
    });
  }
};
