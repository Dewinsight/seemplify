'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { authApi } from '@/lib/api';
import { websocketService } from '@/lib/websocket';

interface User {
  id: string;
  email: string;
  name: string;
  organizations?: Organization[];
  teams?: Team[];
  [key: string]: any;
}

interface Organization {
  id: string;
  name: string;
  role: string;
  [key: string]: any;
}

interface Team {
  id: string;
  name: string;
  organizationId: string;
  role: string;
  [key: string]: any;
}

interface AuthContextType {
  user: User | null;
  currentOrganization: Organization | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => Promise<void>;
  switchOrganization: (orgId: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  // Role-based access
  isHRAdmin: boolean;
  isManager: boolean;
  isTeamLead: boolean;
  role: string;
  roleDisplay: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Helper to extract token from URL hash
function extractTokenFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  
  const hash = window.location.hash;
  if (!hash || !hash.includes('access_token=')) return null;
  
  const params = new URLSearchParams(hash.substring(1));
  const token = params.get('access_token');
  
  if (token) {
    // Clear hash from URL immediately
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return token;
  }
  
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [currentOrganization, setCurrentOrganization] = useState<Organization | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const initRef = useRef(false);

  const loadUser = useCallback(async (token?: string) => {
    try {
      // Use provided token or check localStorage
      const accessToken = token || (typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null);
      
      if (!accessToken) {
        console.log('❌ No access token found');
        setUser(null);
        setCurrentOrganization(null);
        setIsLoading(false);
        return;
      }

      // Store token if provided (from OIDC callback)
      if (token && typeof window !== 'undefined') {
        localStorage.setItem('accessToken', token);
      }

      console.log('🔄 Fetching user info from /auth/me...');
      const response = await authApi.getMe();
      console.log('✅ User loaded:', response.user?.email);
      
      setUser(response.user);

      // Set current organization
      if (response.currentOrganizationId && response.user?.organizations) {
        const org = response.user.organizations.find(
          (o: Organization) => o.id === response.currentOrganizationId
        );
        setCurrentOrganization(org || response.user.organizations[0] || null);
      } else if (response.user?.organizations?.length > 0) {
        setCurrentOrganization(response.user.organizations[0]);
      }
    } catch (error: any) {
      console.error('❌ Failed to load user:', error?.response?.status, error?.message);
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
    // Prevent double initialization in React StrictMode
    if (initRef.current) return;
    initRef.current = true;

    const init = async () => {
      console.log('🚀 AuthContext initializing...');
      
      // First, check for token in URL hash (OIDC callback)
      const hashToken = extractTokenFromHash();
      
      if (hashToken) {
        console.log('🔑 Token found in URL hash');
        await loadUser(hashToken);
      } else {
        // No hash token, check localStorage
        await loadUser();
      }
    };

    init();
  }, [loadUser]);

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
    if (typeof window !== 'undefined') {
      localStorage.removeItem('accessToken');
    }
    setUser(null);
    setCurrentOrganization(null);
    
    // Redirect immediately (don't wait for API call)
    window.location.href = '/login';
    
    // Call logout API in background (fire and forget)
    try {
      await authApi.logout();
    } catch (error) {
      console.error('Logout API error (ignored):', error);
    }
  };

  const switchOrganization = async (orgId: string) => {
    try {
      const response = await authApi.switchOrganization(orgId);
      if (response.success) {
        setCurrentOrganization(response.organization);
        window.location.reload();
      }
    } catch (error) {
      console.error('Switch organization error:', error);
      throw error;
    }
  };

  const refreshUser = async () => {
    setIsLoading(true);
    await loadUser();
  };

  // Role determination logic
  const isHRAdmin = user?.organizations?.some(org =>
    org.id === currentOrganization?.id && ['owner', 'admin', 'hr_manager'].includes(org.role)
  ) || false;

  const isManager = user?.teams?.some(team =>
    team.organizationId === currentOrganization?.id && team.role === 'line_manager'
  ) || false;

  const isTeamLead = user?.teams?.some(team =>
    team.organizationId === currentOrganization?.id && team.role === 'team_lead'
  ) || false;

  const role = currentOrganization?.role || 'employee';
  const roleDisplay = role.replace(/_/g, ' ').split(' ').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');

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
        isHRAdmin,
        isManager,
        isTeamLead,
        role,
        roleDisplay,
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
