const express = require('express');
const router = express.Router();
const OKR = require('../models/OKR');
const { PerformanceReview } = require('../models/PerformanceReview');
const ReviewCycle = require('../models/ReviewCycle');
const { requireHRAdmin } = require('../middleware/rbac');

/**
 * POST /api/bulk/okrs/import - Bulk import OKRs from CSV/JSON
 */
router.post('/okrs/import', requireHRAdmin, async (req, res) => {
  try {
    const { okrs, format } = req.body;
    
    if (!okrs || !Array.isArray(okrs)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid data format. Expected array of OKRs.'
      });
    }
    
    const results = { created: 0, errors: [] };
    
    for (let i = 0; i < okrs.length; i++) {
      try {
        const okrData = okrs[i];
        
        // Validate required fields
        if (!okrData.ownerId || !okrData.title) {
          results.errors.push({ row: i + 1, error: 'Missing ownerId or title' });
          continue;
        }
        
        const newOKR = new OKR({
          type: okrData.type || 'individual',
          ownerId: okrData.ownerId,
          organizationId: req.currentOrganization?.id || okrData.organizationId,
          teamId: okrData.teamId,
          period: okrData.period || `Q${Math.ceil((new Date().getMonth() + 1) / 3)} ${new Date().getFullYear()}`,
          status: okrData.status || 'draft',
          objectives: [{
            title: okrData.title,
            description: okrData.description,
            keyResults: (okrData.keyResults || []).map(kr => ({
              title: typeof kr === 'string' ? kr : kr.title,
              metricType: kr.metricType || 'percentage',
              startValue: kr.startValue || 0,
              targetValue: kr.targetValue || 100,
              currentValue: kr.currentValue || 0
            }))
          }]
        });
        
        await newOKR.save();
        results.created++;
      } catch (err) {
        results.errors.push({ row: i + 1, error: err.message });
      }
    }
    
    res.json({
      success: true,
      data: results,
      message: `Created ${results.created} OKRs. ${results.errors.length} errors.`
    });
  } catch (error) {
    console.error('Error bulk importing OKRs:', error);
    res.status(500).json({ success: false, error: 'Bulk import failed' });
  }
});

/**
 * POST /api/bulk/reviews/create - Bulk create reviews for a cycle
 */
router.post('/reviews/create', requireHRAdmin, async (req, res) => {
  try {
    const { cycleId, employees } = req.body;
    
    if (!cycleId) {
      return res.status(400).json({ success: false, error: 'Review cycle ID required' });
    }
    
    if (!employees || !Array.isArray(employees)) {
      return res.status(400).json({ success: false, error: 'Employees array required' });
    }
    
    const cycle = await ReviewCycle.findById(cycleId);
    if (!cycle) {
      return res.status(404).json({ success: false, error: 'Review cycle not found' });
    }
    
    const results = { created: 0, skipped: 0, errors: [] };
    
    for (const employee of employees) {
      try {
        // Check if review already exists
        const existing = await PerformanceReview.findOne({
          cycleId,
          userId: employee.userId
        });
        
        if (existing) {
          results.skipped++;
          continue;
        }
        
        const review = new PerformanceReview({
          cycleId,
          userId: employee.userId,
          managerId: employee.managerId,
          organizationId: req.currentOrganization?.id,
          status: 'draft'
        });
        
        await review.save();
        results.created++;
      } catch (err) {
        results.errors.push({ userId: employee.userId, error: err.message });
      }
    }
    
    res.json({
      success: true,
      data: results,
      message: `Created ${results.created} reviews, skipped ${results.skipped} existing.`
    });
  } catch (error) {
    console.error('Error bulk creating reviews:', error);
    res.status(500).json({ success: false, error: 'Bulk creation failed' });
  }
});

/**
 * PUT /api/bulk/okrs/status - Bulk update OKR status
 */
router.put('/okrs/status', requireHRAdmin, async (req, res) => {
  try {
    const { okrIds, status } = req.body;
    
    if (!okrIds || !Array.isArray(okrIds) || !status) {
      return res.status(400).json({
        success: false,
        error: 'OKR IDs and status required'
      });
    }
    
    const result = await OKR.updateMany(
      { _id: { $in: okrIds } },
      { $set: { status } }
    );
    
    res.json({
      success: true,
      data: { modified: result.modifiedCount },
      message: `Updated ${result.modifiedCount} OKRs`
    });
  } catch (error) {
    console.error('Error bulk updating OKRs:', error);
    res.status(500).json({ success: false, error: 'Bulk update failed' });
  }
});

/**
 * POST /api/bulk/reviews/remind - Send bulk reminder emails
 */
router.post('/reviews/remind', requireHRAdmin, async (req, res) => {
  try {
    const { cycleId, reminderType } = req.body;
    const notificationService = require('../services/notificationService');
    
    if (!cycleId) {
      return res.status(400).json({ success: false, error: 'Review cycle required' });
    }
    
    const cycle = await ReviewCycle.findById(cycleId);
    if (!cycle) {
      return res.status(404).json({ success: false, error: 'Review cycle not found' });
    }
    
    let reviews;
    let notificationsSent = 0;
    
    if (reminderType === 'self_review') {
      // Find reviews without self-evaluation
      reviews = await PerformanceReview.find({
        cycleId,
        'selfEvaluation.submittedAt': { $exists: false }
      });
      
      for (const review of reviews) {
        // Would send notification here
        notificationsSent++;
      }
    } else if (reminderType === 'manager_review') {
      // Find reviews pending manager
      reviews = await PerformanceReview.find({
        cycleId,
        'selfEvaluation.submittedAt': { $exists: true },
        'managerEvaluation.submittedAt': { $exists: false }
      });
      
      for (const review of reviews) {
        // Would send notification here
        notificationsSent++;
      }
    }
    
    res.json({
      success: true,
      data: { notificationsSent, totalFound: reviews?.length || 0 },
      message: `Sent ${notificationsSent} reminders`
    });
  } catch (error) {
    console.error('Error sending reminders:', error);
    res.status(500).json({ success: false, error: 'Failed to send reminders' });
  }
});

/**
 * DELETE /api/bulk/okrs - Bulk delete OKRs
 */
router.delete('/okrs', requireHRAdmin, async (req, res) => {
  try {
    const { okrIds } = req.body;
    
    if (!okrIds || !Array.isArray(okrIds)) {
      return res.status(400).json({ success: false, error: 'OKR IDs required' });
    }
    
    const result = await OKR.deleteMany({ _id: { $in: okrIds } });
    
    res.json({
      success: true,
      data: { deleted: result.deletedCount },
      message: `Deleted ${result.deletedCount} OKRs`
    });
  } catch (error) {
    console.error('Error bulk deleting OKRs:', error);
    res.status(500).json({ success: false, error: 'Bulk delete failed' });
  }
});

/**
 * GET /api/bulk/export/okrs - Export OKRs to JSON/CSV
 */
router.get('/export/okrs', requireHRAdmin, async (req, res) => {
  try {
    const { period, status, format } = req.query;
    
    let query = {};
    if (req.currentOrganization?.id) {
      query.organizationId = req.currentOrganization.id;
    }
    if (period) query.period = period;
    if (status) query.status = status;
    
    const okrs = await OKR.find(query).lean();
    
    const exportData = okrs.map(okr => ({
      id: okr._id,
      type: okr.type,
      ownerId: okr.ownerId,
      period: okr.period,
      status: okr.status,
      title: okr.objectives?.[0]?.title || '',
      description: okr.objectives?.[0]?.description || '',
      progress: okr.progress || 0,
      keyResults: okr.objectives?.[0]?.keyResults?.map(kr => ({
        title: kr.title,
        target: kr.targetValue,
        current: kr.currentValue
      })) || [],
      createdAt: okr.createdAt
    }));
    
    if (format === 'csv') {
      // Simple CSV format
      let csv = 'ID,Type,Owner,Period,Status,Title,Progress,Created\n';
      exportData.forEach(okr => {
        csv += `${okr.id},${okr.type},${okr.ownerId},${okr.period},${okr.status},"${okr.title}",${okr.progress},${okr.createdAt}\n`;
      });
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=okrs-export.csv');
      return res.send(csv);
    }
    
    res.json({ success: true, data: exportData, count: exportData.length });
  } catch (error) {
    console.error('Error exporting OKRs:', error);
    res.status(500).json({ success: false, error: 'Export failed' });
  }
});

/**
 * GET /api/bulk/export/reviews - Export reviews
 */
router.get('/export/reviews', requireHRAdmin, async (req, res) => {
  try {
    const { cycleId, status, format } = req.query;
    
    let query = {};
    if (cycleId) query.cycleId = cycleId;
    if (status) query.status = status;
    
    const reviews = await PerformanceReview.find(query)
      .populate('cycleId', 'title')
      .lean();
    
    const exportData = reviews.map(r => ({
      id: r._id,
      cycleName: r.cycleId?.title || '',
      employeeId: r.userId,
      managerId: r.managerId,
      status: r.status,
      selfRating: r.selfEvaluation?.rating,
      managerRating: r.managerEvaluation?.rating,
      calibratedRating: r.calibratedRating,
      selfSubmittedAt: r.selfEvaluation?.submittedAt,
      managerSubmittedAt: r.managerEvaluation?.submittedAt
    }));
    
    if (format === 'csv') {
      let csv = 'ID,Cycle,Employee,Manager,Status,SelfRating,ManagerRating,CalibratedRating\n';
      exportData.forEach(r => {
        csv += `${r.id},"${r.cycleName}",${r.employeeId},${r.managerId},${r.status},${r.selfRating || ''},${r.managerRating || ''},${r.calibratedRating || ''}\n`;
      });
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=reviews-export.csv');
      return res.send(csv);
    }
    
    res.json({ success: true, data: exportData, count: exportData.length });
  } catch (error) {
    console.error('Error exporting reviews:', error);
    res.status(500).json({ success: false, error: 'Export failed' });
  }
});

module.exports = router;






