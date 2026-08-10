import apiClient from '../lib/api';

export interface PayrollProfile {
  _id: string;
  userId: string;
  organizationId: string;
  basicSalary: number;
  currency: string;
  bankDetails: {
    accountName?: string;
    accountNumber?: string;
    bankName?: string;
    swiftCode?: string;
  };
  taxId?: string;
  taxRegime: 'standard' | 'simplified';
  gradeId?: string;
  allowances: Array<{
    type: string;
    amount: number;
    isTaxable: boolean;
  }>;
  isActive: boolean;
  startDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface SalaryGrade {
  _id: string;
  organizationId: string;
  gradeCode: string;
  gradeName: string;
  gradeLevel: number;
  salaryRange: {
    currency: string;
    minimum: number;
    maximum: number;
    midpoint: number;
  };
  variablePay: {
    eligible: boolean;
    percentageOfBase: number;
    maximumBonus?: number;
  };
  allowances: Array<{
    name: string;
    type: 'fixed' | 'percentage';
    amount?: number;
    percentage?: number;
    isTaxable: boolean;
    isMandatory: boolean;
  }>;
  isActive: boolean;
  effectiveDate: string;
  endDate?: string;
}

export const payrollService = {
  // Get current user's payroll profile
  async getMyProfile(): Promise<PayrollProfile> {
    const response = await apiClient.get('/payroll/profile/me');
    return response.data;
  },

  // Initialize payroll configuration for an existing IDP member (admin only)
  async configureProfileForMember(userId: string): Promise<PayrollProfile> {
    const response = await apiClient.post('/payroll/profiles/sync-from-idp', { userId });
    return response.data.profile || response.data;
  },

  // Update payroll profile
  async updateProfile(userId: string, profile: Partial<PayrollProfile>): Promise<PayrollProfile> {
    const response = await apiClient.put(`/payroll/profiles/${userId}`, profile);
    return response.data.profile || response.data;
  },

  // Get all payroll profiles (admin only)
  async getAllProfiles(options?: { status?: string; teamId?: string; department?: string }): Promise<{ profiles: PayrollProfile[]; total: number }> {
    const response = await apiClient.get('/payroll/profiles', { params: options });
    return response.data;
  },

  // Get payroll profile by user ID (admin/manager only)
  async getProfileByUserId(userId: string): Promise<PayrollProfile> {
    const response = await apiClient.get(`/payroll/profiles/${userId}`);
    return response.data;
  },

  // Salary Grade management
  async createSalaryGrade(grade: Partial<SalaryGrade>): Promise<SalaryGrade> {
    const response = await apiClient.post('/payroll/salary-grades', grade);
    return response.data;
  },

  async getAllSalaryGrades(): Promise<SalaryGrade[]> {
    const response = await apiClient.get('/payroll/salary-grades');
    return response.data;
  },

  async updateSalaryGrade(id: string, grade: Partial<SalaryGrade>): Promise<SalaryGrade> {
    const response = await apiClient.put(`/payroll/salary-grades/${id}`, grade);
    return response.data;
  },

  async deleteSalaryGrade(id: string): Promise<void> {
    await apiClient.delete(`/payroll/salary-grades/${id}`);
  }
};
