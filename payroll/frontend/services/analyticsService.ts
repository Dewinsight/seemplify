import apiClient from '@/lib/api';

export interface AnalyticsOverview {
  totalGrossPayroll: number;
  totalNetPayroll: number;
  totalTaxWithheld: number;
  totalDeductions: number;
  totalEmployees: number;
  totalPayslips: number;
  avgCostPerEmployee: number;
  avgMonthlyPayroll: number;
  yoyGrossGrowth: number;
  yoyNetGrowth: number;
}

export interface MonthlyTrend {
  month: number;
  grossPayroll: number;
  netPayroll: number;
  tax: number;
  employees: number;
  previousYearGross: number;
  growth: number | string;
}

export interface DepartmentBreakdown {
  department: string;
  totalGross: number;
  totalNet: number;
  employeeCount: number;
  avgSalary: number;
}

export interface SalaryDistribution {
  label: string;
  count: number;
}

export interface RunStatusSummary {
  total: number;
  paid: number;
  approved: number;
  pending: number;
}

export interface DeductionEarningBreakdown {
  type: string;
  name: string;
  total: number;
}

export interface ComprehensiveAnalytics {
  year: number;
  overview: AnalyticsOverview;
  monthlyTrend: MonthlyTrend[];
  departmentBreakdown: DepartmentBreakdown[];
  salaryDistribution: SalaryDistribution[];
  runStatusSummary: RunStatusSummary;
  deductionBreakdown: DeductionEarningBreakdown[];
  earningBreakdown: DeductionEarningBreakdown[];
  topEarnersByDept: Record<string, number>;
}

export interface HeadcountAnalytics {
  total: number;
  statusBreakdown: {
    active: number;
    on_notice: number;
    on_leave: number;
    terminated: number;
    suspended: number;
  };
  employmentTypes: {
    full_time: number;
    part_time: number;
    contract: number;
    intern: number;
  };
  departmentHeadcount: Record<string, number>;
  tenureDistribution: { label: string; count: number }[];
}

export const analyticsService = {
  /**
   * Get comprehensive analytics for dashboard
   */
  async getComprehensiveAnalytics(year?: number): Promise<ComprehensiveAnalytics> {
    const params = year ? `?year=${year}` : '';
    const response = await apiClient.get(`/payroll/analytics/comprehensive${params}`);
    return response.data;
  },

  /**
   * Get basic summary analytics
   */
  async getSummary(year?: number): Promise<any> {
    const params = year ? `?year=${year}` : '';
    const response = await apiClient.get(`/payroll/analytics/summary${params}`);
    return response.data;
  },

  /**
   * Get headcount analytics
   */
  async getHeadcountAnalytics(): Promise<HeadcountAnalytics> {
    const response = await apiClient.get('/payroll/analytics/headcount');
    return response.data;
  },

  /**
   * Get year-to-date analytics for a user
   */
  async getUserYTD(userId: string, year?: number): Promise<any> {
    const params = year ? `?year=${year}` : '';
    const response = await apiClient.get(`/payroll/analytics/ytd/${userId}${params}`);
    return response.data;
  }
};

export default analyticsService;
