const embeddingService = require('../services/embeddingService');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');

/**
 * Re-embed all jobs (fixes skills parsing issue)
 */
exports.reEmbedAllJobs = async (req, res) => {
  try {
    console.log('🔄 Starting job re-embedding process...');
    
    const result = await embeddingService.reEmbedAllJobs();
    
    res.json({
      msg: 'Job re-embedding completed successfully',
      ...result
    });
    
  } catch (error) {
    console.error('❌ Error in job re-embedding:', error);
    res.status(500).json({
      msg: 'Failed to re-embed jobs',
      error: error.message
    });
  }
};

/**
 * Re-embed all candidates
 */
exports.reEmbedAllCandidates = async (req, res) => {
  try {
    console.log('🔄 Starting candidate re-embedding process...');
    
    const result = await embeddingService.reEmbedAllCandidates();
    
    res.json({
      msg: 'Candidate re-embedding completed successfully',
      ...result
    });
    
  } catch (error) {
    console.error('❌ Error in candidate re-embedding:', error);
    res.status(500).json({
      msg: 'Failed to re-embed candidates',
      error: error.message
    });
  }
};

/**
 * Re-embed all jobs and candidates
 */
exports.reEmbedAll = async (req, res) => {
  try {
    console.log('🚀 Starting complete re-embedding process...');
    
    const result = await embeddingService.reEmbedAll();
    
    res.json({
      msg: 'Complete re-embedding finished successfully',
      ...result
    });
    
  } catch (error) {
    console.error('❌ Error in complete re-embedding:', error);
    res.status(500).json({
      msg: 'Failed to complete re-embedding process',
      error: error.message
    });
  }
};

/**
 * Get embedding status overview
 */
exports.getEmbeddingStatus = async (req, res) => {
  try {
    console.log('📊 Getting embedding status overview...');
    
    // Get job embedding status
    const totalJobs = await Job.countDocuments();
    const embeddedJobs = await Job.countDocuments({ isEmbedded: true });
    
    // Get candidate embedding status
    const totalCandidates = await Candidate.countDocuments();
    const embeddedCandidates = await Candidate.countDocuments({ isEmbedded: true });
    
    // Get recent embedding activity
    const recentJobEmbeddings = await Job.find({ 
      isEmbedded: true,
      embeddingCreatedAt: { $exists: true }
    })
    .sort({ embeddingCreatedAt: -1 })
    .limit(5)
    .select('title embeddingCreatedAt');
    
    const recentCandidateEmbeddings = await Candidate.find({ 
      isEmbedded: true,
      embeddingCreatedAt: { $exists: true }
    })
    .sort({ embeddingCreatedAt: -1 })
    .limit(5)
    .select('firstName lastName embeddingCreatedAt');
    
    const status = {
      jobs: {
        total: totalJobs,
        embedded: embeddedJobs,
        percentage: totalJobs > 0 ? Math.round((embeddedJobs / totalJobs) * 100) : 0,
        recent: recentJobEmbeddings
      },
      candidates: {
        total: totalCandidates,
        embedded: embeddedCandidates,
        percentage: totalCandidates > 0 ? Math.round((embeddedCandidates / totalCandidates) * 100) : 0,
        recent: recentCandidateEmbeddings
      },
      timestamp: new Date().toISOString()
    };
    
    res.json({
      msg: 'Embedding status retrieved successfully',
      status
    });
    
  } catch (error) {
    console.error('❌ Error getting embedding status:', error);
    res.status(500).json({
      msg: 'Failed to get embedding status',
      error: error.message
    });
  }
};

/**
 * Re-embed a specific job
 */
exports.reEmbedJob = async (req, res) => {
  try {
    const { id } = req.params;
    
    const job = await Job.findById(id);
    if (!job) {
      return res.status(404).json({ msg: 'Job not found' });
    }
    
    console.log(`🔄 Re-embedding job: ${job.title}`);
    
    // Delete existing embedding first
    try {
      await embeddingService.deleteEmbedding(job._id.toString(), embeddingService.jobIndexName);
      console.log(`🗑️ Deleted old embedding for job: ${job._id}`);
    } catch (deleteError) {
      console.warn(`⚠️ Could not delete old embedding for job ${job._id}:`, deleteError.message);
    }
    
    // Create new embedding
    await embeddingService.createJobEmbedding(job);
    
    // Update job document
    job.isEmbedded = true;
    job.embeddingCreatedAt = new Date();
    await job.save();
    
    res.json({
      msg: 'Job re-embedded successfully',
      job: {
        id: job._id,
        title: job.title,
        embeddingCreatedAt: job.embeddingCreatedAt
      }
    });
    
  } catch (error) {
    console.error('❌ Error re-embedding job:', error);
    res.status(500).json({
      msg: 'Failed to re-embed job',
      error: error.message
    });
  }
};

/**
 * Re-embed a specific candidate
 */
exports.reEmbedCandidate = async (req, res) => {
  try {
    const { id } = req.params;
    
    const candidate = await Candidate.findById(id);
    if (!candidate) {
      return res.status(404).json({ msg: 'Candidate not found' });
    }
    
    console.log(`🔄 Re-embedding candidate: ${candidate.firstName} ${candidate.lastName}`);
    
    // Delete existing embedding first
    try {
      await embeddingService.deleteEmbedding(candidate._id.toString(), embeddingService.candidateIndexName);
      console.log(`🗑️ Deleted old embedding for candidate: ${candidate._id}`);
    } catch (deleteError) {
      console.warn(`⚠️ Could not delete old embedding for candidate ${candidate._id}:`, deleteError.message);
    }
    
    // Create new embedding
    await embeddingService.createCandidateEmbedding(candidate);
    
    // Update candidate document
    candidate.isEmbedded = true;
    candidate.embeddingCreatedAt = new Date();
    await candidate.save();
    
    res.json({
      msg: 'Candidate re-embedded successfully',
      candidate: {
        id: candidate._id,
        name: `${candidate.firstName} ${candidate.lastName}`,
        embeddingCreatedAt: candidate.embeddingCreatedAt
      }
    });
    
  } catch (error) {
    console.error('❌ Error re-embedding candidate:', error);
    res.status(500).json({
      msg: 'Failed to re-embed candidate',
      error: error.message
    });
  }
}; 