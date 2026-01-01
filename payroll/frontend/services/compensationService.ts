import apiClient from '../lib/api';

export interface CompensationRequest {
  _id: string;
  type: 'bonus' | 'salary_revision' | 'overtime';
  userId: string;
  userName?: string;
  requesterId: string;
  requesterName?: string;
  requesterRole?: string;
  amount: number;
  reason: string;
  effectiveDate: string;
  okrReference?: {
    okrId: string;
    score: number;
  };
  status: 'pending' | 'approved_l1' | 'approved_l2' | 'rejected' | 'processed';
  approvals: Array<{
    approverId: string;
    role: string;
    status: string;
    comment?: string;
    date: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export const compensationService = {
  // Create compensation request
  async createRequest(request: Partial<CompensationRequest>): Promise<CompensationRequest> {
    const response = await apiClient.post('/api/compensation/requests', request);
    return response.data;
  },

  // Get all compensation requests for my team (manager view)
  async getMyTeamRequests(): Promise<CompensationRequest[]> {
    const response = await apiClient.get('/api/compensation/my-team-requests');
    return response.data;
  },

  // Get all compensation requests for a specific user
  async getUserRequests(userId: string): Promise<CompensationRequest[]> {
    const response = await apiClient.get(`/api/compensation/requests/user/${userId}`);
    return response.data;
  },

  // Get all compensation requests (admin view)
  async getAllRequests(status?: string, type?: string): Promise<CompensationRequest[]> {
    const params: any = {};
    if (status) params.status = status;
    if (type) params.type = type;
    
    const response = await apiClient.get('/api/compensation/requests', { params });
    return response.data;
  },

  // Get pending requests for approval (approver view)
  async getPendingApprovals(): Promise<CompensationRequest[]> {
    const response = await apiClient.get('/api/compensation/pending-approvals');
    return response.data;
  },

  // Approve a compensation request
  async approveRequest(requestId: string, comment?: string): Promise<CompensationRequest> {
    const response = await apiClient.post(`/api/compensation/requests/${requestId}/approve`, {
      comment
    });
    return response.data;
  },

  // Reject a compensation request
  async rejectRequest(requestId: string, reason: string): Promise<CompensationRequest> {
    const response = await apiClient.post(`/api/compensation/requests/${requestId}/reject`, {
      reason
    });
    return response.data;
  },

  // Get team members for compensation requests (from IdP team hierarchy)
  async getMyTeamMembers(): Promise<Array<{
    id: string;
    name: string;
    email: string;
    designation: string;
    teamName: string;
  }>> {
    const response = await apiClient.get('/api/compensation/team-members');
    return response.data;
  },

  // Get compensation request details
  async getRequestById(requestId: string): Promise<CompensationRequest> {
    const response = await apiClient.get(`/api/compensation/requests/${requestId}`);
    return response.data;
  },

  // Update compensation request (before approval)
  async updateRequest(requestId: string, request: Partial<CompensationRequest>): Promise<CompensationRequest> {
    const response = await apiClient.put(`/api/compensation/requests/${requestId}`, request);
    return response.data;
  }
};