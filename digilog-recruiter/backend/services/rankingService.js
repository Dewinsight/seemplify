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

      const relevanceScore = this.calculateRelevanceScore(explanation);
      return { ...candidate, relevanceScore };
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
}

module.exports = new RankingService();