'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, Organization } from '@/types';
import { authApi } from '@/lib/api';
import { websocketService } from '@/lib/websocket';
import { isInvalidatedByCentralLogout, watchForCentralLogout } from '@/lib/centralSession';

interface AuthContextType {
  user: User | null;
  currentOrganization: Organization | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => Promise<void>;
  switchOrganization: (orgId: string) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [currentOrganization, setCurrentOrganization] = useState<Organization | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadUser = useCallback(async () => {
    try {
      // Check for access token in URL hash (from OIDC callback)
      if (typeof window !== 'undefined') {
        const hash = window.location.hash;
        if (hash.includes('access_token=')) {
          const token = hash.split('access_token=')[1]?.split('&')[0];
          if (token) {
            localStorage.setItem('accessToken', token);
            // Clear hash
            window.history.replaceState(null, '', window.location.pathname);
          }
        }
      }

      // Check if we have a token before making the request
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
      if (!token || isInvalidatedByCentralLogout(token)) {
        localStorage.removeItem('accessToken');
        setUser(null);
        setCurrentOrganization(null);
        setIsLoading(false);
        return;
      }

      const response = await authApi.getMe();
      setUser(response.user);

      // Set current organization
      if (response.currentOrganizationId && response.user.organizations) {
        const org = response.user.organizations.find(
          (o: Organization) => o.id === response.currentOrganizationId
        );
        setCurrentOrganization(org || response.user.organizations[0] || null);
      } else if (response.user.organizations?.length > 0) {
        setCurrentOrganization(response.user.organizations[0]);
      }
    } catch (error: any) {
      // Only log non-401 errors (401 is expected when not authenticated)
      if (error?.response?.status !== 401) {
        console.error('Failed to load user:', error);
      }
      setUser(null);
      setCurrentOrganization(null);
      // Clear invalid token
      if (typeof window !== 'undefined') {
        localStorage.removeItem('accessToken');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  useEffect(() => watchForCentralLogout(
    () => localStorage.getItem('accessToken'),
    () => {
      websocketService.disconnect();
      localStorage.removeItem('accessToken');
      setUser(null);
      setCurrentOrganization(null);
      window.location.href = '/login';
    }
  ), []);

  // WebSocket connection for real-time updates
  useEffect(() => {
    if (user?.id) {
      // Connect to WebSocket server
      websocketService.connect(user.id);
      
      // Handle membership changes - refresh user data
      const handleMembershipChanged = () => {
        console.log('🔄 Membership changed, refreshing user data...');
        loadUser();
      };
      
      websocketService.on('membership_changed', handleMembershipChanged);
      websocketService.on('claims_updated', handleMembershipChanged);
      
      // Cleanup on unmount or user change
      return () => {
        websocketService.off('membership_changed', handleMembershipChanged);
        websocketService.off('claims_updated', handleMembershipChanged);
        websocketService.disconnect();
      };
    }
  }, [user?.id, loadUser]);

  const login = () => {
    authApi.login();
  };

  const logout = async () => {
    // Disconnect WebSocket first
    websocketService.disconnect();
    
    // Clear local state immediately
    localStorage.removeItem('accessToken');
    setUser(null);
    setCurrentOrganization(null);
    
    // Redirect immediately (don't wait for API call)
    window.location.href = '/login';
    
    // Call logout API in background (fire and forget)
    try {
      await authApi.logout();
    } catch (error) {
      // Silently fail - we've already redirected
      console.error('Logout API error (ignored):', error);
    }
  };

  const switchOrganization = async (orgId: string) => {
    try {
      const response = await authApi.switchOrganization(orgId);
      if (response.success) {
        setCurrentOrganization(response.organization);
        // Reload the page to refresh all data
        window.location.reload();
      }
    } catch (error) {
      console.error('Switch organization error:', error);
      throw error;
    }
  };

  const refreshUser = async () => {
    await loadUser();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        currentOrganization,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        switchOrganization,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
