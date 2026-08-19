const crypto = require('crypto');

const MATCHING_CANDIDATE_PROJECTION = [
  '_id', 'firstName', 'lastName', 'email', 'phone', 'position', 'experience',
  'skills', 'education', 'location', 'status', 'aiAnalysis', 'workExperience',
  'educationHistory', 'certifications', 'languages', 'awards', 'projects',
  'publications', 'volunteerWork', 'professionalMemberships', 'portfolioLinks',
  'additionalSections', 'fullCVData'
].join(' ');

// Recruiter terminology is rarely literal. These groups are deliberately
// evidence-based: terms in a group describe the same demonstrated competency,
// not merely a vaguely related topic.
const SKILL_EQUIVALENCE_GROUPS = [
  ['requirements definition', 'requirements gathering', 'requirements analysis', 'product requirements', 'prd', 'prds', 'product requirements document'],
  ['user needs analysis', 'user research', 'customer research', 'customer discovery', 'user discovery', 'needs assessment'],
  ['decision documentation', 'decision records', 'architecture decision records', 'technical documentation', 'prd', 'prds'],
  ['cross functional collaboration', 'cross functional coordination', 'cross functional leadership', 'stakeholder collaboration'],
  ['stakeholder communication', 'stakeholder management', 'stakeholder alignment', 'executive communication'],
  ['analytical reasoning', 'data driven decision making', 'data analysis', 'competitive analysis', 'business analysis'],
  ['delivery coordination', 'product delivery', 'delivery management', 'sprint planning', 'scrum master', 'agile scrum', 'release planning'],
  ['roadmap planning', 'product roadmap', 'roadmapping', 'roadmap prioritization', 'roadmap prioritisation'],
  ['product prioritization', 'product prioritisation', 'feature prioritization', 'feature prioritisation', 'backlog prioritization', 'backlog prioritisation'],
  ['go to market strategy', 'go to market', 'gtm strategy', 'product launch', 'market launch'],
  ['product strategy', 'portfolio product management', 'product vision'],
  ['people leadership', 'team leadership', 'engineering management', 'cross functional leadership']
];

function text(value) {
  return String(value || '').trim();
}

function normalizeTerm(value) {
  return text(value)
    .toLowerCase()
    .replace(/&/gu, ' and ')
    .replace(/0-to-1|0 to 1/gu, 'zero to one')
    .replace(/prioritisation/gu, 'prioritization')
    .replace(/prioritise/gu, 'prioritize')
    .replace(/cross[\s-]?functional/gu, 'cross functional')
    .replace(/go[\s-]?to[\s-]?market/gu, 'go to market')
    .replace(/[^a-z0-9+#.]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function list(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value).split(/[,;|\n]/u).map(text).filter(Boolean);
}

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = normalizeTerm(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mixedText(value, limit = 4000) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return text(value);
  try {
    return JSON.stringify(value).slice(0, limit);
  } catch (_) {
    return '';
  }
}

function matchingGroup(term) {
  const normalized = normalizeTerm(term);
  return SKILL_EQUIVALENCE_GROUPS.find((group) => group.some((item) => normalizeTerm(item) === normalized)) || null;
}

function termMatches(required, evidence) {
  const left = normalizeTerm(required);
  const right = normalizeTerm(evidence);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 5 && right.length >= 5 && (left.includes(right) || right.includes(left))) return true;
  const group = matchingGroup(left);
  return Boolean(group?.some((item) => {
    const alias = normalizeTerm(item);
    return alias === right || (alias.length >= 4 && right.includes(alias));
  }));
}

function buildCandidateMatchingProfile(candidate = {}) {
  const work = candidate.workExperience || {};
  const jobs = Array.isArray(work.jobHistory) ? work.jobHistory : [];
  const projects = Array.isArray(candidate.projects) ? candidate.projects : [];
  const explicitSkills = list(candidate.skills);
  const technologies = unique([
    ...jobs.flatMap((job) => list(job.technologies)),
    ...projects.flatMap((project) => list(project.technologies))
  ]);
  const companies = unique(jobs.map((job) => job.company).filter(Boolean));
  const positions = jobs.map((job) => text(job.position)).filter(Boolean);
  const evidenceItems = unique([
    ...explicitSkills,
    ...technologies,
    ...positions,
    ...list(work.keyAchievements),
    ...list(work.industryExperience),
    ...projects.flatMap((project) => [project.title, project.role, project.description, ...list(project.highlights)]),
    ...jobs.flatMap((job) => [job.responsibilities, job.impact]),
    ...(candidate.certifications || []).flatMap((item) => [item.name, item.description]),
    ...(candidate.awards || []).flatMap((item) => [item.title, item.description]),
    ...(candidate.publications || []).flatMap((item) => [item.title, item.description]),
    ...(candidate.volunteerWork || []).flatMap((item) => [item.role, item.description, item.impact]),
    ...(candidate.professionalMemberships || []).flatMap((item) => [item.role, item.description]),
    work.careerProgression,
    work.leadershipExperience,
    work.technicalDepth,
    candidate.aiAnalysis?.summary,
    ...list(candidate.aiAnalysis?.strengths)
  ].map(text).filter(Boolean));

  const profile = {
    id: String(candidate._id || candidate.id || ''),
    name: `${text(candidate.firstName)} ${text(candidate.lastName)}`.trim() || text(candidate.name),
    currentRole: text(candidate.position || candidate.currentPosition),
    location: text(candidate.location),
    education: text(candidate.education),
    totalYearsExp: Number(work.totalYearsExperience ?? candidate.totalYearsExp ?? candidate.experience) || 0,
    skills: unique([...explicitSkills, ...technologies]),
    technologies,
    companies,
    positions,
    jobHistory: jobs,
    careerSummary: text(work.experienceSummary),
    careerProgression: text(work.careerProgression),
    keyAchievements: list(work.keyAchievements),
    industries: list(work.industryExperience),
    leadershipExperience: text(work.leadershipExperience),
    technicalDepth: text(work.technicalDepth),
    aiSummary: text(candidate.aiAnalysis?.summary),
    aiStrengths: list(candidate.aiAnalysis?.strengths),
    educationHistory: Array.isArray(candidate.educationHistory) ? candidate.educationHistory : [],
    certifications: Array.isArray(candidate.certifications) ? candidate.certifications : [],
    projects,
    languages: Array.isArray(candidate.languages) ? candidate.languages : [],
    awards: Array.isArray(candidate.awards) ? candidate.awards : [],
    publications: Array.isArray(candidate.publications) ? candidate.publications : [],
    volunteerWork: Array.isArray(candidate.volunteerWork) ? candidate.volunteerWork : [],
    professionalMemberships: Array.isArray(candidate.professionalMemberships) ? candidate.professionalMemberships : [],
    portfolioLinks: candidate.portfolioLinks || {},
    additionalSections: candidate.additionalSections || {},
    fullCVData: candidate.fullCVData || {},
    evidenceItems
  };
  profile.profileText = buildProfileText(profile);
  profile.fingerprint = crypto.createHash('sha256').update(profile.profileText).digest('hex');
  return profile;
}

function buildProfileText(profile) {
  const sections = [];
  const add = (label, value) => {
    const rendered = Array.isArray(value) ? value.filter(Boolean).join('; ') : text(value);
    if (rendered) sections.push(`${label}: ${rendered}`);
  };
  add('Current role', profile.currentRole);
  add('Total experience', profile.totalYearsExp ? `${profile.totalYearsExp} years` : '');
  add('Skills and technologies', profile.skills);
  add('Career summary', profile.careerSummary);
  add('Career progression', profile.careerProgression);
  add('Industries', profile.industries);
  add('Leadership', profile.leadershipExperience);
  add('Technical depth', profile.technicalDepth);
  add('Key achievements', profile.keyAchievements);
  add('AI-analyzed summary', profile.aiSummary);
  add('AI-analyzed strengths', profile.aiStrengths);
  profile.jobHistory.forEach((job, index) => add(`Work history ${index + 1}`, [
    [job.position, job.company].filter(Boolean).join(' at '), job.duration,
    job.responsibilities, job.impact,
    list(job.technologies).length ? `Technologies: ${list(job.technologies).join(', ')}` : ''
  ]));
  profile.projects.forEach((project, index) => add(`Project ${index + 1}`, [
    project.title, project.role, project.description,
    ...list(project.highlights),
    list(project.technologies).length ? `Technologies: ${list(project.technologies).join(', ')}` : ''
  ]));
  add('Certifications', profile.certifications.map((item) => [item.name, item.issuingOrganization].filter(Boolean).join(' — ')));
  add('Education history', profile.educationHistory.map((item) => [item.degree, item.fieldOfStudy, item.institution].filter(Boolean).join(' — ')));
  add('Languages', profile.languages.map((item) => [item.language, item.proficiency].filter(Boolean).join(' — ')));
  add('Awards', profile.awards.map((item) => [item.title, item.issuer, item.description].filter(Boolean).join(' — ')));
  add('Publications', profile.publications.map((item) => [item.title, item.publication, item.description].filter(Boolean).join(' — ')));
  add('Volunteer experience', profile.volunteerWork.map((item) => [item.role, item.organization, item.description, item.impact].filter(Boolean).join(' — ')));
  add('Professional memberships', profile.professionalMemberships.map((item) => [item.role, item.organization, item.description].filter(Boolean).join(' — ')));
  add('Online presence', Object.values(profile.portfolioLinks || {}).flatMap((value) => Array.isArray(value) ? value : [value]));
  add('Additional analyzed sections', mixedText(profile.additionalSections));
  add('Complete analyzed CV data', mixedText(profile.fullCVData, 5000));
  return sections.join('\n').slice(0, 18000);
}

function assessSkillEvidence(requiredSkills, profile = {}) {
  const required = unique(list(requiredSkills));
  const evidence = unique([...(profile.skills || []), ...(profile.evidenceItems || [])]);
  const matchedSkills = [];
  const missingSkills = [];
  const evidenceBySkill = {};
  for (const skill of required) {
    const hit = evidence.find((item) => termMatches(skill, item));
    if (hit) {
      matchedSkills.push(normalizeTerm(skill));
      evidenceBySkill[normalizeTerm(skill)] = hit;
    } else {
      missingSkills.push(normalizeTerm(skill));
    }
  }
  return {
    matchedSkills,
    missingSkills,
    evidenceBySkill,
    matchPercentage: required.length ? Math.round((matchedSkills.length / required.length) * 100) : 100,
    totalRequired: required.length,
    totalMatched: matchedSkills.length
  };
}

function mergeProfileIntoMatch(match, candidate) {
  const profile = buildCandidateMatchingProfile(candidate);
  const completeness = Math.round(([
    profile.skills.length > 0,
    profile.jobHistory.length > 0,
    profile.totalYearsExp > 0,
    Boolean(profile.aiSummary),
    Boolean(profile.education || profile.educationHistory.length),
    profile.certifications.length > 0,
    profile.projects.length > 0,
    profile.keyAchievements.length > 0,
    Boolean(profile.leadershipExperience),
    Boolean(profile.careerProgression)
  ].filter(Boolean).length / 10) * 100);
  const metadata = {
    ...(match.metadata || {}),
    candidateId: profile.id,
    firstName: text(candidate.firstName),
    lastName: text(candidate.lastName),
    name: profile.name,
    email: text(candidate.email),
    phone: text(candidate.phone),
    position: profile.currentRole,
    currentPosition: profile.currentRole,
    experience: candidate.experience || profile.totalYearsExp,
    totalYearsExp: profile.totalYearsExp,
    skills: profile.skills,
    location: profile.location,
    education: profile.education,
    status: text(candidate.status),
    careerProgression: profile.careerProgression,
    keyAchievements: profile.keyAchievements,
    industryExp: profile.industries,
    hasLeadershipExp: Boolean(profile.leadershipExperience),
    technicalDepth: profile.technicalDepth,
    companiesWorkedAt: profile.companies,
    positionsHeld: profile.positions,
    technologiesUsed: profile.technologies,
    aiSummary: profile.aiSummary,
    aiStrengths: profile.aiStrengths,
    hasAIAnalysis: Boolean(profile.aiSummary),
    hasDetailedWorkHistory: profile.jobHistory.length > 0,
    dataCompleteness: completeness
  };
  Object.defineProperty(metadata, '_matchingProfile', { value: profile, enumerable: false });
  return {
    ...match,
    metadata,
    candidate: {
      ...(match.candidate || {}),
      _id: profile.id,
      id: profile.id,
      name: profile.name,
      firstName: text(candidate.firstName),
      lastName: text(candidate.lastName),
      email: text(candidate.email),
      phone: text(candidate.phone),
      position: profile.currentRole,
      experience: profile.totalYearsExp,
      skills: profile.skills,
      location: profile.location,
      education: profile.education,
      status: text(candidate.status),
      aiAnalysis: candidate.aiAnalysis || null
    }
  };
}

module.exports = {
  MATCHING_CANDIDATE_PROJECTION,
  assessSkillEvidence,
  buildCandidateMatchingProfile,
  mergeProfileIntoMatch,
  normalizeTerm,
  termMatches
};
