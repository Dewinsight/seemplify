const axios = require('axios');

class PerformanceIntegrationService {
  constructor() {
    this.performanceServiceUrl = process.env.PERFORMANCE_SERVICE_URL || 'http://localhost:5005';
    this.internalApiKey = process.env.INTERNAL_API_SECRET || 'internal-secret-key';
  }

  async getOKRScore(userId, quarter, year) {
    try {
      const response = await axios.get(`${this.performanceServiceUrl}/api/okrs/score`, {
        params: {
          userId,
          quarter,
          year
        },
        headers: {
          'X-Internal-API-Key': this.internalApiKey,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
    } catch (error) {
      console.error('Error fetching OKR score:', error.message);
      return {
        score: 0,
        totalObjectives: 0,
        completedObjectives: 0,
        quarter,
        year
      };
    }
  }

  async calculatePerformanceBonus(userId, baseVariablePay, quarter, year) {
    const okrData = await this.getOKRScore(userId, quarter, year);
    
    if (!okrData.score || okrData.score === 0) {
      return {
        eligible: false,
        bonusAmount: 0,
        okrScore: okrData.score,
        reason: 'No OKR score available'
      };
    }

    let bonusPercentage = 0;
    let reason = '';

    if (okrData.score >= 100) {
      bonusPercentage = 1.2; // 120% - Stretch bonus
      reason = 'Exceeded expectations (Stretch bonus)';
    } else if (okrData.score >= 80) {
      bonusPercentage = 1.0; // 100% - Full bonus
      reason = 'Met expectations';
    } else if (okrData.score >= 60) {
      bonusPercentage = 0.5; // 50% - Partial bonus
      reason = 'Partially met expectations';
    } else {
      bonusPercentage = 0; // No bonus
      reason = 'Did not meet minimum requirements';
    }

    const bonusAmount = Math.round(baseVariablePay * bonusPercentage);

    return {
      eligible: bonusPercentage > 0,
      bonusAmount,
      okrScore: okrData.score,
      bonusPercentage,
      reason,
      okrData
    };
  }

  async getQuarterlyPerformanceSummary(userId, year) {
    const quarters = [1, 2, 3, 4];
    const summary = [];

    for (const quarter of quarters) {
      const okrData = await this.getOKRScore(userId, quarter, year);
      summary.push({
        quarter,
        ...okrData
      });
    }

    return summary;
  }

  async getTopPerformers(organizationId, quarter, year, limit = 10) {
    try {
      const response = await axios.get(`${this.performanceServiceUrl}/api/okrs/top-performers`, {
        params: {
          organizationId,
          quarter,
          year,
          limit
        },
        headers: {
          'X-Internal-API-Key': this.internalApiKey,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
    } catch (error) {
      console.error('Error fetching top performers:', error.message);
      return [];
    }
  }
}

module.exports = PerformanceIntegrationService;