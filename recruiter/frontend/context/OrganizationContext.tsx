'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import organizationService, { PendingInvitation, UserPendingInvitation } from '@/services/organizationService';

// Roles that are NOT allowed to access Recruiter
const BLOCKED_ROLES = ['staff'];

interface Organization {
  _id: string;
  name: string;
  description?: string;
  industry?: string;
  size?: string;
  website?: string;
  logo?: string;
  userRole: string;
  joinedAt: Date;
  members: OrganizationMember[];
  memberCount?: number;
  settings: OrganizationSettings;
  subscription?: {
    plan: string;
    planName?: string;
    memberLimit: number;
    features?: any[];
    price?: number;
    currency?: string;
    billingCycle?: string;
  };
}

interface OrganizationMember {
  _id: string;
  user: {
    _id: string;
    profile: {
      firstName: string;
      lastName: string;
    };
    email: string;
  };
  role: string;
  joinedAt: Date;
  status: string;
}

interface OrganizationSettings {
  allowPublicJobApplications: boolean;
  requireApprovalForNewMembers: boolean;
  defaultCandidateStatus: string;
}

interface OrganizationLimits {
  userPlan: string;
  maxOrganizations: number | 'unlimited';
  currentCount: number;
  canCreateMore: boolean;
  remainingSlots: number | 'unlimited';
}

interface OrganizationContextType {
  currentOrganization: Organization | null;
  organizations: Organization[];
  isLoading: boolean;
  error: string | null;
  needsOrganizationSetup: boolean;
  organizationLimits: OrganizationLimits | null;
  hasInitialized: boolean;
  
  // Actions
  createOrganization: (data: Partial<Organization>) => Promise<void>;
  switchOrganization: (organizationId: string) => Promise<void>;
  updateOrganization: (data: Partial<Organization>) => Promise<void>;
  deleteOrganization: (organizationId: string) => Promise<void>;
  inviteUser: (email: string, role: string) => Promise<{ inviteLink: string }>;
  loadOrganizations: () => Promise<void>;
  forceRefresh: () => Promise<void>;
  getOrganizationLimits: () => Promise<void>;
  acceptInvite: (token: string) => Promise<{ organization: Organization; }>;
  removeMember: (memberId: string) => Promise<void>;
  updateMemberRole: (memberId: string, role: string) => Promise<void>;
  leaveOrganization: () => Promise<void>;
  transferOwnership: (newOwnerId: string) => Promise<void>;
  getPendingInvitations: () => Promise<{ pendingInvites: PendingInvitation[]; count: number }>;
  getUserPendingInvitations: () => Promise<{ pendingInvites: UserPendingInvitation[]; count: number }>;
  cancelInvitation: (inviteId: string) => Promise<void>;
  clearError: () => void;
  resetOrgState: () => void; // New method for resetting organization state
}

const OrganizationContext = createContext<OrganizationContextType | undefined>(undefined);

export const OrganizationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [currentOrganization, setCurrentOrganization] = useState<Organization | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsOrganizationSetup, setNeedsOrganizationSetup] = useState(false);
  const [organizationLimits, setOrganizationLimits] = useState<OrganizationLimits | null>(null);
  const [hasInitialized, setHasInitialized] = useState(false);
  
  // Check if we're on an admin route (SSR-safe)
  const isAdminRoute = pathname?.startsWith('/admin') || false;
  
  // ==========================================================================
  // STAFF ROLE INTERCEPTOR
  // Check if user's role in current organization is blocked from Recruiter
  // Only blocks if role is EXPLICITLY 'staff' - any other role (including undefined) is allowed
  // ==========================================================================
  const checkAndHandleBlockedRole = useCallback((org: Organization, allOrgs: Organization[]) => {
    // Debug logging to understand what's happening
    console.log('🔍 Checking role for org:', org?.name, '- userRole:', org?.userRole);
    
    // If no org or no userRole, allow access (don't block)
    if (!org) {
      console.log('✅ No org provided, allowing access');
      return false;
    }
    
    if (!org.userRole) {
      console.log('✅ No userRole on org, allowing access (role:', org.userRole, ')');
      return false;
    }
    
    const role = org.userRole.toLowerCase().trim();
    
    // Only block if role is explicitly 'staff'
    if (role === 'staff') {
      console.log('🚫 User has STAFF role in current organization');
      console.log('   Organization:', org.name);
      
      // Check if user has other organizations with non-blocked roles
      const otherOrgsWithAccess = allOrgs.filter(
        o => o._id !== org._id && o.userRole && o.userRole.toLowerCase().trim() !== 'staff'
      );
      const hasOtherOrgs = otherOrgsWithAccess.length > 0;
      
      console.log('   Other organizations with access:', 
        hasOtherOrgs ? otherOrgsWithAccess.map(o => `${o.name} (${o.userRole})`).join(', ') : 'None');
      
      // Build error URL params
      const hubUrl = process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000';
      const errorParams = new URLSearchParams({
        error: 'staff_role_denied',
        orgName: org.name || 'your current organization',
        hubUrl: hubUrl,
        hasOtherOrgs: hasOtherOrgs ? 'true' : 'false'
      });
      
      // Log out and redirect to login with error
      console.log('🚪 Logging out user due to STAFF role...');
      logout(true); // Silent logout (don't redirect immediately)
      
      // Redirect to login with error params
      window.location.href = `/login?${errorParams.toString()}`;
      return true; // Blocked
    }
    
    console.log('✅ Role is', role, '- allowing access');
    return false; // Not blocked
  }, [logout]);

  const clearError = () => setError(null);
  
  // Reset all organization state - used during logout
  const resetOrgState = () => {
    console.log('🧹 Resetting organization state');
    setOrganizations([]);
    setCurrentOrganization(null);
    setNeedsOrganizationSetup(false);
    setIsLoading(false);
    setHasInitialized(false);
    setError(null);
    setOrganizationLimits(null);
  };
  
  const forceRefresh = async () => {
    console.log('🔄 Force refresh triggered - reloading without clearing state');
    setError(null);
    // Don't clear organizations array to prevent setup modal flash
    // Only clear if we actually get no organizations from backend
    await loadOrganizations(true);
  };

  const loadOrganizations = async (forceRefresh = false) => {
    console.log('🔄 loadOrganizations called', {
      isAuthenticated,
      authLoading,
      hasToken: !!localStorage.getItem('jwt'),
      isAdminRoute,
      forceRefresh
    });
    
    // Clear cache if force refresh to ensure fresh data from backend
    if (forceRefresh) {
      organizationService.clearCache();
    }
    
    // Skip loading for admin routes
    if (isAdminRoute) {
      console.log('🚫 Admin route detected, skipping organization load');
      setIsLoading(false);
      return;
    }
    
    // Simple check - if we have a token, try to load
    const token = localStorage.getItem('jwt');
    if (!token) {
      console.log('🚫 No JWT token found, skipping organization load');
      setIsLoading(false);
      return;
    }
    
    try {
      console.log('🚀 Starting organization load');
      setIsLoading(true);
      setError(null);
      
      console.log('📡 Calling organizationService.getUserOrganizations()');
      const orgs = await organizationService.getUserOrganizations();
      console.log('📋 Organizations loaded:', orgs);
      
      if (!orgs || orgs.length === 0) {
        console.log('⚠️ No organizations found');
        setOrganizations([]);
        setCurrentOrganization(null);
        
        // Only trigger setup modal if this is the initial load, not during refresh/switching
        if (!hasInitialized || !forceRefresh) {
          console.log('🏢 Setting needsOrganizationSetup = true (initial load)');
          setNeedsOrganizationSetup(true);
        } else {
          console.log('🔄 Skipping setup modal during refresh/switch operation');
          setNeedsOrganizationSetup(false);
        }
      } else {
        console.log('✅ Organizations found:', orgs.length);
        setOrganizations(orgs);
        setNeedsOrganizationSetup(false);
        
        // IMPORTANT: Use the isCurrentOrganization flag from the IDP response
        // This is the source of truth for which org the user is currently in
        // (the separate getCurrentOrganization endpoint might have stale data)
        const currentOrgFromList = orgs.find((o: any) => o.isCurrentOrganization);
        console.log('🔍 Looking for current org in list:', orgs.map((o: any) => ({
          name: o.name,
          isCurrentOrganization: o.isCurrentOrganization,
          userRole: o.userRole
        })));
        
        if (currentOrgFromList) {
          console.log('✅ Found current org from IDP list:', {
            name: currentOrgFromList.name,
            userRole: currentOrgFromList.userRole,
            _id: currentOrgFromList._id
          });
          
          // IMPORTANT: Only check blocked role if we have a valid role value
          // If userRole is missing/undefined, DON'T block - let them through
          if (currentOrgFromList.userRole) {
            console.log('🔍 Checking if role is blocked:', currentOrgFromList.userRole);
            if (checkAndHandleBlockedRole(currentOrgFromList, orgs)) {
              return; // Exit early, user is being logged out
            }
          } else {
            console.log('⚠️ No userRole on current org, skipping block check');
          }
          
          setCurrentOrganization(currentOrgFromList);
        } else {
          // Fallback: try to get from backend API (might have stale currentOrg)
          console.log('⚠️ No isCurrentOrganization flag found, falling back to API...');
          try {
            const currentOrg = await organizationService.getCurrentOrganization();
            console.log('🏢 Current organization from API:', {
              name: currentOrg.name,
              userRole: currentOrg.userRole,
              _id: currentOrg._id
            });
            
            if (currentOrg.userRole) {
              if (checkAndHandleBlockedRole(currentOrg, orgs)) {
                return;
              }
            }
            
            setCurrentOrganization(currentOrg);
          } catch (currentOrgError) {
            console.warn('⚠️ Failed to get current organization, using first available:', currentOrgError);
            const fallbackOrg = orgs[0];
            
            if (fallbackOrg?.userRole) {
              if (checkAndHandleBlockedRole(fallbackOrg, orgs)) {
                return;
              }
            }
            
            setCurrentOrganization(fallbackOrg);
          }
        }
      }
      
      // Load organization limits if user has organizations
      if (orgs.length > 0) {
        await getOrganizationLimits();
      }
      
      setHasInitialized(true);
    } catch (err: any) {
      console.error('❌ Error loading organizations:', err);
      setError(err.message || 'Failed to load organizations');
      
      // If we get a 400 with requiresOrganizationSetup, set the flag (only on initial load)
      if ((err.message?.includes('Organization required') || err.requiresOrganizationSetup) && !forceRefresh) {
        console.log('🏢 Backend says organization setup required (initial load)');
        setNeedsOrganizationSetup(true);
        setOrganizations([]);
        setCurrentOrganization(null);
        // Still load limits to show what they can create
        await getOrganizationLimits();
      } else if (forceRefresh) {
        console.log('🔄 Error during force refresh - not showing setup modal');
        setNeedsOrganizationSetup(false);
      }
      
      setHasInitialized(true);
    } finally {
      console.log('🏁 loadOrganizations finished');
      setIsLoading(false);
    }
  };

  const createOrganization = async (data: Partial<Organization>) => {
    try {
      console.log('🏢 Creating organization:', data);
      setIsLoading(true);
      setError(null);

      const newOrg = await organizationService.createOrganization(data);
      console.log('📋 Organization creation response:', newOrg);

      // Ensure the new organization has all required fields for the UI
      const completeNewOrg = {
        ...newOrg,
        userRole: newOrg.userRole || 'owner',
        joinedAt: newOrg.joinedAt || new Date(),
        memberCount: (newOrg as any).memberCount || 1
      };

      // Add to organizations list and set as current
      setOrganizations(prev => [...prev, completeNewOrg]);
      setCurrentOrganization(completeNewOrg);
      setNeedsOrganizationSetup(false);

      console.log('📋 Added organization to state:', completeNewOrg.name, 'Role:', completeNewOrg.userRole);

      // Refresh organization limits after creating
      await getOrganizationLimits();

      console.log('✅ Organization created successfully:', newOrg.name);
    } catch (err: any) {
      console.error('❌ Error creating organization:', err);

      // Handle IdP-managed responses - redirect to IdP
      if (err.code === 'idp_managed' || err.code === 'idp_required') {
        console.log('🔗 Organization creation requires IdP, redirecting...');
        if (err.redirectUrl) {
          // Open IdP in new tab for organization creation
          window.open(err.redirectUrl, '_blank');
        }
        setError('Please create your organization in the Identity Provider. A new tab has been opened.');
        throw err;
      }

      // Handle IdP auth required
      if (err.code === 'idp_auth_required') {
        console.log('🔐 IdP authentication required');
        setError('Your Identity Provider session has expired. Please log in again.');
        throw err;
      }

      // Handle authentication errors differently
      if (err.message?.includes('Token has expired')) {
        setError('Your session has expired. Please log in again.');
      } else if (err.message?.includes('authorization denied') || err.message?.includes('Invalid token')) {
        setError('Authentication error. Please try logging in again.');
      } else if (err.message?.includes('organization limit')) {
        setError(err.message); // These are user-friendly limit messages
      } else {
        setError(err.message || 'Failed to create organization. Please try again.');
      }

      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  // Track when we last fetched organization limits to prevent frequent calls
  const limitsLastFetchedRef = React.useRef<number>(0);
  const LIMITS_CACHE_TIME = 60000; // 1 minute cache
  
  const getOrganizationLimits = async () => {
    try {
      const now = Date.now();
      if (now - limitsLastFetchedRef.current < LIMITS_CACHE_TIME && organizationLimits) {
        console.log('📊 Using cached organization limits (fetched less than 1 minute ago)');
        return;
      }
      
      console.log('📊 Getting organization limits...');
      const limits = await organizationService.getOrganizationLimits();
      setOrganizationLimits(limits);
      limitsLastFetchedRef.current = now;
      console.log('✅ Organization limits loaded:', limits);
    } catch (err: any) {
      console.error('❌ Error getting organization limits:', err);
      // Don't throw error as this is not critical for app functionality
    }
  };

  const switchOrganization = async (organizationId: string) => {
    try {
      console.log('🔄 Starting organization switch to:', organizationId);
      setError(null);
      
      // Don't set loading to true as it might trigger setup modal check
      // setIsLoading(true);
      
      // Call backend to switch organization
      await organizationService.switchOrganization(organizationId);
      console.log('✅ Backend organization switch successful');
      
      // Get the updated current organization from backend to ensure consistency
      try {
        const currentOrg = await organizationService.getCurrentOrganization();
        console.log('🏢 Updated current organization:', currentOrg.name, '- Role:', currentOrg.userRole);
        
        // Verify the switch was successful
        if (currentOrg._id === organizationId) {
          // Check if new organization's role is blocked from Recruiter
          if (checkAndHandleBlockedRole(currentOrg, organizations)) {
            return; // Exit early, user is being logged out
          }
          
          setCurrentOrganization(currentOrg);
          
          // Refresh limits after switching
          await getOrganizationLimits();
          
          console.log('✅ Organization switch completed successfully');
          
          // Instead of page reload, let components update naturally
          // Only reload if we're on a page that needs fresh organization data
          if (window.location.pathname.includes('/dashboard') || 
              window.location.pathname.includes('/jobs') || 
              window.location.pathname.includes('/candidates')) {
            console.log('🔄 Refreshing page for organization-specific content...');
            window.location.reload();
          }
        } else {
          throw new Error('Backend switch successful but current organization mismatch');
        }
      } catch (getCurrentError) {
        console.error('❌ Failed to get current organization after switch:', getCurrentError);
        // Fallback: find organization in local list and set it
        const org = organizations.find(o => o._id === organizationId);
        if (org) {
          // Check if fallback org role is blocked
          if (checkAndHandleBlockedRole(org, organizations)) {
            return; // Exit early, user is being logged out
          }
          
          setCurrentOrganization(org);
          console.log('✅ Using local organization data as fallback');
        } else {
          throw new Error('Organization switch failed: Cannot find organization');
        }
      }
    } catch (err: any) {
      console.error('❌ Error switching organization:', err);
      setError(err.message || 'Failed to switch organization');
      throw err;
    }
    // Don't set loading to false here as it might interfere with other operations
  };

  const updateOrganization = async (data: Partial<Organization>) => {
    try {
      setError(null);
      
      const updatedOrg = await organizationService.updateOrganization(data);
      
      // Update in both current organization and organizations list
      setCurrentOrganization(updatedOrg);
      setOrganizations(prev => 
        prev.map(org => org._id === updatedOrg._id ? updatedOrg : org)
      );
      
      console.log('✅ Organization updated successfully:', updatedOrg.name);
    } catch (err: any) {
      console.error('Error updating organization:', err);
      setError(err.message || 'Failed to update organization');
      throw err;
    }
  };

  const deleteOrganization = async (organizationId: string) => {
    try {
      console.log('🗑️ Deleting organization:', organizationId);
      setError(null);
      setIsLoading(true);
      
      await organizationService.deleteOrganization(organizationId);
      
      // Remove from organizations list
      const updatedOrganizations = organizations.filter(org => org._id !== organizationId);
      setOrganizations(updatedOrganizations);
      
      // If this was the current organization, switch to another one or clear
      if (currentOrganization?._id === organizationId) {
        console.log('🔄 Deleted organization was current, switching...');
        
        if (updatedOrganizations.length > 0) {
          // Switch to the first available organization
          console.log('🔄 Switching to:', updatedOrganizations[0].name);
          try {
            await switchOrganization(updatedOrganizations[0]._id);
          } catch (switchError) {
            console.error('Error switching after deletion:', switchError);
            // If switching fails, just set the first org as current
            setCurrentOrganization(updatedOrganizations[0]);
          }
        } else {
          // No organizations left, require setup
          console.log('📋 No organizations left, requiring setup');
          setCurrentOrganization(null);
          setNeedsOrganizationSetup(true);
        }
      }
      
      // Refresh organization limits after deletion
      await getOrganizationLimits();
      
      console.log('✅ Organization deleted successfully');
    } catch (err: any) {
      console.error('❌ Error deleting organization:', err);
      setError(err.message || 'Failed to delete organization');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const inviteUser = async (email: string, role: string) => {
    try {
      setError(null);
      
      const result = await organizationService.inviteUser(email, role);
      
      console.log('✅ User invited successfully:', email);
      return result;
    } catch (err: any) {
      console.error('Error inviting user:', err);
      setError(err.message || 'Failed to invite user');
      throw err;
    }
  };

  const acceptInvite = async (token: string) => {
    try {
      setError(null);
      
      const result = await organizationService.acceptInvite(token);
      
      // Reload organizations to include the new one
      await loadOrganizations();
      
      console.log('✅ Invite accepted successfully:', result.organization.name);
      return result;
    } catch (err: any) {
      console.error('Error accepting invite:', err);
      setError(err.message || 'Failed to accept invite');
      throw err;
    }
  };

  const removeMember = async (memberId: string) => {
    try {
      setError(null);
      
      await organizationService.removeMember(memberId);
      
      // Reload current organization to update member list
      if (currentOrganization) {
        const updatedOrg = await organizationService.getCurrentOrganization();
        setCurrentOrganization(updatedOrg);
      }
      
      console.log('✅ Member removed successfully');
    } catch (err: any) {
      console.error('Error removing member:', err);
      setError(err.message || 'Failed to remove member');
      throw err;
    }
  };

  const updateMemberRole = async (memberId: string, role: string) => {
    try {
      setError(null);
      
      await organizationService.updateMemberRole(memberId, role);
      
      // Reload current organization to update member list
      if (currentOrganization) {
        const updatedOrg = await organizationService.getCurrentOrganization();
        setCurrentOrganization(updatedOrg);
      }
      
      console.log('✅ Member role updated successfully');
    } catch (err: any) {
      console.error('Error updating member role:', err);
      setError(err.message || 'Failed to update member role');
      throw err;
    }
  };

  const leaveOrganization = async () => {
    try {
      setError(null);
      
      await organizationService.leaveOrganization();
      
      // Reload organizations to update the list
      await loadOrganizations();
    } catch (err: any) {
      console.error('Error leaving organization:', err);
      setError(err.message || 'Failed to leave organization');
      throw err;
    }
  };

  const transferOwnership = async (newOwnerId: string) => {
    try {
      setError(null);
      
      await organizationService.transferOwnership(newOwnerId);
      
      // Reload organizations to update roles and ownership
      await loadOrganizations();
      
      console.log('✅ Ownership transferred successfully');
    } catch (err: any) {
      console.error('Error transferring ownership:', err);
      setError(err.message || 'Failed to transfer ownership');
      throw err;
    }
  };

  const getPendingInvitations = async () => {
    try {
      setError(null);
      
      const result = await organizationService.getPendingInvitations();
      
      console.log('✅ Pending invitations fetched successfully');
      return result;
    } catch (err: any) {
      console.error('Error fetching pending invitations:', err);
      setError(err.message || 'Failed to fetch pending invitations');
      throw err;
    }
  };

  const getUserPendingInvitations = async () => {
    try {
      setError(null);
      
      const result = await organizationService.getUserPendingInvitations();
      
      console.log('✅ User pending invitations fetched successfully');
      return result;
    } catch (err: any) {
      console.error('Error fetching user pending invitations:', err);
      setError(err.message || 'Failed to fetch user pending invitations');
      throw err;
    }
  };

  const cancelInvitation = async (inviteId: string) => {
    try {
      setError(null);
      
      await organizationService.cancelInvitation(inviteId);
      
      console.log('✅ Invitation cancelled successfully');
    } catch (err: any) {
      console.error('Error cancelling invitation:', err);
      setError(err.message || 'Failed to cancel invitation');
      throw err;
    }
  };

  // SIMPLIFIED: Load organizations when we detect authentication
  useEffect(() => {
    console.log('🔍 Organization useEffect triggered', {
      isAuthenticated,
      authLoading,
      hasInitialized,
      hasToken: !!localStorage.getItem('jwt'),
      isAdminRoute
    });
    
    // Skip everything for admin routes
    if (isAdminRoute) {
      console.log('🚫 Admin route detected, skipping organization initialization');
      setIsLoading(false);
      return;
    }
    
    // If auth is still loading, wait
    if (authLoading) {
      console.log('⏳ Auth still loading, waiting...');
      return;
    }
    
    // If not authenticated, clear everything
    if (!isAuthenticated) {
      console.log('🚫 User not authenticated, clearing organization state');
      setOrganizations([]);
      setCurrentOrganization(null);
      setNeedsOrganizationSetup(false);
      setIsLoading(false);
      setHasInitialized(false);
      return;
    }
    
    // If authenticated and haven't initialized yet, load organizations
    if (isAuthenticated && !hasInitialized) {
      console.log('✅ User authenticated, loading organizations...');
      loadOrganizations();
    }
  }, [isAuthenticated, authLoading, hasInitialized, isAdminRoute]);

  // Keep track of last API call time to prevent excessive calls
  const lastTokenCheckRef = React.useRef<number>(0);
  const TOKEN_CHECK_COOLDOWN = 5000; // 5-second cooldown
    
  // Also trigger on manual login (when token appears)
  useEffect(() => {
    // Skip for admin routes
    if (isAdminRoute) {
      return;
    }
    
    const checkToken = () => {
      const token = localStorage.getItem('jwt');
      const now = Date.now();
      
      if (token && !hasInitialized && !authLoading) {
        // Add throttling to prevent excessive calls
        if (now - lastTokenCheckRef.current < TOKEN_CHECK_COOLDOWN) {
          console.log(`⏱️ Skipping organization load - called ${now - lastTokenCheckRef.current}ms ago`);
          return;
        }
        
        console.log('🔑 JWT token detected, loading organizations...');
        lastTokenCheckRef.current = now;
        loadOrganizations();
      }
    };
    
    // Check immediately
    checkToken();
    
    // Listen for storage changes, but with throttling
    const handleStorage = () => {
      const now = Date.now();
      if (now - lastTokenCheckRef.current < TOKEN_CHECK_COOLDOWN) {
        console.log('⏱️ Throttling storage event handler');
        return;
      }
      checkToken();
    };
    
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [hasInitialized, authLoading, isAdminRoute]);

  // Auto-refresh organization data on window focus (in case admin updated plan)
  // DISABLED: This was causing constant organization API calls
  // useEffect(() => {
  //   if (isAdminRoute || !hasInitialized) return;
    
  //   const handleFocus = () => {
  //     console.log('🔄 Window focused - force refreshing organization data');
  //     loadOrganizations(true);
  //   };
    
  //   window.addEventListener('focus', handleFocus);
  //   return () => window.removeEventListener('focus', handleFocus);
  // }, [hasInitialized, isAdminRoute]);

  // Debug logging
  useEffect(() => {
    console.log('📊 Organization State Update:', {
      isLoading,
      needsOrganizationSetup,
      hasOrganizations: organizations.length > 0,
      currentOrg: currentOrganization?.name || 'none',
      currentPlan: currentOrganization?.subscription?.plan || 'none'
    });
  }, [isLoading, needsOrganizationSetup, organizations, currentOrganization]);

  // Listen for reset events from AuthContext
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleResetEvent = () => {
      console.log('📢 Organization state reset event received');
      resetOrgState();
    };

    window.addEventListener('resetOrganizationState', handleResetEvent);
    return () => {
      window.removeEventListener('resetOrganizationState', handleResetEvent);
    };
  }, []);

  const contextValue: OrganizationContextType = {
    currentOrganization,
    organizations,
    isLoading,
    error,
    needsOrganizationSetup,
    organizationLimits,
    hasInitialized,
    createOrganization,
    switchOrganization,
    updateOrganization,
    deleteOrganization,
    inviteUser,
    loadOrganizations,
    forceRefresh,
    getOrganizationLimits,
    acceptInvite,
    removeMember,
    updateMemberRole,
    leaveOrganization,
    transferOwnership,
    getPendingInvitations,
    getUserPendingInvitations,
    cancelInvitation,
    clearError,
    resetOrgState // Add the reset method
  };

  return (
    <OrganizationContext.Provider value={contextValue}>
      {children}
    </OrganizationContext.Provider>
  );
};

export const useOrganization = () => {
  const context = useContext(OrganizationContext);
  if (!context) {
    throw new Error('useOrganization must be used within an OrganizationProvider');
  }
  return context;
}; 