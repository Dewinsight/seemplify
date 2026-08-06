const Notification = require('../models/Notification');
const Organization = require('../models/Organization');

/**
 * Runs when a user signs in: wakes any of their organization's CV analyses
 * that are parked waiting for an AI runtime, and leaves a bell notification
 * so the recruiter knows applicants arrived while they were away. A public
 * application is never lost — it waits in the pipeline, and the recruiter's
 * own arrival (often bringing a freshly routable ChatGPT account) is the
 * moment to try again and to say so.
 */
async function handleLoginRuntimeCheck(user, { queue = null } = {}) {
  const organizationId = user?.currentOrganization;
  if (!organizationId) return null;

  const cvQueue = queue || require('./cvAnalysisQueueService');
  const { waiting, promoted } = await cvQueue.promoteWaitingJobsForOrganization(organizationId);
  if (!waiting) return null;

  const organization = await Organization.findById(organizationId).select('name').lean();
  const dayBucket = new Date().toISOString().slice(0, 10);
  const count = waiting === 1 ? 'One applicant CV is' : `${waiting} applicant CVs are`;
  try {
    await Notification.bulkWrite([{
      updateOne: {
        filter: { user: user._id, eventKey: `cv_runtime_waiting:${organizationId}:${dayBucket}` },
        update: {
          $setOnInsert: {
            user: user._id,
            eventKey: `cv_runtime_waiting:${organizationId}:${dayBucket}`,
            type: 'general',
            title: 'Candidate CVs waiting for AI analysis',
            message: `${count} waiting for an AI runtime. Analysis has been queued to run now on the workspace's active runtime.`,
            data: {
              organizationId: String(organizationId),
              organizationName: organization?.name,
              waitingJobs: waiting,
              promotedJobs: promoted
            },
            actionUrl: '/candidates',
            actionText: 'View candidates',
            priority: 'medium'
          }
        },
        upsert: true
      }
    }], { ordered: false });
  } catch (error) {
    if (Number(error?.code) !== 11000) throw error;
  }
  return { waiting, promoted };
}

module.exports = { handleLoginRuntimeCheck };
