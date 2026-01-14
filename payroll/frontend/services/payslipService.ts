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
    const response = await apiClient.get('/payroll/my-payslips', { params });
    return response.data;
  },

  // Get payslip by ID (for own payslips)
  async getMyPayslipById(payslipId: string): Promise<Payslip> {
    const response = await apiClient.get(`/payroll/my-payslips/${payslipId}`);
    return response.data;
  },

  // Get payslip by ID (admin view)
  async getPayslipById(payslipId: string): Promise<Payslip> {
    const response = await apiClient.get(`/payroll/payslips/${payslipId}`);
    return response.data;
  },

  // Download payslip as PDF
  async downloadPayslipPDF(payslipId: string): Promise<Blob> {
    const response = await apiClient.get(`/payroll/payslips/${payslipId}/pdf`, {
      responseType: 'blob'
    });
    return response.data;
  },

  // Get all payslips (admin only)
  async getAllPayslips(options?: { year?: number; month?: number; status?: string }): Promise<Payslip[]> {
    const response = await apiClient.get('/payroll/payslips', { params: options });
    return response.data.payslips || response.data;
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
    const response = await apiClient.post('/payroll/runs', data);
    return response.data;
  },

  async getAllPayrollRuns(year?: number): Promise<PayrollRun[]> {
    const params = year ? { year } : {};
    const response = await apiClient.get('/payroll/runs', { params });
    return response.data;
  },

  async getPayrollRunById(runId: string): Promise<PayrollRun> {
    const response = await apiClient.get(`/payroll/runs/${runId}`);
    return response.data;
  },

  // Submit payroll run for approval
  async submitForApproval(runId: string): Promise<PayrollRun> {
    const response = await apiClient.post(`/payroll/runs/${runId}/submit-for-approval`);
    return response.data;
  },

  // Approve payroll run
  async approvePayrollRun(runId: string): Promise<PayrollRun> {
    const response = await apiClient.post(`/payroll/runs/${runId}/approve`);
    return response.data;
  },

  // Process payment (mark payroll run as paid)
  async processPayment(runId: string, bankReference?: string, transactionId?: string): Promise<PayrollRun> {
    const response = await apiClient.post(`/payroll/runs/${runId}/process-payment`, {
      bankReference,
      transactionId
    });
    return response.data;
  },

  // Get payroll analytics summary
  async getAnalyticsSummary(year?: number): Promise<{
    year: number;
    totalPayrollRuns: number;
    totalEmployeesPaid: number;
    totalGrossPayroll: number;
    totalNetPayroll: number;
    totalTaxWithheld: number;
    activeEmployees: number;
    monthlyBreakdown: Array<{
      month: number;
      year: number;
      grossPayroll: number;
      netPayroll: number;
      employees: number;
      status: string;
    }>;
  }> {
    const params = year ? { year } : {};
    const response = await apiClient.get('/payroll/analytics/summary', { params });
    return response.data;
  }
};