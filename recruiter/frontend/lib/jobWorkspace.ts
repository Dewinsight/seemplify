export type JobWorkflowType = 'recruitment' | 'employee-assessment';

export function getJobWorkspace(pathname: string | null, workflowType?: JobWorkflowType) {
  const assessment = workflowType
    ? workflowType === 'employee-assessment'
    : Boolean(pathname?.startsWith('/employee-assessments'));
  const basePath = assessment ? '/employee-assessments' : '/jobs';
  const copy = (text: string) => {
    if (!assessment) return text;
    if (text.trim() === 'Job Management') return text.replace('Job Management', 'Employee Assessments');
    if (text.trim() === 'Post New Job') return text.replace('Post New Job', 'New Assessment');
    if (text.trim() === 'Create Job Posting') return text.replace('Create Job Posting', 'Create Assessment');
    if (text.trim() === 'Jobs') return text.replace('Jobs', 'Employee Assessments');
    return text.replace(/\b(job postings?|job openings?|jobs?|candidates?|applicants?|recruitment|hiring)\b/gi, (word) => {
      const plural = /^(jobs|job postings|job openings|candidates|applicants)$/i.test(word);
      const people = /^(candidates?|applicants?)$/i.test(word);
      const replacement = people ? (plural ? 'employees' : 'employee') : (plural ? 'assessments' : 'assessment');
      return word[0] === word[0].toUpperCase() ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
    });
  };
  return {
    assessment,
    workflowType: (assessment ? 'employee-assessment' : 'recruitment') as JobWorkflowType,
    basePath,
    copy,
    path: (path: string) => path.replace(/^\/jobs(?=\/|\?|$)/, basePath),
  };
}

export function jobRecordPath(job: { _id: string; workflowType?: JobWorkflowType }, suffix = '') {
  return `${job.workflowType === 'employee-assessment' ? '/employee-assessments' : '/jobs'}/${job._id}${suffix}`;
}
