const prisma = require('../db/client');

/**
 * Clean up null candidate references from a job's shortlist and applicants
 * @param {Object} job - The job document (must be populated with candidate references)
 * @param {Boolean} saveChanges - Whether to save changes to the database
 * @returns {Object} - Object with cleanup statistics
 */
async function cleanupJobCandidateReferences(job, saveChanges = true) {
  const cleanup = {
    shortlistBefore: job.shortlist.length,
    applicantsBefore: job.applicants.length,
    shortlistAfter: 0,
    applicantsAfter: 0,
    shortlistCleaned: 0,
    applicantsCleaned: 0,
    changed: false
  };

  // Clean shortlist
  const validShortlist = job.shortlist.filter(item => item.candidate !== null);
  cleanup.shortlistAfter = validShortlist.length;
  cleanup.shortlistCleaned = cleanup.shortlistBefore - cleanup.shortlistAfter;
  
  if (cleanup.shortlistCleaned > 0) {
    job.shortlist = validShortlist;
    cleanup.changed = true;
    console.log(`🧹 Cleaned up ${cleanup.shortlistCleaned} deleted candidate(s) from job ${job._id} shortlist`);
  }

  // Clean applicants
  const validApplicants = job.applicants.filter(applicant => applicant.candidate !== null);
  cleanup.applicantsAfter = validApplicants.length;
  cleanup.applicantsCleaned = cleanup.applicantsBefore - cleanup.applicantsAfter;
  
  if (cleanup.applicantsCleaned > 0) {
    job.applicants = validApplicants;
    cleanup.changed = true;
    console.log(`🧹 Cleaned up ${cleanup.applicantsCleaned} deleted candidate(s) from job ${job._id} applicants`);
  }

  // Save changes if requested
  if (cleanup.changed && saveChanges) {
    await job.save();
    console.log(`✅ Job ${job._id} cleanup saved to database`);
  }

  return cleanup;
}

/**
 * Clean up null candidate references across all jobs
 * @param {Boolean} dryRun - If true, don't save changes to database
 * @returns {Object} - Overall cleanup statistics
 */
async function cleanupAllJobCandidateReferences(dryRun = false) {
  console.log(`🧹 Starting ${dryRun ? 'dry run' : 'cleanup'} of all job candidate references...`);
  
  const jobs = await prisma.job.findMany({})
    .populate('shortlist.candidate')
    .populate('applicants.candidate');
  
  const overallStats = {
    totalJobs: jobs.length,
    jobsWithIssues: 0,
    totalShortlistCleaned: 0,
    totalApplicantsCleaned: 0,
    jobsProcessed: []
  };

  for (const job of jobs) {
    const cleanup = await cleanupJobCandidateReferences(job, !dryRun);
    
    if (cleanup.changed) {
      overallStats.jobsWithIssues++;
      overallStats.totalShortlistCleaned += cleanup.shortlistCleaned;
      overallStats.totalApplicantsCleaned += cleanup.applicantsCleaned;
      overallStats.jobsProcessed.push({
        jobId: job._id,
        title: job.title,
        ...cleanup
      });
    }
  }

  console.log(`✅ ${dryRun ? 'Dry run' : 'Cleanup'} completed:`);
  console.log(`   - Jobs processed: ${overallStats.totalJobs}`);
  console.log(`   - Jobs with issues: ${overallStats.jobsWithIssues}`);
  console.log(`   - Total shortlist references cleaned: ${overallStats.totalShortlistCleaned}`);
  console.log(`   - Total applicant references cleaned: ${overallStats.totalApplicantsCleaned}`);

  return overallStats;
}

module.exports = {
  cleanupJobCandidateReferences,
  cleanupAllJobCandidateReferences
}; 