import { apiRequest } from './apiConfig';

export interface GrantStatus {
  status: string;
  hasGrantId: boolean;
  calendarConnected: boolean;
  lastGrantRefresh?: string;
  lastGrantExpiry?: string;
  lastGrantRevocation?: string;
}

export interface GrantVerification {
  valid: boolean;
  error?: string;
  requiresReauth?: boolean;
  temporaryError?: boolean;
  grantInfo?: any;
}

export interface GrantHistory {
  currentStatus: string;
  calendarConnected: boolean;
  lastRefresh?: string;
  lastExpiry?: string;
  lastRevocation?: string;
}

export interface GrantUsage {
  currentCount: number;
  maxAllowed: number;
  availableSlots: number;
  utilizationPercentage: number;
  atLimit: boolean;
  configured: boolean;
  accountCount: number;
}

class GrantService {
  private baseUrl = `/api/grant`;

  /**
   * Get the current user's grant status
   */
  async getGrantStatus(): Promise<GrantStatus> {
    try {
      const response = await apiRequest(`${this.baseUrl}/status`, {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error(`Failed to get grant status: ${response.statusText}`);
      }

      const data = await response.json();
      return data.status;
    } catch (error) {
      console.error('Error getting grant status:', error);
      throw error;
    }
  }

  async getGrantUsage(): Promise<GrantUsage> {
    const response = await apiRequest(`${this.baseUrl}/usage`, { method: 'GET' });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get calendar capacity');
    }

    return data.usage;
  }

  /**
   * Verify the current user's grant with the OAuth provider
   */
  async verifyGrant(): Promise<GrantVerification> {
    try {
      const response = await apiRequest(`${this.baseUrl}/verify`, {
        method: 'POST',
      });

      const data = await response.json();

      if (response.ok) {
        return {
          valid: true,
          grantInfo: data.grantInfo
        };
      } else {
        return {
          valid: false,
          error: data.error,
          requiresReauth: data.requiresReauth,
          temporaryError: data.temporaryError
        };
      }
    } catch (error) {
      console.error('Error verifying grant:', error);
      throw error;
    }
  }

  /**
   * Verify grant status dynamically with Nylas API
   * This checks if the grant actually exists in Nylas (not just in database)
   */
  async verifyGrantStatus(): Promise<{
    valid: boolean;
    status: string;
    message: string;
    requiresReconnection: boolean;
    calendarConnected: boolean;
    grantInfo?: any;
  }> {
    try {
      const response = await apiRequest('/api/nylas-grants/verify-status', {
        method: 'GET',
      });

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error verifying grant status:', error);
      throw error;
    }
  }

  /**
   * Generate a re-authentication URL
   * @param provider - OAuth provider (default: 'google')
   * @param forceAccountSelection - Force account selection to allow switching accounts
   */
  async generateReauthUrl(provider?: string, forceAccountSelection: boolean = false): Promise<string> {
    try {
      const response = await apiRequest(`${this.baseUrl}/reauth`, {
        method: 'POST',
        body: JSON.stringify({ provider, forceAccountSelection }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate re-authentication URL');
      }

      const data = await response.json();
      return data.authUrl;
    } catch (error) {
      console.error('Error generating reauth URL:', error);
      throw error;
    }
  }

  /**
   * Revoke the current user's grant
   */
  async revokeGrant(): Promise<{ cancelledInterviews: number }> {
    try {
      const response = await apiRequest(`${this.baseUrl}/revoke`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to revoke grant');
      }

      const data = await response.json();
      return { cancelledInterviews: data.cancelledInterviews };
    } catch (error) {
      console.error('Error revoking grant:', error);
      throw error;
    }
  }

  /**
   * Get grant verification history
   */
  async getGrantHistory(): Promise<GrantHistory> {
    try {
      const response = await apiRequest(`${this.baseUrl}/history`, {
        method: 'GET',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to get grant history');
      }

      const data = await response.json();
      return data.history;
    } catch (error) {
      console.error('Error getting grant history:', error);
      throw error;
    }
  }

  /**
   * Admin: Verify all user grants
   */
  async verifyAllGrants(): Promise<any> {
    try {
      const response = await apiRequest(`${this.baseUrl}/admin/verify-all`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to verify all grants');
      }

      const data = await response.json();
      return data.results;
    } catch (error) {
      console.error('Error verifying all grants:', error);
      throw error;
    }
  }

  /**
   * Admin: Force refresh a specific user's grant
   */
  async forceGrantRefresh(userId: string): Promise<any> {
    try {
      const response = await apiRequest(`${this.baseUrl}/admin/force-refresh/${userId}`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to force grant refresh');
      }

      const data = await response.json();
      return data.verification;
    } catch (error) {
      console.error('Error forcing grant refresh:', error);
      throw error;
    }
  }

  /**
   * Check if a grant error indicates need for re-authentication
   */
  static isGrantError(error: string): boolean {
    const grantErrorPatterns = [
      'grant may be expired',
      'grant may be invalid',
      'grant expired',
      'grant invalid',
      'grant not found',
      'invalid grant',
      'expired grant',
      'authorization failed',
      'access token expired',
      'refresh token expired'
    ];

    return grantErrorPatterns.some(pattern => 
      error.toLowerCase().includes(pattern)
    );
  }

  /**
   * Handle grant errors by showing appropriate UI
   */
  static async handleGrantError(error: string, showToast?: (message: string, type?: string) => void): Promise<void> {
    if (this.isGrantError(error)) {
      const message = 'Your calendar access has expired. Please reconnect your calendar to continue scheduling interviews.';
      
      if (showToast) {
        showToast(message, 'warning');
      } else {
        console.warn('Grant error detected:', message);
      }
      
      // You could also trigger a modal or redirect to calendar settings
      // window.location.href = '/settings/calendar?reauth=required';
    }
  }
}

export const grantService = new GrantService();

// Export static methods for easier access
export const isGrantError = GrantService.isGrantError;
export const handleGrantError = GrantService.handleGrantError; 
