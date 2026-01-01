import { apiRequest } from '@/services/apiConfig';

interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresIn: string; // e.g., '10m'
  expiresAt?: number; // timestamp when token expires
}

class TokenManager {
  private refreshTimer: NodeJS.Timeout | null = null;
  private tokenData: TokenData | null = null;
  private refreshPromise: Promise<TokenData | null> | null = null;

  /**
   * Parse expiry time string (e.g., '10m', '1h', '7d') to milliseconds
   */
  private parseExpiryTime(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)([mhd])$/);
    if (!match) {
      // Default to 10 minutes if invalid format
      return 10 * 60 * 1000;
    }

    const [, value, unit] = match;
    const num = parseInt(value, 10);

    switch (unit) {
      case 'm': return num * 60 * 1000; // minutes
      case 'h': return num * 60 * 60 * 1000; // hours
      case 'd': return num * 24 * 60 * 60 * 1000; // days
      default: return 10 * 60 * 1000; // default 10 minutes
    }
  }

  /**
   * Initialize token manager with tokens
   */
  initialize(accessToken: string, refreshToken: string, expiresIn: string = '10m') {
    const expiryMs = this.parseExpiryTime(expiresIn);
    const expiresAt = Date.now() + expiryMs;

    this.tokenData = {
      accessToken,
      refreshToken,
      expiresIn,
      expiresAt
    };

    // Store tokens
    if (typeof window !== 'undefined') {
      localStorage.setItem('jwt', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
      localStorage.setItem('tokenExpiresAt', expiresAt.toString());
    }

    // Schedule automatic refresh before expiry (80% of token lifetime)
    this.scheduleRefresh(expiryMs * 0.8);
  }

  /**
   * Get current access token
   */
  getAccessToken(): string | null {
    if (typeof window === 'undefined') return null;
    
    // Check if token is expired
    const expiresAt = localStorage.getItem('tokenExpiresAt');
    if (expiresAt && parseInt(expiresAt) < Date.now()) {
      // Token expired, trigger refresh
      this.refreshTokens();
      return null;
    }

    return localStorage.getItem('jwt');
  }

  /**
   * Get current refresh token
   */
  getRefreshToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('refreshToken');
  }

  /**
   * Check if token needs refresh
   */
  needsRefresh(): boolean {
    if (typeof window === 'undefined') return false;
    
    const expiresAt = localStorage.getItem('tokenExpiresAt');
    if (!expiresAt) return true;

    const expiryTime = parseInt(expiresAt);
    const now = Date.now();
    const timeUntilExpiry = expiryTime - now;

    // Refresh if less than 2 minutes remaining
    return timeUntilExpiry < 2 * 60 * 1000;
  }

  /**
   * Schedule automatic token refresh
   */
  private scheduleRefresh(delayMs: number) {
    // Clear existing timer
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      console.log('⏰ Scheduled token refresh triggered');
      this.refreshTokens();
    }, delayMs);
  }

  /**
   * Refresh tokens
   */
  async refreshTokens(): Promise<TokenData | null> {
    // If already refreshing, return existing promise
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      console.error('No refresh token available');
      return null;
    }

    this.refreshPromise = this.doRefresh(refreshToken);
    
    try {
      const result = await this.refreshPromise;
      return result;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Perform the actual token refresh
   */
  private async doRefresh(refreshToken: string): Promise<TokenData | null> {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || ''}/api/auth/refresh-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('Token refresh failed:', error);
        
        // If refresh failed, clear tokens and force re-login
        this.clearTokens();
        window.location.href = '/login';
        return null;
      }

      const data = await response.json();
      
      // Update tokens
      this.initialize(data.token, data.refreshToken, data.expiresIn);
      
      console.log('✅ Token refreshed successfully');
      return {
        accessToken: data.token,
        refreshToken: data.refreshToken,
        expiresIn: data.expiresIn
      };
    } catch (error) {
      console.error('Token refresh error:', error);
      this.clearTokens();
      window.location.href = '/login';
      return null;
    }
  }

  /**
   * Clear all tokens
   */
  clearTokens() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    if (typeof window !== 'undefined') {
      localStorage.removeItem('jwt');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('tokenExpiresAt');
    }

    this.tokenData = null;
    this.refreshPromise = null;
  }

  /**
   * Get time until token expires (in seconds)
   */
  getTimeUntilExpiry(): number {
    if (typeof window === 'undefined') return 0;
    
    const expiresAt = localStorage.getItem('tokenExpiresAt');
    if (!expiresAt) return 0;

    const timeRemaining = parseInt(expiresAt) - Date.now();
    return Math.max(0, Math.floor(timeRemaining / 1000));
  }
}

// Singleton instance
export const tokenManager = new TokenManager();
