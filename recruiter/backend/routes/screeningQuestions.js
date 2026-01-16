const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');

const ScreeningQuestion = require('../models/ScreeningQuestion');
const Job = require('../models/Job');

/**
 * Screening Questions Routes
 * CRUD operations for job screening questions
 */

// Apply authentication middleware
router.use(verifyToken);

// Get all screening questions for a job
router.get('/jobs/:id/questions', async (req, res) => {
  try {
    const { id: jobId } = req.params;

    // Check if job exists
    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({ msg: 'Job not found' });
    }

    // Fetch all active questions
    const questions = await ScreeningQuestion.find({
      job: jobId,
      isActive: true
    }).sort({ order: 1 });

    res.json(questions);
  } catch (error) {
    console.error('Error fetching screening questions:', error);
    res.status(500).json({ msg: 'Failed to fetch screening questions', error: error.message });
  }
});

// Create a new screening question
router.post('/jobs/:id/questions', async (req, res) => {
  try {
    const { id: jobId } = req.params;

    // Check if job exists
    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({ msg: 'Job not found' });
    }

    const screeningQuestion = new ScreeningQuestion({
      job: jobId,
      ...req.body,
      createdBy: req.user._id,
      isActive: true
    });

    await screeningQuestion.save();

    // Update job's updatedAt timestamp
    job.updatedAt = Date.now();
    await job.save();

    res.status(201).json(screeningQuestion);
  } catch (error) {
    console.error('Error creating screening question:', error);
    res.status(500).json({ msg: 'Failed to create screening question', error: error.message });
  }
});

// Update a screening question
router.put('/jobs/:id/questions/:questionId', async (req, res) => {
  try {
    const { id: jobId, questionId } = req.params;

    // Check if question exists
    const screeningQuestion = await ScreeningQuestion.findOne({
      _id: questionId,
      job: jobId
    });
    if (!screeningQuestion) {
      return res.status(404).json({ msg: 'Screening question not found' });
    }

    // Update fields
    Object.keys(req.body).forEach(key => {
      if (req.body[key] !== undefined) {
        screeningQuestion[key] = req.body[key];
      }
    });

    screeningQuestion.updatedAt = Date.now();
    await screeningQuestion.save();

    // Update job's updatedAt timestamp
    const job = await Job.findById(jobId);
    job.updatedAt = Date.now();
    await job.save();

    res.json(screeningQuestion);
  } catch (error) {
    console.error('Error updating screening question:', error);
    res.status(500).json({ msg: 'Failed to update screening question', error: error.message });
  }
});

// Delete a screening question (soft delete)
router.delete('/jobs/:id/questions/:questionId', async (req, res) => {
  try {
    const { id: jobId, questionId } = req.params;

    // Check if question exists
    const screeningQuestion = await ScreeningQuestion.findOne({
      _id: questionId,
      job: jobId
    });
    if (!screeningQuestion) {
      return res.status(404).json({ msg: 'Screening question not found' });
    }

    // Soft delete by setting isActive to false
    screeningQuestion.isActive = false;
    screeningQuestion.updatedAt = Date.now();
    await screeningQuestion.save();

    // Update job's updatedAt timestamp
    const job = await Job.findById(jobId);
    job.updatedAt = Date.now();
    await job.save();

    res.json({ msg: 'Screening question deleted successfully' });
  } catch (error) {
    console.error('Error deleting screening question:', error);
    res.status(500).json({ msg: 'Failed to delete screening question', error: error.message });
  }
});

// Reorder questions
router.put('/jobs/:id/questions/reorder', async (req, res) => {
  try {
    const { id: jobId } = req.params;
    const { questionOrders } = req.body; // Array of { questionId, order }

    // Validate input
    if (!Array.isArray(questionOrders)) {
      return res.status(400).json({ msg: 'questionOrders must be an array' });
    }

    // Check if job exists
    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({ msg: 'Job not found' });
    }

    // Update orders
    for (const { questionId, order } of questionOrders) {
      const screeningQuestion = await ScreeningQuestion.findOne({
        _id: questionId,
        job: jobId
      });
      if (screeningQuestion) {
        screeningQuestion.order = order;
        screeningQuestion.updatedAt = Date.now();
        await screeningQuestion.save();
      }
    }

    // Update job's updatedAt timestamp
    job.updatedAt = Date.now();
    await job.save();

    res.json({ msg: 'Questions reordered successfully' });
  } catch (error) {
    console.error('Error reordering questions:', error);
    res.status(500).json({ msg: 'Failed to reorder questions', error: error.message });
  }
});

module.exports = router;
