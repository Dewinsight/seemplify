import { apiRequest } from './apiConfig';
import { getIdpBaseUrl } from '@/utils/env';

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
  members: any[];
  settings: any;
}

interface CreateOrganizationRequest {
  name: string;
  description?: string;
  industry?: string;
  size?: string;
  website?: string;
}

interface UpdateOrganizationRequest {
  name?: string;
  description?: string;
  industry?: string;
  size?: string;
  website?: string;
  settings?: any;
}

interface InviteResponse {
  msg: string;
  inviteLink: string;
}

interface AcceptInviteResponse {
  msg: string;
  organization: Organization;
}

interface InviteDetails {
  email: string;
  role: string;
  organization: {
    _id: string;
    name: string;
    description?: string;
  };
  invitedBy: {
    _id: string;
    profile: {
      firstName: string;
      lastName: string;
    };
  };
  expiresAt: Date;
}

interface PendingInvitation {
  _id: string;
  email: string;
  role: string;
  organization: {
    _id: string;
    name: string;
  };
  invitedBy: {
    _id: string;
    profile: {
      firstName: string;
      lastName: string;
    };
    email: string;
  };
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  expiresAt: Date;
  createdAt: Date;
}

interface UserPendingInvitation {
  _id: string;
  email: string;
  role: string;
  token: string;
  organization: {
    _id: string;
    name: string;
    description?: string;
    industry?: string;
  };
  invitedBy: {
    _id: string;
    profile: {
      firstName: string;
      lastName: string;
    };
    email: string;
  };
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  expiresAt: Date;
  createdAt: Date;
}

class OrganizationService {
  async createOrganization(data: Partial<Organization>): Promise<Organization> {
    console.log('🏢 OrganizationService.createOrganization called with:', data);

    try {
      // Check if we have a valid token before making the request
      const token = typeof window !== 'undefined' ? localStorage.getItem('jwt') : null;
      console.log('🔑 Auth token exists:', !!token);
      if (token) {
        console.log('🔑 Token length:', token.length);
      }

      const response = await apiRequest(`/api/organizations`, {
        method: 'POST',
        body: JSON.stringify(data),
      });

      console.log('📡 Create organization response status:', response.status);
      console.log('📡 Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ Create organization error:', error);
        console.error('❌ Full response:', {
          status: response.status,
          statusText: response.statusText,
          error
        });

        // Handle IdP-managed response (410 Gone) - organization creation requires IdP
        if (response.status === 410 && error.code === 'idp_managed') {
          const idpError = new Error(error.msg || 'Organization creation is managed through the Identity Provider');
          (idpError as any).code = 'idp_managed';
          (idpError as any).redirectUrl = error.redirectUrl;
          (idpError as any).action = error.action;
          throw idpError;
        }

        // Handle IdP required (503) - IdP is unavailable
        if (response.status === 503 && error.code === 'idp_required') {
          const idpError = new Error(error.msg || 'Organization creation requires the Identity Provider');
          (idpError as any).code = 'idp_required';
          (idpError as any).redirectUrl = error.redirectUrl;
          throw idpError;
        }

        // Handle IdP auth required (401)
        if (response.status === 401 && error.code === 'idp_auth_required') {
          const idpError = new Error(error.msg || 'Your Identity Provider session has expired');
          (idpError as any).code = 'idp_auth_required';
          (idpError as any).redirectUrl = error.redirectUrl;
          throw idpError;
        }

        throw new Error(error.msg || error.message || 'Failed to create organization');
      }

      const result = await response.json();
      console.log('✅ Organization created successfully:', result);
      return result;
    } catch (error) {
      console.error('❌ OrganizationService.createOrganization error:', error);
      throw error;
    }
  }

  // Cache for organization data
  private orgCache = {
    data: null as Organization[] | null,
    timestamp: 0,
    ttl: 10000 // 10 seconds cache TTL
  };

  clearCache() {
    this.orgCache.data = null;
    this.orgCache.timestamp = 0;
  }

  async getUserOrganizations(forceRefresh = false): Promise<Organization[]> {
    console.log('OrganizationService.getUserOrganizations called', { forceRefresh });

    const now = Date.now();
    if (!forceRefresh && this.orgCache.data && (now - this.orgCache.timestamp < this.orgCache.ttl)) {
      console.log(`Using cached organization data (${Math.round((now - this.orgCache.timestamp) / 1000)}s old)`);
      return this.orgCache.data;
    }

    if (forceRefresh) {
      this.clearCache();
    }

    const requestUrl = '/api/organizations/user';
    console.log('Request URL:', requestUrl);

    try {
      console.log('Making organization API request...');
      const response = await apiRequest(requestUrl);
      console.log('getUserOrganizations response:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries())
      });

      if (!response.ok) {
        let error: any = {};
        try {
          error = await response.json();
        } catch (parseError) {
          console.error('Failed to parse organization error response:', parseError);
        }

        const message = error?.msg || error?.message || 'Failed to fetch organizations';
        const isSetupRequired = Boolean(
          error?.requiresOrganizationSetup || message.includes('Organization required')
        );

        if (isSetupRequired) {
          const setupError = new Error(message);
          (setupError as any).requiresOrganizationSetup = true;
          (setupError as any).status = response.status;
          (setupError as any).code = error?.code;
          throw setupError;
        }

        const requestError = new Error(message);
        (requestError as any).status = response.status;
        (requestError as any).code = error?.code;
        throw requestError;
      }

      const result = await response.json();
      console.log('getUserOrganizations result:', result);

      if (!result || !Array.isArray(result)) {
        console.log('No organizations found or invalid response format');
        return [];
      }

      if (result.length > 0) {
        console.log('Loaded organizations with roles:', result.map((org: any) => `${org.name}: ${org.userRole}`));
      }

      // Local-only: show all organizations the user belongs to (no IDP filtering)
      const filtered = result;

      this.orgCache.data = filtered;
      this.orgCache.timestamp = Date.now();

      return filtered;
    } catch (error) {
      console.error('OrganizationService.getUserOrganizations error:', error);

      if ((error as any)?.requiresOrganizationSetup) {
        throw error;
      }

      if ((error as any)?.message) {
        throw error;
      }

      const unknownError = new Error('Failed to fetch organizations');
      (unknownError as any).code = 'organizations_fetch_failed';
      throw unknownError;
    }
  }

  async switchOrganization(organizationId: string): Promise<void> {
    console.log('🔄 OrganizationService.switchOrganization called with:', organizationId);
    
    try {
      const response = await apiRequest(`/api/organizations/switch`, {
        method: 'POST',
        body: JSON.stringify({ organizationId }),
      });

      console.log('📡 Switch organization response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ Switch organization error:', error);
        throw new Error(error.msg || 'Failed to switch organization');
      }

      console.log('✅ Organization switched successfully');
    } catch (error) {
      console.error('❌ OrganizationService.switchOrganization error:', error);
      throw error;
    }
  }

  async getCurrentOrganization(): Promise<Organization> {
    console.log('🏢 OrganizationService.getCurrentOrganization called');
    
    // Add cache-busting timestamp
    const cacheBuster = `?_t=${Date.now()}`;
    const requestUrl = `/api/organizations/current${cacheBuster}`;
    console.log('📡 Request URL:', requestUrl);
    
    try {
      const response = await apiRequest(requestUrl);

      console.log('📡 Get current organization response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ Get current organization error:', error);
        throw new Error(error.msg || 'Failed to fetch current organization');
      }

      const result = await response.json();
      console.log('✅ Current organization fetched:', result);
      return result;
    } catch (error) {
      console.error('❌ OrganizationService.getCurrentOrganization error:', error);
      throw error;
    }
  }

  async getOrganizationLimits(): Promise<{
    userPlan: string;
    maxOrganizations: number | 'unlimited';
    currentCount: number;
    canCreateMore: boolean;
    remainingSlots: number | 'unlimited';
  }> {
    console.log('📊 OrganizationService.getOrganizationLimits called');
    
    try {
      const response = await apiRequest(`/api/organizations/limits`);

      console.log('📡 Get organization limits response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ Get organization limits error:', error);
        throw new Error(error.msg || 'Failed to get organization limits');
      }

      const result = await response.json();
      console.log('✅ Organization limits fetched successfully:', result);
      return result;
    } catch (error) {
      console.error('❌ OrganizationService.getOrganizationLimits error:', error);
      throw error;
    }
  }

  async updateOrganization(data: Partial<Organization>): Promise<Organization> {
    console.log('📝 OrganizationService.updateOrganization called with:', data);
    
    try {
      const response = await apiRequest(`/api/organizations/current`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });

      console.log('📡 Update organization response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ Update organization error:', error);
        throw new Error(error.msg || 'Failed to update organization');
      }

      const result = await response.json();
      console.log('✅ Organization updated successfully:', result);
      return result;
    } catch (error) {
      console.error('❌ OrganizationService.updateOrganization error:', error);
      throw error;
    }
  }

  async deleteOrganization(organizationId: string): Promise<void> {
    console.log('🗑️ OrganizationService.deleteOrganization called with:', organizationId);
    
    try {
      const response = await apiRequest(`/api/organizations/${organizationId}`, {
        method: 'DELETE',
      });

      console.log('📡 Delete organization response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ Delete organization error:', error);
        throw new Error(error.msg || error.message || 'Failed to delete organization');
      }

      const result = await response.json();
      console.log('✅ Organization deleted successfully:', result.msg);
    } catch (error) {
      console.error('❌ OrganizationService.deleteOrganization error:', error);
      throw error;
    }
  }

  async inviteUser(email: string, role: string): Promise<{ inviteLink: string }> {
    console.log('📧 OrganizationService.inviteUser called with:', { email, role });
    
    // Get the app URL from the browser window
    const appUrl = window.location.origin;
    console.log('🌐 Using app URL from window:', appUrl);
    
    try {
      const response = await apiRequest(`/api/organizations/invite`, {
        method: 'POST',
        body: JSON.stringify({ email, role, appUrl }),
      });

      console.log('📡 Invite user response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ Invite user error:', error);
        
        // Handle IdP-managed response (410 Gone)
        if (response.status === 410 && error.code === 'idp_managed') {
          const idpError = new Error(error.msg || 'Member invitations are managed through the Identity Provider');
          (idpError as any).code = 'idp_managed';
          (idpError as any).redirectUrl = error.redirectUrl;
          throw idpError;
        }
        
        throw new Error(error.msg || 'Failed to invite user');
      }

      const result = await response.json();
      console.log('✅ User invited successfully:', result);
      return result;
    } catch (error) {
      console.error('❌ OrganizationService.inviteUser error:', error);
      throw error;
    }
  }

  async acceptInvite(token: string): Promise<{ organization: Organization }> {
    console.log('✅ OrganizationService.acceptInvite called with token:', token);
    
    try {
      const response = await apiRequest(`/api/organizations/invite/${token}/accept`, {
        method: 'POST',
      });

      console.log('📡 Accept invite response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ Accept invite error:', error);
        throw new Error(error.msg || 'Failed to accept invite');
      }

      const result = await response.json();
      console.log('✅ Invite accepted successfully:', result);
      return result;
    } catch (error) {
      console.error('❌ OrganizationService.acceptInvite error:', error);
      throw error;
    }
  }

  async getInviteDetails(token: string): Promise<any> {
    console.log('🔍 OrganizationService.getInviteDetails called with token:', token);
    
    try {
      const response = await apiRequest(`/api/organizations/invite/${token}`);

      console.log('📡 Get invite details response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ Get invite details error:', error);
        throw new Error(error.msg || 'Failed to fetch invite details');
      }

      const result = await response.json();
      console.log('✅ Invite details fetched:', result);
      return result;
    } catch (error) {
      console.error('❌ OrganizationService.getInviteDetails error:', error);
      throw error;
    }
  }

  async getOrganizationMembers(): Promise<{
    members: any[];
    memberCount: number;
    source?: 'idp';
    yourRole?: string;
    idpManagementUrl?: string;
  }> {
    console.log('👥 OrganizationService.getOrganizationMembers called');
    
    const response = await apiRequest(`/api/organizations/members`);

    if (!response.ok) {
      const error = await response.json();
      // Handle IdP-managed response
      if (response.status === 410 && error.code === 'idp_managed') {
        console.log('🔗 Organization is IdP-managed, returning with redirect URL');
        return {
          members: [],
          memberCount: 0,
          source: 'idp',
          idpManagementUrl: error.redirectUrl
        };
      }
      // Handle IdP unavailable error
      if (response.status === 503 && error.code === 'idp_unavailable') {
        console.error('❌ Identity Provider unavailable');
        const idpError = new Error(error.msg || 'Identity Provider unavailable');
        (idpError as any).code = 'idp_unavailable';
        throw idpError;
      }
      // Handle organization not linked to IdP
      if (response.status === 400 && error.code === 'idp_not_linked') {
        console.error('⚠️ Organization not linked to IdP');
        const linkError = new Error(error.msg || 'Organization not linked to Identity Provider');
        (linkError as any).code = 'idp_not_linked';
        throw linkError;
      }
      throw new Error(error.msg || 'Failed to fetch organization members');
    }

    const result = await response.json();
    console.log('✅ Organization members fetched:', { 
      memberCount: result.memberCount, 
      source: result.source,
      hasIdpUrl: !!result.idpManagementUrl 
    });
    return result;
  }

  async removeMember(memberId: string): Promise<void> {
    console.log('👤 OrganizationService.removeMember called with:', memberId);
    
    if (!memberId) {
      throw new Error('Member ID is required');
    }
    
    try {
      const response = await apiRequest(`/api/organizations/members/${memberId}`, {
        method: 'DELETE',
      });

      console.log('📡 Remove member response status:', response.status);

      if (!response.ok) {
        let error;
        try {
          error = await response.json();
        } catch (parseError) {
          console.error('❌ Failed to parse error response:', parseError);
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        console.error('❌ Remove member error:', error);
        
        // Handle IdP-managed response (410 Gone)
        if (response.status === 410 && error.code === 'idp_managed') {
          const idpError = new Error(error.msg || 'Member management is handled through the Identity Provider');
          (idpError as any).code = 'idp_managed';
          (idpError as any).redirectUrl = error.redirectUrl;
          throw idpError;
        }
        
        throw new Error(error.msg || error.message || `Failed to remove member (${response.status})`);
      }

      console.log('✅ Member removed successfully');
    } catch (error) {
      console.error('❌ OrganizationService.removeMember error:', error);
      throw error;
    }
  }

  async updateMemberRole(memberId: string, role: string): Promise<void> {
    console.log('🔄 OrganizationService.updateMemberRole called with:', { memberId, role });
    
    if (!memberId) {
      throw new Error('Member ID is required');
    }
    
    if (!role) {
      throw new Error('Role is required');
    }
    
    try {
      const response = await apiRequest(`/api/organizations/members/${memberId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
      });

      console.log('📡 Update member role response status:', response.status);

      if (!response.ok) {
        let error;
        try {
          error = await response.json();
        } catch (parseError) {
          console.error('❌ Failed to parse error response:', parseError);
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        console.error('❌ Update member role error:', error);
        
        // Handle IdP-managed response (410 Gone)
        if (response.status === 410 && error.code === 'idp_managed') {
          const idpError = new Error(error.msg || 'Role management is handled through the Identity Provider');
          (idpError as any).code = 'idp_managed';
          (idpError as any).redirectUrl = error.redirectUrl;
          throw idpError;
        }
        
        throw new Error(error.msg || error.message || `Failed to update member role (${response.status})`);
      }

      console.log('✅ Member role updated successfully');
    } catch (error) {
      console.error('❌ OrganizationService.updateMemberRole error:', error);
      throw error;
    }
  }

  async leaveOrganization(): Promise<void> {
    console.log('👋 OrganizationService.leaveOrganization called');
    
    try {
      const response = await apiRequest(`/api/organizations/leave`, {
        method: 'POST',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.msg || 'Failed to leave organization');
      }

      const result = await response.json();
      console.log('✅ Successfully left organization:', result.organizationName);
    } catch (error) {
      console.error('❌ OrganizationService.leaveOrganization error:', error);
      throw error;
    }
  }

  async transferOwnership(newOwnerId: string): Promise<{ msg: string; organization: any; oldOwner: any; newOwner: any }> {
    console.log('🔄 OrganizationService.transferOwnership called with:', newOwnerId);
    
    if (!newOwnerId) {
      throw new Error('New owner ID is required');
    }
    
    try {
      const response = await apiRequest(`/api/organizations/transfer-ownership`, {
        method: 'POST',
        body: JSON.stringify({ newOwnerId }),
      });

      console.log('📡 Transfer ownership response status:', response.status);

      if (!response.ok) {
        let error;
        try {
          error = await response.json();
        } catch (parseError) {
          console.error('❌ Failed to parse error response:', parseError);
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        console.error('❌ Transfer ownership error:', error);
        
        // Handle IdP-managed response (410 Gone)
        if (response.status === 410 && error.code === 'idp_managed') {
          const idpError = new Error(error.msg || 'Ownership transfer is handled through the Identity Provider');
          (idpError as any).code = 'idp_managed';
          (idpError as any).redirectUrl = error.redirectUrl;
          throw idpError;
        }
        
        throw new Error(error.msg || error.message || `Failed to transfer ownership (${response.status})`);
      }

      const result = await response.json();
      console.log('✅ Ownership transferred successfully:', result);
      return result;
    } catch (error) {
      console.error('❌ OrganizationService.transferOwnership error:', error);
      throw error;
    }
  }

  /**
   * Check if the user needs organization setup
   */
  async checkOrganizationSetup(): Promise<{ needsSetup: boolean; organizations: Organization[] }> {
    try {
      const organizations = await this.getUserOrganizations();
      return {
        needsSetup: organizations.length === 0,
        organizations
      };
    } catch (error: any) {
      if (error.requiresOrganizationSetup) {
        return {
          needsSetup: true,
          organizations: []
        };
      }
      throw error;
    }
  }

  /**
   * Get user's role in the current organization
   */
  getUserRole(organization: Organization | null): string | null {
    if (!organization) return null;
    return organization.userRole;
  }

  /**
   * Check if user has specific permission based on their role
   */
  hasPermission(organization: Organization | null, permission: string): boolean {
    if (!organization) return false;
    
    const role = this.getUserRole(organization);
    if (!role) return false;

    const permissions: Record<string, string[]> = {
      owner: ['all'],
      admin: ['manage_users', 'manage_jobs', 'manage_candidates', 'view_analytics', 'manage_settings'],
      hr_manager: ['manage_jobs', 'manage_candidates', 'view_analytics'],
      recruiter: ['manage_candidates', 'view_jobs', 'view_candidates'],
      interviewer: ['view_candidates', 'view_jobs']
    };

    const rolePermissions = permissions[role] || [];
    return rolePermissions.includes('all') || rolePermissions.includes(permission);
  }

  /**
   * Check if user can manage users (invite/remove/update roles)
   */
  canManageUsers(organization: Organization | null): boolean {
    return this.hasPermission(organization, 'manage_users');
  }

  /**
   * Check if user can manage jobs
   */
  canManageJobs(organization: Organization | null): boolean {
    return this.hasPermission(organization, 'manage_jobs');
  }

  /**
   * Check if user can manage candidates
   */
  canManageCandidates(organization: Organization | null): boolean {
    return this.hasPermission(organization, 'manage_candidates');
  }

  /**
   * Check if user is organization owner
   */
  isOwner(organization: Organization | null): boolean {
    return this.getUserRole(organization) === 'owner';
  }

  /**
   * Get display name for a role
   */
  getRoleDisplayName(role: string): string {
    const roleNames: Record<string, string> = {
      owner: 'Owner',
      admin: 'Administrator',
      hr_manager: 'HR Manager',
      recruiter: 'Recruiter',
      interviewer: 'Interviewer'
    };

    return roleNames[role] || role;
  }

  /**
   * Get available roles for inviting users
   */
  getAvailableRoles(): Array<{ value: string; label: string; description: string }> {
    return [
      {
        value: 'admin',
        label: 'Administrator',
        description: 'Full access to manage users, jobs, and candidates'
      },
      {
        value: 'hr_manager',
        label: 'HR Manager',
        description: 'Can manage jobs, candidates, and view analytics'
      },
      {
        value: 'recruiter',
        label: 'Recruiter',
        description: 'Can manage candidates and view jobs'
      },
      {
        value: 'interviewer',
        label: 'Interviewer',
        description: 'Can view candidates and jobs for interviews'
      }
    ];
  }

  /**
   * Get pending invitations for organization
   */
  async getPendingInvitations(): Promise<{ pendingInvites: PendingInvitation[]; count: number }> {
    console.log('📋 OrganizationService.getPendingInvitations called');
    
    try {
      const response = await apiRequest(`/api/organizations/invitations/pending`);

      console.log('📡 Get pending invitations response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ Get pending invitations error:', error);
        throw new Error(error.msg || 'Failed to fetch pending invitations');
      }

      const result = await response.json();
      console.log('✅ Pending invitations fetched:', result);
      return result;
    } catch (error) {
      console.error('❌ OrganizationService.getPendingInvitations error:', error);
      throw error;
    }
  }

  /**
   * Cancel pending invitation
   */
  async cancelInvitation(inviteId: string): Promise<void> {
    console.log('❌ OrganizationService.cancelInvitation called with:', inviteId);
    
    try {
      const response = await apiRequest(`/api/organizations/invitations/${inviteId}`, {
        method: 'DELETE',
      });

      console.log('📡 Cancel invitation response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ Cancel invitation error:', error);
        
        // Handle IdP-managed response (410 Gone)
        if (response.status === 410 && error.code === 'idp_managed') {
          const idpError = new Error(error.msg || 'Invitation management is handled through the Identity Provider');
          (idpError as any).code = 'idp_managed';
          (idpError as any).redirectUrl = error.redirectUrl;
          throw idpError;
        }
        
        throw new Error(error.msg || 'Failed to cancel invitation');
      }

      console.log('✅ Invitation cancelled successfully');
    } catch (error) {
      console.error('❌ OrganizationService.cancelInvitation error:', error);
      throw error;
    }
  }

  /**
   * Get pending invitations for user (invitations they received)
   */
  async getUserPendingInvitations(): Promise<{ pendingInvites: UserPendingInvitation[]; count: number }> {
    console.log('📧 OrganizationService.getUserPendingInvitations called');
    
    try {
      // Add timestamp to prevent caching
      const timestamp = Date.now();
      const response = await apiRequest(`/api/organizations/user/invitations/pending?t=${timestamp}`);

      console.log('📡 Get user pending invitations response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ Get user pending invitations error:', error);
        throw new Error(error.msg || 'Failed to fetch user pending invitations');
      }

      const result = await response.json();
      console.log('✅ User pending invitations fetched:', result);
      
      // Ensure we always return the expected structure
      // Backend should return {pendingInvites: [], count: 0} but handle edge cases
      if (!result || typeof result.pendingInvites === 'undefined') {
        console.warn('⚠️ Unexpected response structure, using defaults:', result);
        return { pendingInvites: [], count: 0 };
      }
      
      return result;
    } catch (error) {
      console.error('❌ OrganizationService.getUserPendingInvitations error:', error);
      throw error;
    }
  }

  /**
   * Get the IdP URL for organization management
   * @param section - Optional section to navigate to (organizations, members, invitations)
   * @param orgId - Optional organization ID for specific org management
   */
  getIdpManagementUrl(section: string = 'organizations', orgId?: string): string {
    const baseUrl = getIdpBaseUrl();

    if (!baseUrl) {
      console.warn('⚠️ No IDP URL configured');
      return '';
    }

    // Remove trailing slash from base URL
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');

    if (orgId) {
      switch (section) {
        case 'members':
          return `${cleanBaseUrl}/organizations/${orgId}/members`;
        case 'invitations':
          return `${cleanBaseUrl}/organizations/${orgId}/invitations`;
        case 'teams':
          return `${cleanBaseUrl}/organizations/${orgId}/teams`;
        default:
          return `${cleanBaseUrl}/organizations/${orgId}`;
      }
    }

    return `${cleanBaseUrl}/organizations`;
  }

  /**
   * Open the IdP management URL in a new tab
   */
  openIdpManagement(section: string = 'organizations', orgId?: string): void {
    const url = this.getIdpManagementUrl(section, orgId);
    if (url) {
      window.open(url, '_blank');
    } else {
      console.error('❌ Cannot open IdP - no URL configured');
    }
  }
}

export type { Organization, PendingInvitation, UserPendingInvitation };
export default new OrganizationService(); 

