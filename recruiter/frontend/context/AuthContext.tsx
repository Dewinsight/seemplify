'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { setGlobalLogoutHandler, initializeInactivityTracking, cleanupInactivityTracking } from '@/services/apiConfig';
import { tokenManager } from '@/utils/tokenManager';
// Note: This import would create a circular dependency if used immediately, so we'll import dynamically

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null;
  login: (token: string, refreshToken: string, expiresIn?: string, skipRedirect?: boolean) => void;
  logout: () => void;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const router = useRouter();

  useEffect(() => {
    // Set global logout handler
    setGlobalLogoutHandler(logout);

    // Check if we're in the browser before accessing localStorage
    if (typeof window !== 'undefined') {
      try {
        const storedToken = localStorage.getItem('jwt');
        const storedRefresh = localStorage.getItem('refreshToken');
        if (storedToken && storedRefresh) {
          setToken(storedToken);
          setRefreshToken(storedRefresh);
          setIsAuthenticated(true);
          initializeInactivityTracking();
        }
      } catch (error) {
        console.error('Error accessing localStorage:', error);
      }
    }
    setIsLoading(false);

    // Cleanup on unmount
    return () => {
      cleanupInactivityTracking();
    };
  }, []);

  const login = (newToken: string, newRefreshToken: string, expiresIn: string = '10m', skipRedirect: boolean = false) => {
    if (typeof window !== 'undefined') {
      try {
        // Initialize token manager
        tokenManager.initialize(newToken, newRefreshToken, expiresIn);

        setToken(newToken);
        setRefreshToken(newRefreshToken);
        setIsAuthenticated(true);

        // Initialize inactivity tracking after login
        initializeInactivityTracking();

        if (!skipRedirect) {
          console.log('🔄 AuthContext: Redirecting to organization check');
          window.location.href = '/organization/check';
        }
      } catch (error) {
        console.error('Error saving to localStorage:', error);
      }
    }
  };

  const logout = (silent: boolean = false) => {
    if (typeof window !== 'undefined') {
      try {
        // Cleanup inactivity tracking before logout
        cleanupInactivityTracking();

        // Clear tokens from manager
        tokenManager.clearTokens();

        // Clear dev environment cookies (set by backend for dev/deployed environments)
        // These must be cleared with the same domain they were set with
        const hostname = window.location.hostname;
        const isDevDeployed = hostname.includes('-dev') && hostname.includes('seemplifyai.com');

        if (isDevDeployed) {
          // Dev deployed environment uses domain cookies
          document.cookie = 'dev_jwt=; Max-Age=0; path=/; domain=.seemplifyai.com';
          document.cookie = 'dev_refreshToken=; Max-Age=0; path=/; domain=.seemplifyai.com';
          document.cookie = 'dev_expiresIn=; Max-Age=0; path=/; domain=.seemplifyai.com';
        } else {
          // Localhost or other environments
          document.cookie = 'dev_jwt=; Max-Age=0; path=/';
          document.cookie = 'dev_refreshToken=; Max-Age=0; path=/';
          document.cookie = 'dev_expiresIn=; Max-Age=0; path=/';
        }

        // Clear state
        setToken(null);
        setRefreshToken(null);
        setIsAuthenticated(false);

        // Clear any remaining cached data
        localStorage.removeItem('lastSelectedOrg');
        sessionStorage.clear();

        // Try to reset organization state (without creating import cycle)
        try {
          // This is a workaround to avoid circular imports
          // We dispatch a custom event that OrganizationContext will listen for
          const resetEvent = new CustomEvent('resetOrganizationState');
          window.dispatchEvent(resetEvent);
        } catch (e) {
          console.warn('Could not reset organization state:', e);
        }

        if (!silent) {
          // Hard refresh to ensure all React state is cleared between users
          window.location.href = '/login';
        }
      } catch (error) {
        console.error('Error during logout:', error);
      }
    }
  };

  const refreshSession = async () => {
    if (!refreshToken) {
      logout();
      return;
    }

    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || window.location.origin;
      const response = await fetch(`${baseUrl}/api/auth/refresh-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        throw new Error('Failed to refresh session');
      }

      const data = await response.json();
      login(data.token, data.refreshToken, data.expiresIn);
    } catch (error) {
      console.error('Session refresh failed:', error);
      logout();
    }
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, token, login, logout, refreshSession }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};