const { resolveAppraisalAccessScope, canAppraiseEmployee } = require('./appraisalAccessService');

function denied(message) {
  return Object.assign(new Error(message), { status: 403 });
}

// Request bodies select identities; the Identity-derived roster supplies all
// membership, team and reviewer information used to create an appraisal.
async function resolveLaunchParticipants(req, requested) {
  const scope = await resolveAppraisalAccessScope(req, { includeSelf: req.userRole === 'hr_admin' });
  const roster = scope.isHrPlus ? scope.organizationUsers : scope.directReports;
  const result = [];
  for (const selection of requested) {
    const person = roster.find((entry) => String(entry.userId) === String(selection.userId));
    if (!person || !(await canAppraiseEmployee(req, { targetUserId: person.userId, targetEmail: person.email }))) {
      throw denied('A selected employee is outside your permitted appraisal scope. Refresh the staff list and choose again.');
    }
    result.push({ ...person });
  }
  return result;
}

module.exports = { resolveLaunchParticipants };
