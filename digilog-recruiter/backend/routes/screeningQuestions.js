const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');

const prisma = require('../db/client');

/**
 * Screening Questions Routes
 * CRUD operations for job screening questions
 */

// Apply authentication middleware
router.use(authMiddleware);

// Get all screening questions for a job
router.get('/jobs/:id/questions', async (req, res) => {
  try {
    const { id: jobId } = req.params;

    // Check if job exists
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      return res.status(404).json({ msg: 'Job not found' });
    }

    // Fetch all active questions
    const questions = await prisma.screeningQuestion.findMany({
      where: {
        jobId,
        isActive: true
      },
      orderBy: { order: 'asc' }
    });

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
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      return res.status(404).json({ msg: 'Job not found' });
    }

    // Only persist known ScreeningQuestion columns from the request body
    const writableFields = ['type', 'question', 'description', 'isRequired', 'order', 'options', 'condition', 'action'];
    const bodyData = {};
    writableFields.forEach(key => {
      if (req.body[key] !== undefined) bodyData[key] = req.body[key];
    });

    const screeningQuestion = await prisma.screeningQuestion.create({
      data: {
        jobId,
        ...bodyData,
        createdBy: req.user.id,
        isActive: true
      }
    });

    // Update job's updatedAt timestamp
    await prisma.job.update({ where: { id: job.id }, data: { updatedAt: new Date() } });

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
    let screeningQuestion = await prisma.screeningQuestion.findFirst({
      where: { id: questionId, jobId }
    });
    if (!screeningQuestion) {
      return res.status(404).json({ msg: 'Screening question not found' });
    }

    // Update fields (only persist known ScreeningQuestion columns)
    const updatableFields = ['type', 'question', 'description', 'isRequired', 'order', 'options', 'condition', 'action', 'isActive', 'createdBy'];
    const updateData = {};
    Object.keys(req.body).forEach(key => {
      if (req.body[key] !== undefined && updatableFields.includes(key)) {
        updateData[key] = req.body[key];
      }
    });
    updateData.updatedAt = new Date();

    screeningQuestion = await prisma.screeningQuestion.update({
      where: { id: screeningQuestion.id },
      data: updateData
    });

    // Update job's updatedAt timestamp
    await prisma.job.update({ where: { id: jobId }, data: { updatedAt: new Date() } });

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
    const screeningQuestion = await prisma.screeningQuestion.findFirst({
      where: { id: questionId, jobId }
    });
    if (!screeningQuestion) {
      return res.status(404).json({ msg: 'Screening question not found' });
    }

    // Soft delete by setting isActive to false
    await prisma.screeningQuestion.update({
      where: { id: screeningQuestion.id },
      data: { isActive: false, updatedAt: new Date() }
    });

    // Update job's updatedAt timestamp
    await prisma.job.update({ where: { id: jobId }, data: { updatedAt: new Date() } });

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
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      return res.status(404).json({ msg: 'Job not found' });
    }

    // Update orders
    for (const { questionId, order } of questionOrders) {
      const screeningQuestion = await prisma.screeningQuestion.findFirst({
        where: { id: questionId, jobId }
      });
      if (screeningQuestion) {
        await prisma.screeningQuestion.update({
          where: { id: screeningQuestion.id },
          data: { order, updatedAt: new Date() }
        });
      }
    }

    // Update job's updatedAt timestamp
    await prisma.job.update({ where: { id: job.id }, data: { updatedAt: new Date() } });

    res.json({ msg: 'Questions reordered successfully' });
  } catch (error) {
    console.error('Error reordering questions:', error);
    res.status(500).json({ msg: 'Failed to reorder questions', error: error.message });
  }
});

module.exports = router;
