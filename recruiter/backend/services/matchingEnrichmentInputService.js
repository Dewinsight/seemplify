const mongoose = require('mongoose');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const embeddingService = require('./embeddingService');

const MAX_ENRICHMENT_CANDIDATES = 5000;

function candidateIdFromMatch(match = {}) {
  return match.candidateId || match.candidate?._id || match.candidate?.id || null;
}

function inputError(message, { code = 'ENRICHMENT_INPUT_INVALID', statusCode = 400 } = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function uniqueSubmittedCandidateIds(matches) {
  if (!Array.isArray(matches) || !matches.length) {
    throw inputError('matches array is required and cannot be empty');
  }
  if (matches.length > MAX_ENRICHMENT_CANDIDATES) {
    throw inputError(`matches cannot contain more than ${MAX_ENRICHMENT_CANDIDATES} candidates`);
  }

  const ids = [];
  const seen = new Set();
  for (const match of matches) {
    const rawId = candidateIdFromMatch(match);
    if (!rawId || !mongoose.isValidObjectId(rawId)) {
      throw inputError('One or more submitted candidates are unavailable');
    }
    const id = String(rawId);
    if (!seen.has(id)) {
      ids.push(id);
      seen.add(id);
    }
  }
  return ids;
}

function authoritativeMatch(vectorMatch, candidate) {
  const id = String(candidate._id);
  const name = `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim();
  return {
    candidateId: id,
    similarity: Number(vectorMatch.similarity ?? vectorMatch.relevanceScore ?? 0) || 0,
    relevanceScore: Number(vectorMatch.similarity ?? vectorMatch.relevanceScore ?? 0) || 0,
    metadata: {
      ...(vectorMatch.metadata || {}),
      candidateId: id,
      firstName: candidate.firstName || '',
      lastName: candidate.lastName || '',
      name,
      email: candidate.email || '',
      phone: candidate.phone || '',
      position: candidate.position || '',
      currentPosition: candidate.position || '',
      experience: candidate.experience || '',
      totalYearsExp: candidate.workExperience?.totalYearsExperience || 0,
      skills: candidate.skills || [],
      education: candidate.education || '',
      location: candidate.location || '',
      status: candidate.status || '',
      aiSummary: candidate.aiAnalysis?.summary || ''
    },
    candidate: {
      _id: id,
      id,
      name,
      firstName: candidate.firstName || '',
      lastName: candidate.lastName || '',
      email: candidate.email || '',
      phone: candidate.phone || '',
      position: candidate.position || '',
      experience: candidate.experience || '',
      skills: candidate.skills || [],
      education: candidate.education || '',
      location: candidate.location || '',
      status: candidate.status || '',
      aiAnalysis: candidate.aiAnalysis || null
    }
  };
}

function selectAuthoritativeMatches(vectorMatches, candidates, submittedIds) {
  const requested = new Set(submittedIds.map(String));
  const candidatesById = new Map((candidates || []).map((candidate) => [String(candidate._id), candidate]));
  const selected = [];
  const seen = new Set();
  for (const vectorMatch of vectorMatches || []) {
    const id = String(candidateIdFromMatch(vectorMatch) || '');
    if (!id || seen.has(id) || !requested.has(id) || !candidatesById.has(id)) continue;
    selected.push(authoritativeMatch(vectorMatch, candidatesById.get(id)));
    seen.add(id);
  }
  return selected;
}

class MatchingEnrichmentInputService {
  constructor({ JobModel = Job, CandidateModel = Candidate, EmbeddingService = embeddingService } = {}) {
    this.Job = JobModel;
    this.Candidate = CandidateModel;
    this.embeddingService = EmbeddingService;
  }

  async getScopedJob(jobId, organizationId) {
    if (!organizationId) throw inputError('Organization context is required', { code: 'ORGANIZATION_CONTEXT_REQUIRED' });
    const job = await this.Job.findOne({ _id: jobId, organization: organizationId });
    if (!job) throw inputError('Job not found', { code: 'JOB_NOT_FOUND', statusCode: 404 });
    return job;
  }

  async load({ jobId, organizationId, matches, enrichCount }) {
    const job = await this.getScopedJob(jobId, organizationId);
    const submittedIds = uniqueSubmittedCandidateIds(matches);
    const selectedCount = Math.min(Math.max(Number.parseInt(enrichCount, 10) || 1, 1), submittedIds.length);

    const [vectorResult, candidates] = await Promise.all([
      this.embeddingService.findMatchingCandidatesForJob(job, submittedIds.length, { skipCache: true }),
      this.Candidate.find({
        _id: { $in: submittedIds },
        organization: organizationId,
        publicApplicationCommitState: { $nin: ['provisional', 'committing'] },
        deletionState: { $ne: 'tombstoned' }
      }).select(
        '_id firstName lastName email phone position experience skills education location status '
        + 'workExperience.totalYearsExperience aiAnalysis.summary'
      ).lean()
    ]);

    const vectorMatches = Array.isArray(vectorResult) ? vectorResult : (vectorResult?.matches || []);
    const authoritativeMatches = selectAuthoritativeMatches(vectorMatches, candidates, submittedIds);
    if (authoritativeMatches.length < selectedCount) {
      throw inputError('One or more submitted candidates are unavailable for this job', {
        code: 'ENRICHMENT_CANDIDATE_SCOPE_MISMATCH',
        statusCode: 409
      });
    }

    return {
      job,
      matches: authoritativeMatches,
      selectedCount,
      submittedCount: submittedIds.length
    };
  }
}

const service = new MatchingEnrichmentInputService();

module.exports = service;
module.exports.MatchingEnrichmentInputService = MatchingEnrichmentInputService;
module.exports.MAX_ENRICHMENT_CANDIDATES = MAX_ENRICHMENT_CANDIDATES;
module.exports.candidateIdFromMatch = candidateIdFromMatch;
module.exports.selectAuthoritativeMatches = selectAuthoritativeMatches;
module.exports.uniqueSubmittedCandidateIds = uniqueSubmittedCandidateIds;
