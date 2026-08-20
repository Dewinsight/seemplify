import apiClient from '@/lib/api';

export interface AnalyticsOverview {
  totalGrossPayroll: number | null;
  totalNetPayroll: number | null;
  totalTaxWithheld: number | null;
  totalDeductions: number | null;
  totalEmployees: number;
  totalPayslips: number;
  avgCostPerEmployee: number | null;
  avgMonthlyPayroll: number | null;
  yoyGrossGrowth: number | null;
  yoyNetGrowth: number | null;
}

export interface CurrencyBreakdown {
  currency: string;
  minorUnits: number;
  payslipCount: number;
  employeeCount: number;
  grossPay: number;
  netPay: number;
  totalDeductions: number;
  totalTax: number;
  totalEmployerContributions: number;
  totalEmployerCost: number;
}

export interface ReportingMetadata {
  currency: string;
  reportingCurrency: string;
  hasAggregateTotals: boolean;
  isMultiCurrency: boolean;
  currencies: string[];
  currencyBreakdown: CurrencyBreakdown[];
  unconvertedCurrencies: string[];
  conversionWarnings: Array<{ code: string; message: string; fromCurrency: string; toCurrency: string }>;
}

export interface MonthlyTrend extends ReportingMetadata {
  month: number;
  grossPayroll: number | null;
  netPayroll: number | null;
  tax: number | null;
  employees: number;
  previousYearGross: number | null;
  growth: number | null;
  previousYearReporting: ReportingMetadata;
}

export interface DepartmentBreakdown extends ReportingMetadata {
  department: string;
  totalGross: number | null;
  totalNet: number | null;
  employeeCount: number;
  currentHeadcount: number;
  activeHeadcount: number;
  onNoticeHeadcount: number;
  onLeaveHeadcount: number;
  payrollEmployeeCount: number;
  payslipCount: number;
  avgSalary: number | null;
  avgPayPerPayslip: number | null;
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
  calculated: number;
}

export interface DeductionEarningBreakdown {
  type: string;
  name: string;
  currency: string;
  total: number | null;
  hasAggregateTotals: boolean;
  currencyBreakdown: Array<{ currency: string; total: number; minorUnits: number }>;
}

export interface ComprehensiveAnalytics extends ReportingMetadata {
  year: number;
  overview: AnalyticsOverview;
  monthlyTrend: MonthlyTrend[];
  departmentBreakdown: DepartmentBreakdown[];
  salaryDistribution: SalaryDistribution[];
  runStatusSummary: RunStatusSummary;
  deductionBreakdown: DeductionEarningBreakdown[];
  earningBreakdown: DeductionEarningBreakdown[];
  topEarnersByDept: Record<string, number | null>;
  salaryDistributionAvailable: boolean;
  salaryDistributionEmployeeCount: number;
}

export interface HeadcountAnalytics {
  total: number;
  statusBreakdown: {
    active: number;
    on_notice: number;
    on_leave: number;
    terminated: number;
    suspended: number;
    inactive: number;
  };
  employmentTypes: {
    full_time: number;
    part_time: number;
    contract: number;
    intern: number;
    unspecified: number;
  };
  departmentHeadcount: Record<string, number>;
  tenureDistribution: { label: string; count: number }[];
  totalRecords: number;
  asOf: string;
  latestSourceUpdate: string | null;
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
