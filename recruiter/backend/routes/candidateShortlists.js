const express = require('express');
const router = express.Router();
const Job = require('../models/Job');
const authMiddleware = require('../middleware/authMiddleware');

// Get shortlist information for all candidates
router.get('/', authMiddleware, async (req, res) => {
  try {
    const organizationId = req.user?.currentOrganization;
    
    if (!organizationId) {
      return res.status(400).json({ msg: 'Organization context required' });
    }

    // Find all jobs for this organization that have shortlisted candidates
    const jobs = await Job.find({ 
      organization: organizationId,
      'shortlist.0': { $exists: true } // Only jobs with at least one shortlisted candidate
    })
    .select('_id title shortlist')
    .populate({
      path: 'shortlist.candidate',
      select: '_id firstName lastName email'
    });

    // Create a map of candidateId -> array of jobs they're shortlisted for
    const candidateShortlists = {};

    jobs.forEach(job => {
      job.shortlist.forEach(shortlistItem => {
        if (shortlistItem.candidate && shortlistItem.candidate._id) {
          const candidateId = shortlistItem.candidate._id.toString();
          
          if (!candidateShortlists[candidateId]) {
            candidateShortlists[candidateId] = [];
          }
          
          candidateShortlists[candidateId].push({
            jobId: job._id,
            jobTitle: job.title,
            status: shortlistItem.status || 'shortlisted',
            addedAt: shortlistItem.addedAt,
            relevanceScore: shortlistItem.relevanceScore
          });
        }
      });
    });

    res.json({
      candidateShortlists,
      totalCandidatesWithShortlists: Object.keys(candidateShortlists).length
    });

  } catch (error) {
    console.error('❌ Error fetching candidate shortlists:', error);
    res.status(500).json({ 
      msg: 'Server error fetching candidate shortlists', 
      error: error.message 
    });
  }
});

module.exports = router;
