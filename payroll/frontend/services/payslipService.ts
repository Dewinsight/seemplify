import apiClient from '../lib/api';

export interface Payslip {
  _id: string;
  payrollRunId: string;
  userId: string;
  organizationId: string;
  userSnapshot: {
    name: string;
    email: string;
    designation: string;
    teamName: string;
    managerName: string;
  };
  earnings: {
    basic: number;
    allowances: Array<{ name: string; amount: number }>;
    bonuses: Array<{ reason: string; amount: number }>;
    overtime: number;
    totalGross: number;
  };
  deductions: {
    tax: number;
    socialSecurity: number;
    unpaidLeave: {
      days: number;
      amount: number;
    };
    other: Array<{ reason: string; amount: number }>;
    totalDeductions: number;
  };
  netPay: number;
  currency: string;
  createdAt: string;
}

export interface PayrollRun {
  _id: string;
  organizationId: string;
  month: number;
  year: number;
  status: 'draft' | 'processing' | 'approval_pending' | 'approved' | 'paid';
  totalPayrollCost: number;
  totalEmployees: number;
  processedBy: string;
  approvedBy?: string;
  approvedAt?: string;
  settings: {
    includeBonuses: boolean;
    includeOvertime: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export const payslipService = {
  // Get my payslips
  async getMyPayslips(year?: number): Promise<Payslip[]> {
    const params = year ? { year } : {};
    const response = await apiClient.get('/api/payroll/my-payslips', { params });
    return response.data;
  },

  // Get payslip by ID
  async getPayslipById(payslipId: string): Promise<Payslip> {
    const response = await apiClient.get(`/api/payroll/payslips/${payslipId}`);
    return response.data;
  },

  // Download payslip as PDF
  async downloadPayslipPDF(payslipId: string): Promise<Blob> {
    const response = await apiClient.get(`/api/payroll/payslips/${payslipId}/pdf`, {
      responseType: 'blob'
    });
    return response.data;
  },

  // Get payslips for a specific user (admin/manager)
  async getUserPayslips(userId: string, year?: number): Promise<Payslip[]> {
    const params = year ? { year } : {};
    const response = await apiClient.get(`/api/payroll/payslips/user/${userId}`, { params });
    return response.data;
  },

  // Payroll Run management (admin only)
  async createPayrollRun(data: {
    month: number;
    year: number;
    settings: {
      includeBonuses: boolean;
      includeOvertime: boolean;
    };
  }): Promise<PayrollRun> {
    const response = await apiClient.post('/api/payroll/runs', data);
    return response.data;
  },

  async getAllPayrollRuns(organizationId?: string): Promise<PayrollRun[]> {
    const params = organizationId ? { organizationId } : {};
    const response = await apiClient.get('/api/payroll/runs', { params });
    return response.data;
  },

  async getPayrollRunById(runId: string): Promise<PayrollRun> {
    const response = await apiClient.get(`/api/payroll/runs/${runId}`);
    return response.data;
  },

  async updatePayrollRun(runId: string, data: Partial<PayrollRun>): Promise<PayrollRun> {
    const response = await apiClient.put(`/api/payroll/runs/${runId}`, data);
    return response.data;
  },

  // Execute payroll run
  async executePayrollRun(runId: string): Promise<{
    success: boolean;
    message: string;
    payslipsGenerated: number;
    totalCost: number;
  }> {
    const response = await apiClient.post(`/api/payroll/runs/${runId}/execute`);
    return response.data;
  },

  // Approve payroll run
  async approvePayrollRun(runId: string): Promise<PayrollRun> {
    const response = await apiClient.post(`/api/payroll/runs/${runId}/approve`);
    return response.data;
  },

  // Mark payroll run as paid
  async markPayrollRunAsPaid(runId: string): Promise<PayrollRun> {
    const response = await apiClient.post(`/api/payroll/runs/${runId}/mark-paid`);
    return response.data;
  },

  // Get payroll statistics
  async getPayrollStats(organizationId: string, month?: number, year?: number): Promise<{
    totalEmployees: number;
    totalPayrollCost: number;
    averageSalary: number;
    totalTaxes: number;
    totalBonuses: number;
  }> {
    const params: any = { organizationId };
    if (month) params.month = month;
    if (year) params.year = year;
    
    const response = await apiClient.get('/api/payroll/stats', { params });
    return response.data;
  }
};