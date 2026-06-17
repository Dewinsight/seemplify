const prisma = require('../db/client');
const interviewQuestionEmailService = require('../services/interviewQuestionEmailService');

// Stitch the soft-ref populations the old Mongoose `.populate(...)` produced:
//   candidateId -> Candidate doc, jobId -> Job doc,
//   notifications.selectedQuestions -> InterviewQuestion[] (ids in the Json column)
async function populateInterviewRefs(interview, { candidate = false, job = false, questions = false } = {}) {
  if (!interview) return interview;

  if (candidate && interview.candidateId) {
    interview.candidateId = await prisma.candidate.findUnique({ where: { id: String(interview.candidateId) } });
  }

  if (job && interview.jobId) {
    interview.jobId = await prisma.job.findUnique({ where: { id: String(interview.jobId) } });
  }

  if (questions && interview.notifications && Array.isArray(interview.notifications.selectedQuestions)) {
    const ids = interview.notifications.selectedQuestions.map(String);
    const rows = ids.length
      ? await prisma.interviewQuestion.findMany({ where: { id: { in: ids } } })
      : [];
    const byId = new Map(rows.map(r => [String(r.id), r]));
    interview.notifications = {
      ...interview.notifications,
      selectedQuestions: ids.map(id => byId.get(id) || id)
    };
  }

  return interview;
}

// Manually send interview questions to interviewers
exports.sendInterviewQuestions = async (req, res) => {
  try {
    const { interviewId } = req.params;
    
    // Find the interview and populate required references
    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });

    if (!interview) {
      return res.status(404).json({ error: 'INTERVIEW_NOT_FOUND', message: 'Interview not found' });
    }

    // Preserve the raw notifications Json (ids) before populating overwrites it with docs
    const rawNotifications = interview.notifications;

    await populateInterviewRefs(interview, { candidate: true, job: true, questions: true });

    // Send the questions email
    const result = await interviewQuestionEmailService.sendQuestionEmail(interview);

    if (result) {
      // Mark the questions as sent (write back the raw Json, not the populated docs)
      const updatedNotifications = { ...(rawNotifications || {}), questionsSentAt: new Date() };
      await prisma.interview.update({
        where: { id: interview.id },
        data: { notifications: updatedNotifications }
      });
      
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
    
    const interview = await prisma.interview.findUnique({ where: { id: interviewId } });

    if (!interview) {
      return res.status(404).json({ error: 'INTERVIEW_NOT_FOUND', message: 'Interview not found' });
    }

    await populateInterviewRefs(interview, { questions: true });
    
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
