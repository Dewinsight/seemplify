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
    const response = await apiClient.get('/api/payroll/my-profile');
    return response.data;
  },

  // Create payroll profile (admin only)
  async createProfile(profile: Partial<PayrollProfile>): Promise<PayrollProfile> {
    const response = await apiClient.post('/api/payroll/profiles', profile);
    return response.data;
  },

  // Update payroll profile
  async updateProfile(id: string, profile: Partial<PayrollProfile>): Promise<PayrollProfile> {
    const response = await apiClient.put(`/api/payroll/profiles/${id}`, profile);
    return response.data;
  },

  // Get all payroll profiles (admin only)
  async getAllProfiles(organizationId?: string): Promise<PayrollProfile[]> {
    const params = organizationId ? { organizationId } : {};
    const response = await apiClient.get('/api/payroll/profiles', { params });
    return response.data;
  },

  // Get payroll profile by user ID (admin/manager only)
  async getProfileByUserId(userId: string): Promise<PayrollProfile> {
    const response = await apiClient.get(`/api/payroll/profiles/user/${userId}`);
    return response.data;
  },

  // Salary Grade management
  async createSalaryGrade(grade: Partial<SalaryGrade>): Promise<SalaryGrade> {
    const response = await apiClient.post('/api/payroll/salary-grades', grade);
    return response.data;
  },

  async getAllSalaryGrades(organizationId?: string): Promise<SalaryGrade[]> {
    const params = organizationId ? { organizationId } : {};
    const response = await apiClient.get('/api/payroll/salary-grades', { params });
    return response.data;
  },

  async updateSalaryGrade(id: string, grade: Partial<SalaryGrade>): Promise<SalaryGrade> {
    const response = await apiClient.put(`/api/payroll/salary-grades/${id}`, grade);
    return response.data;
  },

  async deleteSalaryGrade(id: string): Promise<void> {
    await apiClient.delete(`/api/payroll/salary-grades/${id}`);
  }
};