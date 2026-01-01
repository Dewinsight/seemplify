const express = require('express');
const router = express.Router();
const OneOnOne = require('../models/OneOnOne');
const { requireAuth, requireManager } = require('../middleware/rbac');
const multer = require('multer');

// Lazy load services to avoid startup errors if not configured
let nylasService = null;
let meetingAnalysisService = null;

const getNylasService = () => {
  if (!nylasService) {
    try {
      nylasService = require('../services/nylasService');
    } catch (e) {
      console.warn('Nylas service not available:', e.message);
    }
  }
  return nylasService;
};

const getMeetingAnalysisService = () => {
  if (!meetingAnalysisService) {
    try {
      meetingAnalysisService = require('../services/meetingAnalysisService');
    } catch (e) {
      console.warn('Meeting analysis service not available:', e.message);
    }
  }
  return meetingAnalysisService;
};

// Configure multer for transcript uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['text/plain', 'text/vtt', 'application/json'];
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(txt|vtt|json|srt)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type for transcript'));
    }
  }
});

/**
 * GET /api/one-on-ones - List 1:1 meetings
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id || req.session.user.sub;
    const { status, upcoming, past, format, withUser, limit = 50 } = req.query;

    let query = {
      $or: [{ managerId: userId }, { employeeId: userId }]
    };

    if (status) query.status = status;
    if (format) query.meetingFormat = format;

    if (withUser) {
      query.$or = [
        { managerId: userId, employeeId: withUser },
        { managerId: withUser, employeeId: userId }
      ];
    }

    const now = new Date();
    if (upcoming === 'true') {
      query.scheduledDate = { $gte: now };
    } else if (past === 'true') {
      query.scheduledDate = { $lt: now };
    }

    const meetings = await OneOnOne.find(query)
      .sort({ scheduledDate: upcoming === 'true' ? 1 : -1 })
      .limit(parseInt(limit))
      .select('-transcript.content -chatThread -privateManagerNotes');

    res.json({
      success: true,
      data: meetings,
      count: meetings.length
    });
  } catch (error) {
    console.error('Error fetching 1:1 meetings:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch meetings' });
  }
});

/**
 * GET /api/one-on-ones/upcoming - Get upcoming meetings
 */
router.get('/upcoming', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id || req.session.user.sub;
    const { role = 'any', limit = 10 } = req.query;

    const meetings = await OneOnOne.getUpcoming(userId, role, parseInt(limit));

    res.json({ success: true, data: meetings });
  } catch (error) {
    console.error('Error fetching upcoming meetings:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch upcoming meetings' });
  }
});

/**
 * GET /api/one-on-ones/with/:userId - Get meetings with specific person
 */
router.get('/with/:userId', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.user.id || req.session.user.sub;
    const otherUserId = req.params.userId;
    const { limit = 20, includeHistory = false } = req.query;

    const meetings = await OneOnOne.find({
      $or: [
        { managerId: currentUserId, employeeId: otherUserId },
        { managerId: otherUserId, employeeId: currentUserId }
      ]
    })
      .sort({ scheduledDate: -1 })
      .limit(parseInt(limit))
      .select(includeHistory === 'true' ? '' : '-transcript.content -chatThread');

    let trends = null;
    const analysisService = getMeetingAnalysisService();
    if (includeHistory === 'true' && meetings.length >= 2 && analysisService) {
      trends = analysisService.calculateBasicTrends(meetings);
    }

    res.json({ success: true, data: meetings, trends });
  } catch (error) {
    console.error('Error fetching meetings:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch meetings' });
  }
});

/**
 * GET /api/one-on-ones/:id - Get specific meeting
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const meeting = await OneOnOne.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    const userId = req.session.user.id || req.session.user.sub;
    const isManager = meeting.managerId === userId;
    const isEmployee = meeting.employeeId === userId;
    const isHRAdmin = req.userRole === 'hr_admin';

    if (!isManager && !isEmployee && !isHRAdmin) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const response = meeting.toObject();
    if (!isManager && !isHRAdmin) {
      delete response.privateManagerNotes;
      if (response.managerScoring && !response.managerScoring.isVisible) {
        delete response.managerScoring;
      }
    }
    if (!isEmployee && !isHRAdmin) {
      delete response.employeeNotes;
    }

    res.json({ success: true, data: response });
  } catch (error) {
    console.error('Error fetching meeting:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch meeting' });
  }
});

/**
 * POST /api/one-on-ones - Create new 1:1 meeting
 */
router.post('/', requireManager, async (req, res) => {
  try {
    const managerId = req.session.user.id || req.session.user.sub;
    const managerName = req.session.user.name || req.session.user.email;
    const managerEmail = req.session.user.email;

    const {
      employeeId,
      employeeInfo,
      scheduledDate,
      duration = 30,
      meetingType = 'weekly',
      meetingFormat = 'video',
      title,
      location,
      agendaItems,
      recurring,
      createCalendarEvent = true
    } = req.body;

    if (!employeeId || !scheduledDate) {
      return res.status(400).json({ success: false, error: 'Employee and date required' });
    }

    const meeting = new OneOnOne({
      managerId,
      managerInfo: { name: managerName, email: managerEmail },
      employeeId,
      employeeInfo: employeeInfo || {},
      organizationId: req.currentOrganization?.id,
      title: title || `1:1 with ${employeeInfo?.name || 'Team Member'}`,
      scheduledDate,
      duration,
      meetingType,
      meetingFormat,
      location: meetingFormat === 'in_person' ? location : 'Virtual',
      agendaItems: agendaItems || [],
      recurring,
      createdBy: managerId
    });

    // Create calendar event with Nylas if configured
    const nylas = getNylasService();
    if (createCalendarEvent && nylas?.isNylasConfigured()) {
      try {
        const grantId = req.session.user.nylasGrantId;
        if (grantId) {
          const endTime = new Date(scheduledDate);
          endTime.setMinutes(endTime.getMinutes() + duration);

          const calendarEvent = await nylas.createCalendarEvent(grantId, {
            title: meeting.title,
            description: `1:1 Meeting - ${meetingType}`,
            startTime: scheduledDate,
            endTime: endTime.toISOString(),
            participants: [
              { email: managerEmail, name: managerName },
              { email: employeeInfo?.email, name: employeeInfo?.name }
            ],
            conferencing: meetingFormat === 'video',
            metadata: { meetingId: meeting._id.toString() }
          });

          meeting.nylas = {
            eventId: calendarEvent.eventId,
            calendarId: calendarEvent.calendarId,
            conferenceUrl: calendarEvent.conferenceUrl,
            conferenceProvider: 'google_meet',
            htmlLink: calendarEvent.htmlLink,
            grantId,
            syncStatus: 'synced',
            lastSyncAt: new Date()
          };
        }
      } catch (nylasError) {
        console.error('Nylas calendar event creation failed:', nylasError);
        meeting.nylas = { syncStatus: 'failed' };
      }
    }

    // Generate preparation suggestions
    const analysisService = getMeetingAnalysisService();
    if (analysisService) {
      try {
        const prepSuggestions = await analysisService.generateMeetingPrep({
          employeeRole: employeeInfo?.title,
          meetingType
        });
        meeting.prepSuggestions = { ...prepSuggestions, generatedAt: new Date() };
      } catch (prepError) {
        console.error('Prep suggestions generation failed:', prepError);
      }
    }

    await meeting.save();

    res.status(201).json({
      success: true,
      data: meeting,
      message: '1:1 meeting scheduled successfully'
    });
  } catch (error) {
    console.error('Error creating meeting:', error);
    res.status(500).json({ success: false, error: 'Failed to create meeting' });
  }
});

/**
 * PUT /api/one-on-ones/:id - Update meeting
 */
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const meeting = await OneOnOne.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    const userId = req.session.user.id || req.session.user.sub;
    const isManager = meeting.managerId === userId;
    const isEmployee = meeting.employeeId === userId;

    if (!isManager && !isEmployee && req.userRole !== 'hr_admin') {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const updates = req.body;

    if (!isManager) {
      delete updates.privateManagerNotes;
      delete updates.status;
      delete updates.managerScoring;
    }

    if (!isEmployee) {
      delete updates.employeeNotes;
      delete updates.employeeMood;
      delete updates.employeeFeedback;
    }

    Object.keys(updates).forEach(key => {
      if (key !== '_id' && key !== 'managerId' && key !== 'employeeId') {
        meeting[key] = updates[key];
      }
    });

    await meeting.save();
    res.json({ success: true, data: meeting });
  } catch (error) {
    console.error('Error updating meeting:', error);
    res.status(500).json({ success: false, error: 'Failed to update meeting' });
  }
});

/**
 * POST /api/one-on-ones/:id/chat - Add chat message (for chat-based meetings)
 */
router.post('/:id/chat', requireAuth, async (req, res) => {
  try {
    const meeting = await OneOnOne.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    const userId = req.session.user.id || req.session.user.sub;
    const isManager = meeting.managerId === userId;
    const isEmployee = meeting.employeeId === userId;

    if (!isManager && !isEmployee) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { content, messageType = 'text' } = req.body;

    if (!content) {
      return res.status(400).json({ success: false, error: 'Message content required' });
    }

    const sender = isManager ? 'manager' : 'employee';
    const senderInfo = {
      userId,
      name: req.session.user.name,
      avatar: req.session.user.avatar
    };

    await meeting.addChatMessage(sender, content, messageType, senderInfo);

    if (meeting.status === 'scheduled') {
      meeting.status = 'in_progress';
      meeting.actualStartTime = meeting.actualStartTime || new Date();
      await meeting.save();
    }

    res.json({
      success: true,
      data: meeting.chatThread[meeting.chatThread.length - 1]
    });
  } catch (error) {
    console.error('Error adding chat message:', error);
    res.status(500).json({ success: false, error: 'Failed to add message' });
  }
});

/**
 * POST /api/one-on-ones/:id/chat/ai-assist - Get AI assistant response
 */
router.post('/:id/chat/ai-assist', requireAuth, async (req, res) => {
  try {
    const meeting = await OneOnOne.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    const { context } = req.body;
    const analysisService = getMeetingAnalysisService();

    if (!analysisService) {
      return res.status(503).json({ success: false, error: 'AI service not available' });
    }

    const recentMessages = meeting.chatThread.slice(-10).map(m => ({
      role: m.sender,
      content: m.content
    }));

    const aiResponse = await analysisService.generateMeetingPrep({
      ...context,
      recentDiscussion: recentMessages
    });

    await meeting.addChatMessage('ai_assistant', aiResponse.suggestedTopics?.[0] || 'How can I help?', 'suggestion', {
      name: 'AI Assistant'
    });

    res.json({
      success: true,
      data: {
        message: meeting.chatThread[meeting.chatThread.length - 1],
        suggestions: aiResponse
      }
    });
  } catch (error) {
    console.error('Error getting AI assistance:', error);
    res.status(500).json({ success: false, error: 'Failed to get AI assistance' });
  }
});

/**
 * POST /api/one-on-ones/:id/transcript - Upload transcript
 */
router.post('/:id/transcript', requireAuth, upload.single('transcript'), async (req, res) => {
  try {
    const meeting = await OneOnOne.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    const userId = req.session.user.id || req.session.user.sub;
    const isManager = meeting.managerId === userId;

    if (!isManager && req.userRole !== 'hr_admin') {
      return res.status(403).json({ success: false, error: 'Only manager can upload transcript' });
    }

    let transcriptContent = '';

    if (req.file) {
      transcriptContent = req.file.buffer.toString('utf-8');
      meeting.transcript.source = 'manual_upload';
    } else if (req.body.content) {
      transcriptContent = req.body.content;
      meeting.transcript.source = req.body.source || 'manual_upload';
    } else {
      return res.status(400).json({ success: false, error: 'Transcript content required' });
    }

    meeting.transcript.content = transcriptContent;
    meeting.transcript.status = 'ready';
    meeting.transcript.processedAt = new Date();

    await meeting.save();

    res.json({
      success: true,
      data: {
        wordCount: meeting.transcript.wordCount,
        status: meeting.transcript.status
      }
    });
  } catch (error) {
    console.error('Error uploading transcript:', error);
    res.status(500).json({ success: false, error: 'Failed to upload transcript' });
  }
});

/**
 * POST /api/one-on-ones/:id/analyze - Trigger AI analysis
 */
router.post('/:id/analyze', requireAuth, async (req, res) => {
  try {
    const meeting = await OneOnOne.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    const analysisService = getMeetingAnalysisService();
    if (!analysisService) {
      return res.status(503).json({ success: false, error: 'Analysis service not available' });
    }

    let contentToAnalyze = '';

    if (meeting.transcript?.content) {
      contentToAnalyze = meeting.transcript.content;
    } else if (meeting.chatThread?.length > 0) {
      contentToAnalyze = meeting.chatThread.map(msg => {
        const speaker = msg.sender === 'manager' ? 'Manager' : 'Employee';
        return `${speaker}: ${msg.content}`;
      }).join('\n\n');
    } else {
      return res.status(400).json({
        success: false,
        error: 'No content available for analysis'
      });
    }

    const [transcriptAnalysis, employeeScoring, managerScoring, actionItems] = await Promise.all([
      analysisService.analyzeTranscript(contentToAnalyze, {
        meetingType: meeting.meetingType,
        employeeRole: meeting.employeeInfo?.title
      }),
      analysisService.scoreEmployeePerformance(contentToAnalyze),
      analysisService.scoreManagerEffectiveness(contentToAnalyze),
      analysisService.extractActionItems(contentToAnalyze)
    ]);

    meeting.aiAnalysis = {
      summary: transcriptAnalysis.summary,
      keyTopics: transcriptAnalysis.keyTopics?.map(t => ({
        topic: typeof t === 'string' ? t : t.topic,
        description: typeof t === 'string' ? '' : t.description
      })) || [],
      sentiment: {
        overall: transcriptAnalysis.sentiment,
        employeeSentiment: transcriptAnalysis.rawAnalysis?.employeeSentiment,
        managerSentiment: transcriptAnalysis.rawAnalysis?.managerSentiment
      },
      engagementLevel: transcriptAnalysis.engagementLevel,
      concerns: transcriptAnalysis.concerns?.map(c => ({
        issue: typeof c === 'string' ? c : c.issue,
        severity: 'medium',
        recommendation: ''
      })) || [],
      highlights: transcriptAnalysis.highlights || [],
      careerDevelopmentTopics: transcriptAnalysis.careerDevelopment || [],
      blockers: transcriptAnalysis.blockers?.map(b => ({
        description: typeof b === 'string' ? b : b.description,
        suggestedResolution: ''
      })) || [],
      suggestedFollowUps: transcriptAnalysis.rawAnalysis?.suggestedFollowUps || [],
      analyzedAt: new Date(),
      analysisVersion: '1.0'
    };

    meeting.aiScoring = {
      employee: employeeScoring,
      manager: managerScoring
    };

    if (actionItems.actionItems?.length > 0) {
      actionItems.actionItems.forEach(item => {
        meeting.actionItems.push({
          description: item.description || item.task,
          assignedTo: item.assignedTo === 'manager' ? 'manager' : 'employee',
          priority: item.priority || 'medium',
          dueDate: item.dueDate ? new Date(item.dueDate) : null,
          source: 'ai_extracted'
        });
      });
    }

    await meeting.save();

    res.json({
      success: true,
      data: {
        aiAnalysis: meeting.aiAnalysis,
        aiScoring: meeting.aiScoring,
        actionItemsExtracted: actionItems.actionItems?.length || 0
      }
    });
  } catch (error) {
    console.error('Error analyzing meeting:', error);
    res.status(500).json({ success: false, error: 'Failed to analyze meeting' });
  }
});

/**
 * POST /api/one-on-ones/:id/score - Manager scores the employee
 */
router.post('/:id/score', requireManager, async (req, res) => {
  try {
    const meeting = await OneOnOne.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    const userId = req.session.user.id || req.session.user.sub;
    if (meeting.managerId !== userId && req.userRole !== 'hr_admin') {
      return res.status(403).json({ success: false, error: 'Only meeting manager can score' });
    }

    const {
      overallScore,
      performanceRating,
      dimensions,
      strengths,
      areasForGrowth,
      additionalComments,
      isVisible = false
    } = req.body;

    meeting.managerScoring = {
      overallScore,
      performanceRating,
      dimensions: dimensions || {},
      strengths,
      areasForGrowth,
      additionalComments,
      scoredAt: new Date(),
      isVisible
    };

    await meeting.save();

    res.json({
      success: true,
      data: meeting.managerScoring,
      message: 'Score saved successfully'
    });
  } catch (error) {
    console.error('Error saving score:', error);
    res.status(500).json({ success: false, error: 'Failed to save score' });
  }
});

/**
 * POST /api/one-on-ones/:id/agenda - Add agenda item
 */
router.post('/:id/agenda', requireAuth, async (req, res) => {
  try {
    const meeting = await OneOnOne.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    const userId = req.session.user.id || req.session.user.sub;
    const isManager = meeting.managerId === userId;
    const isEmployee = meeting.employeeId === userId;

    if (!isManager && !isEmployee) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { topic, description, priority = 'medium' } = req.body;
    const addedBy = isManager ? 'manager' : 'employee';

    meeting.agendaItems.push({ topic, description, addedBy, priority });
    await meeting.save();

    res.json({ success: true, data: meeting.agendaItems[meeting.agendaItems.length - 1] });
  } catch (error) {
    console.error('Error adding agenda item:', error);
    res.status(500).json({ success: false, error: 'Failed to add agenda item' });
  }
});

/**
 * POST /api/one-on-ones/:id/action-items - Add action item
 */
router.post('/:id/action-items', requireAuth, async (req, res) => {
  try {
    const meeting = await OneOnOne.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    const { description, assignedTo, category, priority, dueDate } = req.body;

    meeting.actionItems.push({
      description,
      assignedTo: assignedTo || 'employee',
      category: category || 'task',
      priority: priority || 'medium',
      dueDate,
      status: 'pending'
    });

    await meeting.save();

    res.json({ success: true, data: meeting.actionItems[meeting.actionItems.length - 1] });
  } catch (error) {
    console.error('Error adding action item:', error);
    res.status(500).json({ success: false, error: 'Failed to add action item' });
  }
});

/**
 * PUT /api/one-on-ones/:id/action-items/:itemId - Update action item
 */
router.put('/:id/action-items/:itemId', requireAuth, async (req, res) => {
  try {
    const meeting = await OneOnOne.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    const item = meeting.actionItems.find(a => a.id === req.params.itemId || a._id?.toString() === req.params.itemId);

    if (!item) {
      return res.status(404).json({ success: false, error: 'Action item not found' });
    }

    const { status, notes, dueDate } = req.body;

    if (status) {
      item.status = status;
      if (status === 'completed') {
        item.completedAt = new Date();
      }
    }
    if (notes !== undefined) item.notes = notes;
    if (dueDate) item.dueDate = new Date(dueDate);

    await meeting.save();

    res.json({ success: true, data: item });
  } catch (error) {
    console.error('Error updating action item:', error);
    res.status(500).json({ success: false, error: 'Failed to update action item' });
  }
});

/**
 * POST /api/one-on-ones/:id/complete - Mark meeting as completed
 */
router.post('/:id/complete', requireAuth, async (req, res) => {
  try {
    const meeting = await OneOnOne.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    const userId = req.session.user.id || req.session.user.sub;
    const isManager = meeting.managerId === userId;

    if (!isManager && req.userRole !== 'hr_admin') {
      return res.status(403).json({ success: false, error: 'Only manager can complete meeting' });
    }

    meeting.status = 'completed';
    meeting.completedAt = new Date();
    meeting.actualEndTime = meeting.actualEndTime || new Date();

    const { sharedNotes, privateManagerNotes } = req.body;
    if (sharedNotes) meeting.sharedNotes = sharedNotes;
    if (privateManagerNotes) meeting.privateManagerNotes = privateManagerNotes;

    await meeting.save();

    res.json({ success: true, data: meeting });
  } catch (error) {
    console.error('Error completing meeting:', error);
    res.status(500).json({ success: false, error: 'Failed to complete meeting' });
  }
});

/**
 * POST /api/one-on-ones/:id/mood - Record employee mood
 */
router.post('/:id/mood', requireAuth, async (req, res) => {
  try {
    const meeting = await OneOnOne.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    const userId = req.session.user.id || req.session.user.sub;
    if (meeting.employeeId !== userId) {
      return res.status(403).json({ success: false, error: 'Only employee can record mood' });
    }

    const { score, label, comment, factors } = req.body;

    meeting.employeeMood = {
      score,
      label,
      comment,
      factors: factors || [],
      recordedAt: new Date()
    };

    await meeting.save();

    res.json({ success: true, data: meeting.employeeMood });
  } catch (error) {
    console.error('Error recording mood:', error);
    res.status(500).json({ success: false, error: 'Failed to record mood' });
  }
});

/**
 * POST /api/one-on-ones/:id/feedback - Employee feedback
 */
router.post('/:id/feedback', requireAuth, async (req, res) => {
  try {
    const meeting = await OneOnOne.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    const userId = req.session.user.id || req.session.user.sub;
    if (meeting.employeeId !== userId) {
      return res.status(403).json({ success: false, error: 'Only employee can submit feedback' });
    }

    const { meetingQuality, managerRating, helpful, suggestions } = req.body;

    meeting.employeeFeedback = {
      meetingQuality,
      managerRating,
      helpful,
      suggestions,
      submittedAt: new Date()
    };

    await meeting.save();

    res.json({ success: true, message: 'Feedback submitted successfully' });
  } catch (error) {
    console.error('Error submitting feedback:', error);
    res.status(500).json({ success: false, error: 'Failed to submit feedback' });
  }
});

/**
 * GET /api/one-on-ones/:id/trends - Get meeting trends
 */
router.get('/:id/trends', requireAuth, async (req, res) => {
  try {
    const meeting = await OneOnOne.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    const history = await OneOnOne.getMeetingHistory(meeting.managerId, meeting.employeeId, 10);

    const analysisService = getMeetingAnalysisService();
    const trends = analysisService ? await analysisService.analyzeTrends(history) : { trend: 'analysis_unavailable' };

    res.json({
      success: true,
      data: { trends, meetingsAnalyzed: history.length }
    });
  } catch (error) {
    console.error('Error getting trends:', error);
    res.status(500).json({ success: false, error: 'Failed to get trends' });
  }
});

/**
 * POST /api/one-on-ones/:id/prep - Generate prep suggestions
 */
router.post('/:id/prep', requireAuth, async (req, res) => {
  try {
    const meeting = await OneOnOne.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    const analysisService = getMeetingAnalysisService();
    if (!analysisService) {
      return res.status(503).json({ success: false, error: 'Analysis service not available' });
    }

    const previousMeetings = await OneOnOne.find({
      managerId: meeting.managerId,
      employeeId: meeting.employeeId,
      status: 'completed'
    })
      .sort({ scheduledDate: -1 })
      .limit(3)
      .select('aiAnalysis.keyTopics actionItems employeeMood');

    const prepSuggestions = await analysisService.generateMeetingPrep({
      employeeRole: meeting.employeeInfo?.title,
      lastMeetingDate: previousMeetings[0]?.scheduledDate,
      previousTopics: previousMeetings.flatMap(m => m.aiAnalysis?.keyTopics?.map(t => t.topic || t) || []).slice(0, 5)
    });

    meeting.prepSuggestions = { ...prepSuggestions, generatedAt: new Date() };
    await meeting.save();

    res.json({ success: true, data: meeting.prepSuggestions });
  } catch (error) {
    console.error('Error generating prep:', error);
    res.status(500).json({ success: false, error: 'Failed to generate prep suggestions' });
  }
});

/**
 * DELETE /api/one-on-ones/:id - Cancel meeting
 */
router.delete('/:id', requireManager, async (req, res) => {
  try {
    const meeting = await OneOnOne.findById(req.params.id);

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    const userId = req.session.user.id || req.session.user.sub;
    if (meeting.managerId !== userId && req.userRole !== 'hr_admin') {
      return res.status(403).json({ success: false, error: 'Only meeting creator can cancel' });
    }

    meeting.status = 'cancelled';
    await meeting.save();

    const nylas = getNylasService();
    if (meeting.nylas?.eventId && nylas) {
      try {
        await nylas.deleteCalendarEvent(meeting.nylas.grantId, meeting.nylas.eventId);
      } catch (nylasError) {
        console.error('Failed to delete calendar event:', nylasError);
      }
    }

    res.json({ success: true, message: 'Meeting cancelled' });
  } catch (error) {
    console.error('Error cancelling meeting:', error);
    res.status(500).json({ success: false, error: 'Failed to cancel meeting' });
  }
});

module.exports = router;




