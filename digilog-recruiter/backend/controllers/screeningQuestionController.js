const ScreeningQuestion = require('../models/ScreeningQuestion');
const Job = require('../models/Job');

/**
 * Screening Questions Controller
 * Manage dynamic screening questions for job postings
 */

// Get all screening questions for a job
exports.getQuestions = async (req, res) => {
  try {
    const { jobId } = req.params;

    // Check if job exists and user has access
    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({ msg: 'Job not found' });
    }

    // Check if user has permission (createdBy or is organization admin)
    // For now, allow access if job exists
    // TODO: Add proper permission checking

    const questions = await ScreeningQuestion.find({ 
      job: jobId,
      isActive: true 
    }).sort({ order: 1 });

    res.json(questions);
  } catch (error) {
    console.error('Error fetching screening questions:', error);
    res.status(500).json({ msg: 'Failed to fetch screening questions', error: error.message });
  }
};

// Create a new screening question
exports.createQuestion = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { 
      type, 
      question, 
      description, 
      isRequired, 
      order, 
      options = [],
      condition = null,
      action = null 
    } = req.body;

    // Validate job exists
    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({ msg: 'Job not found' });
    }

    // Validate type
    const validTypes = ['radio', 'checkbox', 'text', 'select', 'multiselect', 'date', 'number'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ msg: 'Invalid question type' });
    }

    // If condition is provided, validate it
    if (condition && (!condition.dependsOn || !condition.operator || condition.value === undefined)) {
      return res.status(400).json({ msg: 'Invalid condition. Must include dependsOn, operator, and value' });
    }

    // Validate operator
    const validOperators = ['equals', 'not_equals', 'contains', 'not_contains'];
    if (condition && !validOperators.includes(condition.operator)) {
      return res.status(400).json({ msg: 'Invalid operator' });
    }

    // If action is provided, validate it
    if (action && (!action.value || !action.actionType)) {
      return res.status(400).json({ msg: 'Invalid action. Must include value and actionType' });
    }

    // Validate actionType
    const validActionTypes = ['shortlist', 'reject', 'flag'];
    if (action && !validActionTypes.includes(action.actionType)) {
      return res.status(400).json({ msg: 'Invalid action type' });
    }

    // Validate options for radio, checkbox, select, multiselect
    if (['radio', 'checkbox', 'select', 'multiselect'].includes(type)) {
      if (!Array.isArray(options) || options.length === 0) {
        return res.status(400).json({ msg: 'Options are required for this question type' });
      }

      // Validate options structure
      for (const opt of options) {
        if (!opt.value || !opt.label) {
          return res.status(400).json({ msg: 'Each option must have value and label' });
        }
      }
    }

    const screeningQuestion = new ScreeningQuestion({
      job: jobId,
      type,
      question,
      description,
      isRequired,
      order,
      options,
      condition,
      action,
      createdBy: req.user?._id || req.admin?._id,
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
};

// Update a screening question
exports.updateQuestion = async (req, res) => {
  try {
    const { jobId, questionId } = req.params;

    const { 
      type, 
      question, 
      description, 
      isRequired, 
      order, 
      options, 
      condition, 
      action,
      isActive 
    } = req.body;

    // Validate question exists
    const screeningQuestion = await ScreeningQuestion.findOne({ _id: questionId, job: jobId });
    if (!screeningQuestion) {
      return res.status(404).json({ msg: 'Screening question not found' });
    }

    // Validate type if provided
    if (type) {
      const validTypes = ['radio', 'checkbox', 'text', 'select', 'multiselect', 'date', 'number'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ msg: 'Invalid question type' });
      }
    }

    // Validate options if provided
    if (options !== undefined) {
      if (['radio', 'checkbox', 'select', 'multiselect'].includes(screeningQuestion.type || type)) {
        if (!Array.isArray(options)) {
          return res.status(400).json({ msg: 'Options must be an array' });
        }
        for (const opt of options) {
          if (!opt.value || !opt.label) {
            return res.status(400).json({ msg: 'Each option must have value and label' });
          }
        }
      }
    }

    // Validate condition if provided
    if (condition !== undefined && condition !== null) {
      if (!condition.dependsOn || !condition.operator || condition.value === undefined) {
        return res.status(400).json({ msg: 'Invalid condition' });
      }
      const validOperators = ['equals', 'not_equals', 'contains', 'not_contains'];
      if (!validOperators.includes(condition.operator)) {
        return res.status(400).json({ msg: 'Invalid operator' });
      }
    }

    // Validate action if provided
    if (action !== undefined && action !== null) {
      if (!action.value || !action.actionType) {
        return res.status(400).json({ msg: 'Invalid action' });
      }
      const validActionTypes = ['shortlist', 'reject', 'flag'];
      if (!validActionTypes.includes(action.actionType)) {
        return res.status(400).json({ msg: 'Invalid action type' });
      }
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
};

// Delete a screening question
exports.deleteQuestion = async (req, res) => {
  try {
    const { jobId, questionId } = req.params;

    const screeningQuestion = await ScreeningQuestion.findOne({ _id: questionId, job: jobId });
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
};

// Reorder questions (bulk update order)
exports.reorderQuestions = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { questionOrders } = req.body; // Array of { questionId, order }

    // Validate input
    if (!Array.isArray(questionOrders)) {
      return res.status(400).json({ msg: 'questionOrders must be an array' });
    }

    // Validate job exists
    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({ msg: 'Job not found' });
    }

    // Update orders
    for (const { questionId, order } of questionOrders) {
      const screeningQuestion = await ScreeningQuestion.findOne({ _id: questionId, job: jobId });
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
};
