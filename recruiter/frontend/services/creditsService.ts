import { apiRequest } from './apiConfig';

export interface CreditStatus {
  totalCredits: number;
  usedCredits: number;
  remainingCredits: number;
  percentageUsed: number;
  cycleStart: string;
  cycleEnd: string;
  daysUntilReset: number;
  rolloverCredits: number;
  purchasedCredits: number;
  creditCosts: {
    createJob: number;
    uploadCandidate: number;
    scheduleInterview: number;
    aiMatching: number;
    generateQuestions: number;
    aiAnalysis: number;
    bulkUpload: number;
    reEmbed: number;
  };
  usageBreakdown: {
    [action: string]: {
      count: number;
      credits: number;
    };
  };
  projectedRunout: string | null;
  warnings: {
    lowCredit: boolean;
    nearCycleEnd: boolean;
    projectedOverage: boolean;
  };
}

export interface CreditTransaction {
  action: string;
  credits: number;
  entityId?: string;
  entityType?: string;
  performedBy?: string;
  timestamp: string;
  balanceAfter: number;
  metadata?: any;
}

export interface CreditPack {
  id: string;
  name: string;
  credits: number;
  price: number;
  currency: string;
  pricePerCredit: number;
  savings: number;
  bestFor: string;
  popular?: boolean;
}

/**
 * Get current credit status for the organization
 */
export const getCreditStatus = async (): Promise<{ success: boolean; credits: CreditStatus }> => {
  const response = await apiRequest('/api/credits/status');
  if (!response.ok) {
    throw new Error('Failed to get credit status');
  }
  return await response.json();
};

/**
 * Get credit transaction history
 */
export const getCreditTransactions = async (filters: {
  action?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
} = {}): Promise<{ success: boolean; transactions: CreditTransaction[]; count: number }> => {
  const params = new URLSearchParams();
  if (filters.action) params.append('action', filters.action);
  if (filters.startDate) params.append('startDate', filters.startDate);
  if (filters.endDate) params.append('endDate', filters.endDate);
  if (filters.limit) params.append('limit', filters.limit.toString());
  
  const response = await apiRequest(`/api/credits/transactions?${params.toString()}`);
  if (!response.ok) {
    throw new Error('Failed to get credit transactions');
  }
  return await response.json();
};

/**
 * Get credit usage analytics
 */
export const getCreditAnalytics = async (): Promise<{ success: boolean; analytics: any }> => {
  const response = await apiRequest('/api/credits/analytics');
  if (!response.ok) {
    throw new Error('Failed to get credit analytics');
  }
  return await response.json();
};

/**
 * Get available credit packs for purchase
 */
export const getCreditPacks = async (): Promise<{ success: boolean; packs: CreditPack[] }> => {
  try {
    const response = await apiRequest('/api/credit-packs');
    if (!response.ok) {
      throw new Error('Failed to get credit packs');
    }
    const data = await response.json();
    
    // Map the API response to match the expected CreditPack interface
    if (data.success && data.creditPacks) {
      const mappedPacks = data.creditPacks.map((pack: any) => ({
        id: pack._id,
        name: pack.name,
        credits: pack.totalCredits,
        price: pack.price,
        currency: pack.currency,
        pricePerCredit: parseFloat(pack.pricePerCredit),
        savings: pack.bonusCredits || 0,
        bestFor: pack.description || '',
        popular: pack.isPopular
      }));
      return { success: true, packs: mappedPacks };
    }
    
    return { success: false, packs: [] };
  } catch (error) {
    console.error('Error fetching credit packs:', error);
    return { success: false, packs: [] };
  }
};

/**
 * Purchase credits (create purchase request)
 */
export const purchaseCredits = async (packId: string, notes?: string): Promise<any> => {
  const response = await apiRequest('/api/credit-packs/purchase-request', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      creditPackId: packId,
      notes: notes || ''
    })
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.msg || 'Failed to create purchase request');
  }
  return await response.json();
};

export default {
  getCreditStatus,
  getCreditTransactions,
  getCreditAnalytics,
  getCreditPacks,
  purchaseCredits
};

