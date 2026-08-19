const { assessSkillEvidence, normalizeTerm } = require('./candidateMatchingProfileService');

class RankingService {
  constructor() {
    // Default weights, can be overridden for specific jobs
    this.defaultWeights = {
      vectorSimilarity: 0.5,
      skillsMatch: 0.3,
      experienceMatch: 0.15,
      locationMatch: 0.05,
    };
  }

  /**
   * Re-ranks a list of candidates based on a multi-factor relevance score.
   * @param {Array} candidates - The initial list of candidates from vector search.
   * @param {Object} job - The job object being matched against.
   * @param {Object} explanations - A map of candidateId to their detailed explanation.
   * @returns {Array} - The re-ranked list of candidates.
   */
  rerankCandidates(candidates, job, explanations) {
    const rankedCandidates = candidates.map(candidate => {
      const explanation = explanations[candidate.candidateId];
      if (!explanation) {
        // Assign a low score if explanation is missing
        return { ...candidate, relevanceScore: 0 };
      }

      const explanationScore = this.calculateRelevanceScore(explanation);
      // Deep mode must not downgrade a candidate when the optional LLM
      // analysis is unavailable. The quick-stage score is already grounded in
      // the canonical profile, calibrated semantic similarity, role, skills,
      // experience, and location. Legacy explanations add evidence, so retain
      // the stronger of the two deterministic assessments.
      const relevanceScore = Math.max(
        explanationScore,
        this.clamp(candidate.relevanceScore)
      );
      const updatedExplanation = {
        ...explanation,
        overallScore: Math.round(relevanceScore * 100),
        matchStrength: this.categorizeMatchStrength(relevanceScore)
      };
      explanations[candidate.candidateId] = updatedExplanation;
      return { ...candidate, relevanceScore, explanation: updatedExplanation };
    });

    // Sort candidates by the new relevance score in descending order
    rankedCandidates.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return rankedCandidates;
  }

  /**
   * Calculates a weighted relevance score for a single candidate.
   * @param {Object} explanation - The detailed explanation object for a candidate.
   * @returns {Number} - The calculated relevance score (0-1).
   */
  calculateRelevanceScore(explanation) {
    const weights = this.defaultWeights; // Later, we can customize this per job

    // 1. Vector Similarity Score (normalized 0-1)
    const vectorScore = explanation.overallScore / 100;

    // 2. Skills Match Score (0-1)
    const skillsScore = explanation.skillsMatch.matchPercentage / 100;

    // 3. Experience Match Score (0-1)
    // Penalize for being under-experienced, reward for being over-experienced
    let experienceScore = 0;
    if (explanation.experienceMatch.isMatch) {
      // Reward for exceeding experience, capped at 20% bonus
      const bonus = Math.min(explanation.experienceMatch.difference * 0.05, 0.2);
      experienceScore = 1.0 + bonus;
    } else {
      // Penalize based on how many years they are short
      experienceScore = Math.max(0, 1 - Math.abs(explanation.experienceMatch.difference) * 0.25);
    }


    // 4. Location Match Score (0 or 1)
    const locationScore = explanation.locationMatch.isMatch ? 1 : 0;

    // Calculate the weighted average
    const totalScore =
      vectorScore * weights.vectorSimilarity +
      skillsScore * weights.skillsMatch +
      experienceScore * weights.experienceMatch +
      locationScore * weights.locationMatch;
    
    const totalWeight = 
        weights.vectorSimilarity + 
        weights.skillsMatch + 
        weights.experienceMatch + 
        weights.locationMatch;

    return totalScore / totalWeight;
  }

  /**
   * Fast, deterministic second-stage ranking for the quick matching mode.
   * Vector similarity remains the dominant signal while explicit job
   * constraints provide a small, explainable correction without an LLM call.
   */
  rerankQuickCandidates(candidates, job = {}) {
    const jobSkills = this.normalizeSkills(job.skills);
    const requiredYears = this.minimumYears(job.experience);
    const jobLocation = this.normalizeText(job.location);
    const remoteAllowed = job.remote === true || /remote|hybrid/.test(jobLocation);

    return (Array.isArray(candidates) ? candidates : [])
      .map((candidate) => {
        const vectorScore = this.clamp(candidate.vectorSimilarity ?? candidate.similarity);
        const calibratedVectorScore = this.calibrateSemanticScore(vectorScore);
        const candidateSkills = this.normalizeSkills(candidate.metadata?.skills || candidate.candidate?.skills);
        const profile = candidate.metadata?._matchingProfile || {
          skills: candidateSkills,
          evidenceItems: candidateSkills
        };
        const skillEvidence = assessSkillEvidence(jobSkills, profile);
        const skillScore = jobSkills.length ? skillEvidence.matchPercentage / 100 : 1;
        const candidateYears = Number(
          candidate.metadata?.totalYearsExp
          ?? candidate.metadata?.experience
          ?? candidate.candidate?.experience
          ?? 0
        ) || 0;
        const experienceScore = requiredYears > 0
          ? this.clamp(candidateYears / requiredYears)
          : 1;
        const candidateLocation = this.normalizeText(candidate.metadata?.location || candidate.candidate?.location);
        const locationScore = !jobLocation || remoteAllowed
          ? 1
          : candidateLocation && (
            candidateLocation.includes(jobLocation)
            || jobLocation.includes(candidateLocation)
          ) ? 1 : 0;
        const roleScore = this.roleAlignment(job.title, [
          candidate.metadata?.position,
          candidate.candidate?.position,
          ...(profile.positions || [])
        ]);

        const relevanceScore = jobSkills.length
          ? (calibratedVectorScore * 0.27) + (skillScore * 0.38) + (experienceScore * 0.14) + (roleScore * 0.16) + (locationScore * 0.05)
          : (calibratedVectorScore * 0.55) + (experienceScore * 0.20) + (roleScore * 0.20) + (locationScore * 0.05);

        return {
          ...candidate,
          vectorSimilarity: vectorScore,
          relevanceScore: this.clamp(relevanceScore),
          quickSignals: {
            skillCoverage: skillScore,
            experienceFit: experienceScore,
            locationFit: locationScore,
            roleAlignment: roleScore,
            calibratedSemanticSimilarity: calibratedVectorScore,
            skillEvidence
          }
        };
      })
      .sort((left, right) => right.relevanceScore - left.relevanceScore);
  }

  normalizeText(value) {
    return String(value || '').trim().toLowerCase();
  }

  normalizeSkills(value) {
    const values = Array.isArray(value) ? value : String(value || '').split(/[,;|\n]/);
    return [...new Set(values.map((skill) => this.normalizeText(skill)).filter(Boolean))];
  }

  skillCoverage(requiredSkills, candidateSkills) {
    if (!requiredSkills.length) return 1;
    const matches = requiredSkills.filter((required) => candidateSkills.some((candidate) => (
      candidate === required
      || (
        required.length >= 3
        && candidate.length >= 3
        && (candidate.includes(required) || required.includes(candidate))
      )
    )));
    return matches.length / requiredSkills.length;
  }

  calibrateSemanticScore(value) {
    // Cosine scores from broad CV/job prose occupy a compressed range. Treat
    // them as retrieval confidence rather than a literal percentage.
    return this.clamp((this.clamp(value) - 0.18) / 0.62);
  }

  roleAlignment(jobTitle, candidateTitles) {
    const stopWords = new Set(['and', 'of', 'the', 'senior', 'junior', 'lead', 'head', 'principal', 'associate']);
    const tokens = (value) => normalizeTerm(value)
      .split(' ')
      .filter((token) => token.length > 2 && !stopWords.has(token));
    const required = new Set(tokens(jobTitle));
    if (!required.size) return 1;
    let best = 0;
    for (const title of candidateTitles || []) {
      const available = new Set(tokens(title));
      const overlap = [...required].filter((token) => available.has(token)).length / required.size;
      best = Math.max(best, overlap);
      if (best === 1) break;
    }
    return best;
  }

  minimumYears(value) {
    const match = String(value || '').match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
  }

  clamp(value) {
    return Math.min(1, Math.max(0, Number(value) || 0));
  }

  categorizeMatchStrength(score) {
    const value = this.clamp(score);
    if (value >= 0.9) return 'Excellent Match';
    if (value >= 0.8) return 'Strong Match';
    if (value >= 0.7) return 'Good Match';
    if (value >= 0.6) return 'Moderate Match';
    if (value >= 0.5) return 'Weak Match';
    return 'Poor Match';
  }
}

module.exports = new RankingService();
