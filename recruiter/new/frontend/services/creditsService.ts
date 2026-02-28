import { apiRequest } from './apiConfig';

export interface CreditStatus {
  totalCredits: number;
  usedCredits: number;
  remainingCredits: number;
  percentageUsed: number;
  percentageRemaining?: number;
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

const DEFAULT_CREDIT_COSTS = {
  createJob: 0,
  uploadCandidate: 0,
  scheduleInterview: 0,
  aiMatching: 0,
  generateQuestions: 0,
  aiAnalysis: 0,
  bulkUpload: 0,
  reEmbed: 0
};

const buildDefaultCreditStatus = (): CreditStatus => {
  const cycleStart = new Date();
  const cycleEnd = new Date(cycleStart.getTime() + 30 * 24 * 60 * 60 * 1000);

  return {
    totalCredits: 0,
    usedCredits: 0,
    remainingCredits: 0,
    percentageUsed: 0,
    cycleStart: cycleStart.toISOString(),
    cycleEnd: cycleEnd.toISOString(),
    daysUntilReset: 30,
    rolloverCredits: 0,
    purchasedCredits: 0,
    creditCosts: { ...DEFAULT_CREDIT_COSTS },
    usageBreakdown: {},
    projectedRunout: null,
    warnings: {
      lowCredit: false,
      nearCycleEnd: false,
      projectedOverage: false
    }
  };
};

const buildDefaultCreditAnalytics = () => {
  const periodStart = new Date();
  const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000);

  return {
    usageBreakdown: {},
    dailyUsage: [],
    avgDailyBurn: 0,
    topActions: [],
    efficiencyScore: 0,
    totalTransactions: 0,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString()
  };
};

const parseErrorPayload = async (response: Response): Promise<any> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const isMissingOrganizationContext = (response: Response, errorData: any): boolean => {
  const errorMessage = `${errorData?.error || errorData?.msg || errorData?.message || ''}`.toLowerCase();

  return response.status === 400 && (
    errorData?.requiresOrganizationSetup === true ||
    errorMessage.includes('organization context required') ||
    errorMessage.includes('no organization selected') ||
    errorMessage.includes('no current organization set') ||
    errorMessage.includes('must belong to an organization')
  );
};

/**
 * Get current credit status for the organization
 */
export const getCreditStatus = async (): Promise<{ success: boolean; credits: CreditStatus }> => {
  const response = await apiRequest('/api/credits/status');
  if (!response.ok) {
    const errorData = await parseErrorPayload(response);

    if (isMissingOrganizationContext(response, errorData)) {
      return {
        success: true,
        credits: buildDefaultCreditStatus()
      };
    }

    throw new Error(errorData?.error || errorData?.msg || errorData?.message || 'Failed to get credit status');
  }

  const data = await response.json();
  return {
    success: data?.success !== false,
    credits: data?.credits || buildDefaultCreditStatus()
  };
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
    const errorData = await parseErrorPayload(response);

    if (isMissingOrganizationContext(response, errorData)) {
      return {
        success: true,
        transactions: [],
        count: 0
      };
    }

    throw new Error(errorData?.error || errorData?.msg || errorData?.message || 'Failed to get credit transactions');
  }

  const data = await response.json();
  const transactions = Array.isArray(data?.transactions) ? data.transactions : [];
  return {
    success: data?.success !== false,
    transactions,
    count: typeof data?.count === 'number' ? data.count : transactions.length
  };
};

/**
 * Get credit usage analytics
 */
export const getCreditAnalytics = async (): Promise<{ success: boolean; analytics: any }> => {
  const response = await apiRequest('/api/credits/analytics');
  if (!response.ok) {
    const errorData = await parseErrorPayload(response);

    if (isMissingOrganizationContext(response, errorData)) {
      return {
        success: true,
        analytics: buildDefaultCreditAnalytics()
      };
    }

    throw new Error(errorData?.error || errorData?.msg || errorData?.message || 'Failed to get credit analytics');
  }

  const data = await response.json();
  return {
    success: data?.success !== false,
    analytics: data?.analytics || buildDefaultCreditAnalytics()
  };
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

