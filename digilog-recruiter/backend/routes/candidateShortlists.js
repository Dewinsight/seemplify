const express = require('express');
const router = express.Router();
const prisma = require('../db/client');
const authMiddleware = require('../middleware/authMiddleware');

// Get shortlist information for all candidates
router.get('/', authMiddleware, async (req, res) => {
  try {
    const organizationId = req.user?.currentOrganization;
    
    if (!organizationId) {
      return res.status(400).json({ msg: 'Organization context required' });
    }

    // Find all jobs for this organization, then keep only those with shortlisted
    // candidates (the Mongo `'shortlist.0': {$exists:true}` filter is applied in JS
    // since shortlist is a Json column).
    const allJobs = await prisma.job.findMany({
      where: { organizationId: organizationId },
      select: { id: true, title: true, shortlist: true },
    });
    const jobs = allJobs.filter(job => Array.isArray(job.shortlist) && job.shortlist.length > 0);

    // Stitch shortlist[].candidate (soft ref id) -> candidate object (replaces the
    // old Mongoose `.populate('shortlist.candidate', '_id firstName lastName email')`).
    const candidateIds = [...new Set(
      jobs.flatMap(job => (job.shortlist || []).map(item => item && (item.candidate?._id || item.candidate)))
        .filter(Boolean).map(String)
    )];
    const candidatesList = candidateIds.length
      ? await prisma.candidate.findMany({
          where: { id: { in: candidateIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const candidateMap = new Map(candidatesList.map(c => [c.id, c]));
    jobs.forEach(job => {
      job.shortlist = (job.shortlist || []).map(item => {
        const cid = item && (item.candidate?._id || item.candidate);
        return cid && candidateMap.has(String(cid))
          ? { ...item, candidate: candidateMap.get(String(cid)) }
          : item;
      });
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
