'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { handleAuthCallback as extractToken, isAuthenticated as checkToken } from '@/lib/api';

// Types based on IdP organization roles
export type OrganizationRole = 'owner' | 'admin' | 'hr_manager' | 'recruiter' | 'interviewer' | 'member';
export type TeamRole = 'member' | 'line_manager' | 'team_lead';

export interface Organization {
  id: string;
  name: string;
  role: OrganizationRole;
  isActive?: boolean;
  isCurrent?: boolean;
}

export interface Team {
  id: string;
  name: string;
  role: TeamRole;
  isManager?: boolean;
  directReports?: string[];
  isActive?: boolean;
}

export interface User {
  id: string;
  sub?: string;
  name: string;
  email: string;
  organizations: Organization[];
  teams: Team[];
  team_permissions?: any[];
  roles?: string[];
  currentOrganization?: Organization;
  userinfo?: any;
}

interface AuthContextType {
  user: User | null;
  currentOrganization: Organization | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  
  // Role helpers - based on IdP organization roles
  isHRAdmin: boolean;        // owner, admin, hr_manager
  isRecruiter: boolean;      // recruiter role
  isManager: boolean;        // line_manager in any team
  isTeamLead: boolean;       // team_lead in any team
  isEmployee: boolean;       // regular member
  
  // Actions
  login: () => void;
  logout: () => Promise<void>;
  switchOrganization: (orgId: string) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Determine if user has HR Admin privileges based on org role
function checkIsHRAdmin(user: User | null, currentOrg: Organization | null): boolean {
  if (!user || !currentOrg) return false;
  // HR Admin = owner, admin, or hr_manager role in the organization
  return ['owner', 'admin', 'hr_manager'].includes(currentOrg.role);
}

// Determine if user is a recruiter
function checkIsRecruiter(user: User | null, currentOrg: Organization | null): boolean {
  if (!user || !currentOrg) return false;
  return currentOrg.role === 'recruiter';
}

// Check if user is a manager in any team
function checkIsManager(user: User | null): boolean {
  if (!user?.teams) return false;
  return user.teams.some(t => t.role === 'line_manager' || t.isManager);
}

// Check if user is a team lead in any team
function checkIsTeamLead(user: User | null): boolean {
  if (!user?.teams) return false;
  return user.teams.some(t => t.role === 'team_lead');
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [currentOrganization, setCurrentOrganization] = useState<Organization | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadUser = useCallback(async () => {
    try {
      // Check for access token in URL hash (from OIDC callback)
      if (typeof window !== 'undefined') {
        extractToken();
      }

      // Check if we have a token
      const hasToken = checkToken();
      if (!hasToken) {
        setUser(null);
        setCurrentOrganization(null);
        setIsLoading(false);
        return;
      }

      // Fetch user info from backend
      const response = await api.get('/auth/me');
      const userData = response.data.user;
      setUser(userData);

      // Set current organization
      if (response.data.currentOrganizationId && userData.organizations) {
        const org = userData.organizations.find(
          (o: Organization) => o.id === response.data.currentOrganizationId
        );
        if (org) {
          setCurrentOrganization({ ...org, isCurrent: true });
        } else if (userData.organizations.length > 0) {
          setCurrentOrganization({ ...userData.organizations[0], isCurrent: true });
        }
      } else if (userData.organizations?.length > 0) {
        setCurrentOrganization({ ...userData.organizations[0], isCurrent: true });
      }
    } catch (error: any) {
      // Only log non-401 errors
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

  const login = () => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5006';
    const returnTo = encodeURIComponent(typeof window !== 'undefined' ? window.location.origin : '');
    window.location.href = `${apiUrl}/api/auth/oidc/start?returnTo=${returnTo}`;
  };

  const logout = async () => {
    // Clear local state immediately
    localStorage.removeItem('accessToken');
    setUser(null);
    setCurrentOrganization(null);

    // Redirect immediately
    window.location.href = '/login';

    // Call logout API in background
    try {
      await api.post('/auth/logout');
    } catch (error) {
      console.error('Logout API error (ignored):', error);
    }
  };

  const switchOrganization = async (orgId: string) => {
    try {
      await api.post('/auth/switch-organization', { organizationId: orgId });
      // Reload to refresh all data
      window.location.reload();
    } catch (error) {
      console.error('Failed to switch organization:', error);
      throw error;
    }
  };

  const refreshUser = async () => {
    await loadUser();
  };

  // Compute role flags
  const isHRAdmin = checkIsHRAdmin(user, currentOrganization);
  const isRecruiter = checkIsRecruiter(user, currentOrganization);
  const isManager = checkIsManager(user);
  const isTeamLead = checkIsTeamLead(user);
  const isEmployee = !!user && !isHRAdmin && !isRecruiter; // Everyone else is an employee

  const value: AuthContextType = {
    user,
    currentOrganization,
    isLoading,
    isAuthenticated: !!user,
    isHRAdmin,
    isRecruiter,
    isManager,
    isTeamLead,
    isEmployee,
    login,
    logout,
    switchOrganization,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Hook to check if current user can access HR admin features
export function useHRAdminAccess() {
  const { isHRAdmin, isLoading } = useAuth();
  return { hasAccess: isHRAdmin, isLoading };
}

// Hook to get user's payroll role
export function usePayrollRole() {
  const { user, currentOrganization, isHRAdmin, isManager, isTeamLead } = useAuth();
  
  if (isHRAdmin) return 'hr_admin';
  if (isManager) return 'line_manager';
  if (isTeamLead) return 'team_lead';
  return 'employee';
}


