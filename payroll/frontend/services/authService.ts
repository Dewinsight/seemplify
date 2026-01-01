import apiClient from '../lib/api';

export interface LoginResponse {
  user: {
    id: string;
    name: string;
    email: string;
    organizations: string[];
    teams: any[];
    roles: string[];
  };
}

export interface UserSession {
  user: {
    id: string;
    name: string;
    email: string;
    organizations: string[];
    teams: any[];
    roles: string[];
  };
}

export const authService = {
  // Get current user session
  async getCurrentUser(): Promise<UserSession> {
    const response = await apiClient.get('/api/auth/me');
    return response.data;
  },

  // Login with OIDC
  async login(): Promise<void> {
    window.location.href = `${apiClient.defaults.baseURL}/api/auth/oidc/start`;
  },

  // Logout
  async logout(): Promise<void> {
    await apiClient.post('/api/auth/logout');
    window.location.href = '/';
  },

  // Callback handler for OIDC
  async handleCallback(): Promise<LoginResponse> {
    const response = await apiClient.get('/api/auth/callback');
    return response.data;
  },

  // Check if user is authenticated
  async isAuthenticated(): Promise<boolean> {
    try {
      await apiClient.get('/api/auth/me');
      return true;
    } catch {
      return false;
    }
  },

  // Check if user has specific role
  async hasRole(role: string): Promise<boolean> {
    try {
      const session = await this.getCurrentUser();
      return session.user.roles.includes(role);
    } catch {
      return false;
    }
  },

  // Check if user is admin
  async isAdmin(): Promise<boolean> {
    return this.hasRole('admin');
  },

  // Check if user is manager
  async isManager(): Promise<boolean> {
    const session = await this.getCurrentUser();
    return session.user.teams.some((team: any) => 
      team.role === 'line_manager' || team.role === 'team_lead'
    );
  }
};