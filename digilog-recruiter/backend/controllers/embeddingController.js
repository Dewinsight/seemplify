const embeddingService = require('../services/embeddingService');
const prisma = require('../db/client');

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
    const totalJobs = await prisma.job.count();
    const embeddedJobs = await prisma.job.count({ where: { isEmbedded: true } });

    // Get candidate embedding status
    const totalCandidates = await prisma.candidate.count();
    const embeddedCandidates = await prisma.candidate.count({ where: { isEmbedded: true } });

    // Get recent embedding activity
    const recentJobEmbeddings = await prisma.job.findMany({
      where: {
        isEmbedded: true,
        embeddingCreatedAt: { not: null }
      },
      orderBy: { embeddingCreatedAt: 'desc' },
      take: 5,
      select: { id: true, title: true, embeddingCreatedAt: true }
    });

    const recentCandidateEmbeddings = await prisma.candidate.findMany({
      where: {
        isEmbedded: true,
        embeddingCreatedAt: { not: null }
      },
      orderBy: { embeddingCreatedAt: 'desc' },
      take: 5,
      select: { id: true, firstName: true, lastName: true, embeddingCreatedAt: true }
    });
    
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
    
    const job = await prisma.job.findUnique({ where: { id } });
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
    const updatedJob = await prisma.job.update({
      where: { id: job.id },
      data: { isEmbedded: true, embeddingCreatedAt: new Date() }
    });

    res.json({
      msg: 'Job re-embedded successfully',
      job: {
        id: updatedJob._id,
        title: updatedJob.title,
        embeddingCreatedAt: updatedJob.embeddingCreatedAt
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
    
    const candidate = await prisma.candidate.findUnique({ where: { id } });
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
    const updatedCandidate = await prisma.candidate.update({
      where: { id: candidate.id },
      data: { isEmbedded: true, embeddingCreatedAt: new Date() }
    });

    res.json({
      msg: 'Candidate re-embedded successfully',
      candidate: {
        id: updatedCandidate._id,
        name: `${updatedCandidate.firstName} ${updatedCandidate.lastName}`,
        embeddingCreatedAt: updatedCandidate.embeddingCreatedAt
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