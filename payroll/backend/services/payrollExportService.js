const ALLOWANCE_EARNING_TYPES = new Set([
  'hra',
  'transport',
  'meal',
  'phone',
  'medical',
  'education',
  'special',
]);

const BONUS_AND_COMMISSION_TYPES = new Set([
  'bonus',
  'commission',
  'incentive',
]);

const REIMBURSEMENT_TYPES = new Set(['reimbursement']);
const ExcelJS = require('exceljs');

const OTHER_EARNING_EXCLUDED_TYPES = new Set([
  'basic',
  ...ALLOWANCE_EARNING_TYPES,
  'overtime',
  ...BONUS_AND_COMMISSION_TYPES,
  ...REIMBURSEMENT_TYPES,
]);

const OTHER_DEDUCTION_EXCLUDED_TYPES = new Set([
  'income_tax',
  'social_security',
  'pension',
  'health_insurance',
  'life_insurance',
  'loan_repayment',
  'advance_recovery',
  'unpaid_leave',
  'late_penalty',
  'union_dues',
  'garnishment',
  'voluntary_contribution',
  'parking',
]);

const OTHER_EMPLOYER_CONTRIBUTION_EXCLUDED_TYPES = new Set([
  'social_security',
  'pension_match',
  'health_insurance',
  'life_insurance',
]);

const COLUMN_DEFINITIONS = [
  { key: 'recordType', header: 'Record Type' },
  { key: 'runNumber', header: 'Run Number' },
  { key: 'runStatus', header: 'Run Status' },
  { key: 'payslipNumber', header: 'Payslip Number' },
  { key: 'payslipStatus', header: 'Payslip Status' },
  { key: 'periodLabel', header: 'Period Label' },
  { key: 'periodType', header: 'Period Type' },
  { key: 'periodStart', header: 'Period Start' },
  { key: 'periodEnd', header: 'Period End' },
  { key: 'paymentDate', header: 'Payment Date' },
  { key: 'month', header: 'Month' },
  { key: 'year', header: 'Year' },
  { key: 'currency', header: 'Currency' },
  { key: 'employeeId', header: 'Employee ID' },
  { key: 'employeeName', header: 'Employee Name' },
  { key: 'employeeEmail', header: 'Employee Email' },
  { key: 'department', header: 'Department' },
  { key: 'team', header: 'Team' },
  { key: 'designation', header: 'Designation' },
  { key: 'employmentType', header: 'Employment Type' },
  { key: 'payBasis', header: 'Pay Basis' },
  { key: 'payRate', header: 'Pay Rate' },
  { key: 'workUnits', header: 'Work Units' },
  { key: 'workUnitLabel', header: 'Work Unit' },
  { key: 'contractReference', header: 'Contract Reference' },
  { key: 'contractStartDate', header: 'Contract Start' },
  { key: 'contractEndDate', header: 'Contract End' },
  { key: 'costCenter', header: 'Cost Center' },
  { key: 'workLocation', header: 'Work Location' },
  { key: 'managerName', header: 'Manager Name' },
  { key: 'managerId', header: 'Manager ID' },
  { key: 'basicSalary', header: 'Basic Salary' },
  { key: 'allowances', header: 'Allowances' },
  { key: 'overtime', header: 'Overtime' },
  { key: 'bonusesAndCommissions', header: 'Bonuses & Commissions' },
  { key: 'reimbursements', header: 'Reimbursements' },
  { key: 'otherEarnings', header: 'Other Earnings' },
  { key: 'grossPay', header: 'Gross Pay' },
  { key: 'incomeTax', header: 'Income Tax' },
  { key: 'socialSecurityEmployee', header: 'Social Security (Employee)' },
  { key: 'pensionEmployee', header: 'Pension (Employee)' },
  { key: 'healthInsuranceEmployee', header: 'Health Insurance (Employee)' },
  { key: 'lifeInsuranceEmployee', header: 'Life Insurance (Employee)' },
  { key: 'loanRepayment', header: 'Loan Repayment' },
  { key: 'advanceRecovery', header: 'Advance Recovery' },
  { key: 'unpaidLeave', header: 'Unpaid Leave' },
  { key: 'latePenalty', header: 'Late Penalty' },
  { key: 'unionDues', header: 'Union Dues' },
  { key: 'garnishment', header: 'Garnishment' },
  { key: 'voluntaryContributions', header: 'Voluntary Contributions' },
  { key: 'parking', header: 'Parking' },
  { key: 'otherDeductions', header: 'Other Deductions' },
  { key: 'totalDeductions', header: 'Total Deductions' },
  { key: 'employerSocialSecurity', header: 'Employer Social Security' },
  { key: 'employerPension', header: 'Employer Pension' },
  { key: 'employerHealthInsurance', header: 'Employer Health Insurance' },
  { key: 'employerLifeInsurance', header: 'Employer Life Insurance' },
  { key: 'otherEmployerContributions', header: 'Other Employer Contributions' },
  { key: 'totalEmployerContributions', header: 'Total Employer Contributions' },
  { key: 'netPay', header: 'Net Pay' },
  { key: 'paymentMethod', header: 'Payment Method' },
  { key: 'accountName', header: 'Account Name' },
  { key: 'bankName', header: 'Bank Name' },
  { key: 'accountNumber', header: 'Account Number' },
  { key: 'accountType', header: 'Account Type' },
  { key: 'branchName', header: 'Branch Name' },
  { key: 'branchCode', header: 'Branch Code' },
  { key: 'routingNumber', header: 'Routing Number / Sort Code' },
  { key: 'iban', header: 'IBAN' },
  { key: 'swiftCode', header: 'SWIFT / BIC' },
  { key: 'bankVerified', header: 'Bank Verified' },
  { key: 'taxJurisdictionCode', header: 'Tax Jurisdiction Code' },
  { key: 'taxJurisdictionName', header: 'Tax Jurisdiction Name' },
  { key: 'taxYearLabel', header: 'Tax Year' },
  { key: 'taxCalculationMode', header: 'Tax Calculation Mode' },
  { key: 'taxMethod', header: 'Tax Method' },
  { key: 'paymentReference', header: 'Payment Reference' },
  { key: 'transactionId', header: 'Transaction ID' },
];

const NUMERIC_COLUMNS = [
  'payRate',
  'workUnits',
  'basicSalary',
  'allowances',
  'overtime',
  'bonusesAndCommissions',
  'reimbursements',
  'otherEarnings',
  'grossPay',
  'incomeTax',
  'socialSecurityEmployee',
  'pensionEmployee',
  'healthInsuranceEmployee',
  'lifeInsuranceEmployee',
  'loanRepayment',
  'advanceRecovery',
  'unpaidLeave',
  'latePenalty',
  'unionDues',
  'garnishment',
  'voluntaryContributions',
  'parking',
  'otherDeductions',
  'totalDeductions',
  'employerSocialSecurity',
  'employerPension',
  'employerHealthInsurance',
  'employerLifeInsurance',
  'otherEmployerContributions',
  'totalEmployerContributions',
  'netPay',
];

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function formatAmount(value) {
  return roundMoney(value).toFixed(2);
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatDateOnly(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().split('T')[0];
}

function mapKey(value) {
  return value === null || value === undefined ? '' : String(value);
}

function sumByType(items, type) {
  return roundMoney(
    (Array.isArray(items) ? items : [])
      .filter((item) => item && item.type === type)
      .reduce((sum, item) => sum + toNumber(item.amount), 0)
  );
}

function sumByTypes(items, types) {
  const typeSet = types instanceof Set ? types : new Set(types || []);
  return roundMoney(
    (Array.isArray(items) ? items : [])
      .filter((item) => item && typeSet.has(item.type))
      .reduce((sum, item) => sum + toNumber(item.amount), 0)
  );
}

function sumOtherTypes(items, excludedTypes) {
  const excluded = excludedTypes instanceof Set ? excludedTypes : new Set(excludedTypes || []);
  return roundMoney(
    (Array.isArray(items) ? items : [])
      .filter((item) => item && !excluded.has(item.type))
      .reduce((sum, item) => sum + toNumber(item.amount), 0)
  );
}

function getPrimaryBankAccount(profile, payslip) {
  const accounts = Array.isArray(profile?.bankAccounts) ? profile.bankAccounts : [];
  if (accounts.length > 0) {
    return accounts.find((account) => account && account.isPrimary) || accounts[0];
  }

  const snapshotBank = payslip?.employeeSnapshot?.bankAccount || {};
  if (snapshotBank.bankName || snapshotBank.accountNumber || snapshotBank.routingNumber) {
    return {
      accountName: '',
      bankName: snapshotBank.bankName || '',
      accountNumber: snapshotBank.accountNumber || '',
      accountType: '',
      branchName: '',
      branchCode: '',
      routingNumber: snapshotBank.routingNumber || '',
      iban: '',
      swiftCode: '',
      isVerified: false,
    };
  }

  return null;
}

function getPeriodLabel(payPeriod = {}) {
  if (payPeriod.month && payPeriod.year) {
    return `${String(payPeriod.month).padStart(2, '0')}/${payPeriod.year}`;
  }
  return '';
}

function buildDetailRow(payslip, run, profile) {
  const employeeSnapshot = payslip?.employeeSnapshot || {};
  const employeeInfo = profile?.employeeInfo || {};
  const payPeriod = payslip?.payPeriod || run?.payPeriod || {};
  const earnings = Array.isArray(payslip?.earnings) ? payslip.earnings : [];
  const deductions = Array.isArray(payslip?.deductions) ? payslip.deductions : [];
  const employerContributions = Array.isArray(payslip?.employerContributions)
    ? payslip.employerContributions
    : [];
  const bankAccount = getPrimaryBankAccount(profile, payslip) || {};

  const basicSalary = earnings.length
    ? sumByType(earnings, 'basic')
    : roundMoney(payslip?.earningsSummary?.basicSalary);
  const allowances = earnings.length
    ? sumByTypes(earnings, ALLOWANCE_EARNING_TYPES)
    : roundMoney(payslip?.earningsSummary?.totalAllowances);
  const overtime = earnings.length
    ? sumByType(earnings, 'overtime')
    : roundMoney(payslip?.earningsSummary?.overtimePay);
  const bonusesAndCommissions = earnings.length
    ? sumByTypes(earnings, BONUS_AND_COMMISSION_TYPES)
    : roundMoney(payslip?.earningsSummary?.totalBonuses);
  const reimbursements = sumByTypes(earnings, REIMBURSEMENT_TYPES);
  const grossPay = roundMoney(
    payslip?.earningsSummary?.grossPay ??
    earnings.reduce((sum, item) => sum + toNumber(item?.amount), 0)
  );
  const otherEarnings = earnings.length
    ? sumOtherTypes(earnings, OTHER_EARNING_EXCLUDED_TYPES)
    : roundMoney(
      Math.max(0, grossPay - basicSalary - allowances - overtime - bonusesAndCommissions - reimbursements)
    );

  const incomeTax = roundMoney(
    payslip?.taxBreakdown?.taxAmount ??
    sumByType(deductions, 'income_tax')
  );
  const socialSecurityEmployee = sumByType(deductions, 'social_security');
  const pensionEmployee = sumByType(deductions, 'pension');
  const healthInsuranceEmployee = sumByType(deductions, 'health_insurance');
  const lifeInsuranceEmployee = sumByType(deductions, 'life_insurance');
  const loanRepayment = sumByType(deductions, 'loan_repayment');
  const advanceRecovery = sumByType(deductions, 'advance_recovery');
  const unpaidLeave = sumByType(deductions, 'unpaid_leave');
  const latePenalty = sumByType(deductions, 'late_penalty');
  const unionDues = sumByType(deductions, 'union_dues');
  const garnishment = sumByType(deductions, 'garnishment');
  const voluntaryContributions = sumByType(deductions, 'voluntary_contribution');
  const parking = sumByType(deductions, 'parking');
  const totalDeductions = roundMoney(
    payslip?.deductionsSummary?.totalDeductions ??
    deductions.reduce((sum, item) => sum + toNumber(item?.amount), 0)
  );
  const otherDeductions = deductions.length
    ? sumOtherTypes(deductions, OTHER_DEDUCTION_EXCLUDED_TYPES)
    : roundMoney(
      Math.max(
        0,
        totalDeductions
          - incomeTax
          - socialSecurityEmployee
          - pensionEmployee
          - healthInsuranceEmployee
          - lifeInsuranceEmployee
          - loanRepayment
          - advanceRecovery
          - unpaidLeave
          - latePenalty
          - unionDues
          - garnishment
          - voluntaryContributions
          - parking
      )
    );

  const employerSocialSecurity = sumByType(employerContributions, 'social_security');
  const employerPension = sumByType(employerContributions, 'pension_match');
  const employerHealthInsurance = sumByType(employerContributions, 'health_insurance');
  const employerLifeInsurance = sumByType(employerContributions, 'life_insurance');
  const totalEmployerContributions = roundMoney(
    payslip?.totalEmployerContributions ??
    employerContributions.reduce((sum, item) => sum + toNumber(item?.amount), 0)
  );
  const otherEmployerContributions = employerContributions.length
    ? sumOtherTypes(employerContributions, OTHER_EMPLOYER_CONTRIBUTION_EXCLUDED_TYPES)
    : roundMoney(
      Math.max(
        0,
        totalEmployerContributions
          - employerSocialSecurity
          - employerPension
          - employerHealthInsurance
          - employerLifeInsurance
      )
    );

  return {
    recordType: 'DETAIL',
    runNumber: run?.runNumber || '',
    runStatus: run?.status || '',
    payslipNumber: payslip?.payslipNumber || '',
    payslipStatus: payslip?.status || '',
    periodLabel: getPeriodLabel(payPeriod),
    periodType: payPeriod.type || '',
    periodStart: formatDateOnly(payPeriod.startDate),
    periodEnd: formatDateOnly(payPeriod.endDate),
    paymentDate: formatDateOnly(
      payslip?.paymentDetails?.paymentDate || payPeriod.paymentDate || run?.payPeriod?.paymentDate
    ),
    month: payPeriod.month || '',
    year: payPeriod.year || '',
    currency: payslip?.currency || run?.summary?.currency || profile?.currency || 'USD',
    employeeId: employeeSnapshot.employeeId || employeeInfo.employeeId || payslip?.userId || '',
    employeeName: employeeSnapshot.name || employeeInfo.name || '',
    employeeEmail: employeeSnapshot.email || employeeInfo.email || '',
    department: employeeSnapshot.department || employeeInfo.department || '',
    team: employeeSnapshot.teamName || employeeInfo.teamName || '',
    designation: employeeSnapshot.designation || employeeInfo.designation || '',
    employmentType: employeeSnapshot.employmentType || employeeInfo.employmentType || '',
    payBasis: payslip?.calculationBasis?.payBasis || profile?.workTerms?.payBasis || 'salary',
    payRate: roundMoney(payslip?.calculationBasis?.rate),
    workUnits: roundMoney(payslip?.calculationBasis?.units),
    workUnitLabel: payslip?.calculationBasis?.unitLabel || '',
    contractReference: payslip?.calculationBasis?.contractReference || profile?.workTerms?.contractReference || '',
    contractStartDate: formatDateOnly(payslip?.calculationBasis?.contractStartDate || profile?.workTerms?.contractStartDate),
    contractEndDate: formatDateOnly(payslip?.calculationBasis?.contractEndDate || profile?.workTerms?.contractEndDate),
    costCenter: employeeSnapshot.costCenter || employeeInfo.costCenter || '',
    workLocation: employeeSnapshot.location || employeeInfo.workLocation || '',
    managerName: employeeSnapshot.managerName || employeeInfo.managerName || '',
    managerId: employeeSnapshot.managerId || employeeInfo.managerId || '',
    basicSalary,
    allowances,
    overtime,
    bonusesAndCommissions,
    reimbursements,
    otherEarnings,
    grossPay,
    incomeTax,
    socialSecurityEmployee,
    pensionEmployee,
    healthInsuranceEmployee,
    lifeInsuranceEmployee,
    loanRepayment,
    advanceRecovery,
    unpaidLeave,
    latePenalty,
    unionDues,
    garnishment,
    voluntaryContributions,
    parking,
    otherDeductions,
    totalDeductions,
    employerSocialSecurity,
    employerPension,
    employerHealthInsurance,
    employerLifeInsurance,
    otherEmployerContributions,
    totalEmployerContributions,
    netPay: roundMoney(payslip?.netPay),
    paymentMethod: payslip?.paymentDetails?.method || 'bank_transfer',
    accountName: bankAccount.accountName || '',
    bankName: bankAccount.bankName || '',
    accountNumber: bankAccount.accountNumber || '',
    accountType: bankAccount.accountType || '',
    branchName: bankAccount.branchName || '',
    branchCode: bankAccount.branchCode || '',
    routingNumber: bankAccount.routingNumber || '',
    iban: bankAccount.iban || '',
    swiftCode: bankAccount.swiftCode || '',
    bankVerified: bankAccount.isVerified ? 'Yes' : 'No',
    taxJurisdictionCode: payslip?.taxBreakdown?.jurisdictionCode || '',
    taxJurisdictionName: payslip?.taxBreakdown?.jurisdictionName || '',
    taxYearLabel: payslip?.taxBreakdown?.taxYearLabel || '',
    taxCalculationMode: payslip?.taxBreakdown?.calculationMode || '',
    taxMethod: payslip?.taxBreakdown?.method || '',
    paymentReference: payslip?.paymentDetails?.bankReference || run?.paymentBatch?.bankReference || '',
    transactionId: payslip?.paymentDetails?.transactionId || '',
  };
}

function buildControlRow(currency, totals) {
  const row = {
    recordType: 'CONTROL_TOTAL',
    runNumber: '',
    runStatus: '',
    payslipNumber: '',
    payslipStatus: '',
    periodLabel: '',
    periodType: '',
    periodStart: '',
    periodEnd: '',
    paymentDate: '',
    month: '',
    year: '',
    currency,
    employeeId: '',
    employeeName: `Control Total (${currency})`,
    employeeEmail: '',
    department: '',
    team: '',
    designation: '',
    employmentType: '',
    payBasis: '',
    workUnitLabel: '',
    contractReference: '',
    contractStartDate: '',
    contractEndDate: '',
    costCenter: '',
    workLocation: '',
    managerName: '',
    managerId: '',
    paymentMethod: '',
    accountName: '',
    bankName: '',
    accountNumber: '',
    accountType: '',
    branchName: '',
    branchCode: '',
    routingNumber: '',
    iban: '',
    swiftCode: '',
    bankVerified: '',
    taxJurisdictionCode: '',
    taxJurisdictionName: '',
    taxYearLabel: '',
    taxCalculationMode: '',
    taxMethod: '',
    paymentReference: '',
    transactionId: '',
  };

  NUMERIC_COLUMNS.forEach((key) => {
    row[key] = roundMoney(totals[key]);
  });

  return row;
}

function serializeRow(row) {
  return COLUMN_DEFINITIONS
    .map(({ key }) => {
      if (NUMERIC_COLUMNS.includes(key)) {
        return csvEscape(row[key] === '' || row[key] === null || row[key] === undefined ? '' : formatAmount(row[key]));
      }
      return csvEscape(row[key] ?? '');
    })
    .join(',');
}

function buildPayrollRegisterCsv({ payslips = [], runById = new Map(), profileByUserId = new Map() }) {
  const detailRows = payslips.map((payslip) => {
    const run = runById.get(mapKey(payslip?.payrollRunId)) || null;
    const profile = profileByUserId.get(mapKey(payslip?.userId)) || null;
    return buildDetailRow(payslip, run, profile);
  });

  const totalsByCurrency = new Map();
  detailRows.forEach((row) => {
    const currency = row.currency || 'USD';
    if (!totalsByCurrency.has(currency)) {
      const initial = {};
      NUMERIC_COLUMNS.forEach((key) => {
        initial[key] = 0;
      });
      totalsByCurrency.set(currency, initial);
    }

    const totals = totalsByCurrency.get(currency);
    NUMERIC_COLUMNS.forEach((key) => {
      totals[key] += toNumber(row[key]);
    });
  });

  const controlRows = Array.from(totalsByCurrency.entries())
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([currency, totals]) => buildControlRow(currency, totals));

  const headers = COLUMN_DEFINITIONS.map(({ header }) => header);
  const rows = [
    headers.map(csvEscape).join(','),
    ...detailRows.map(serializeRow),
    ...controlRows.map(serializeRow),
  ];

  return {
    csv: rows.join('\n'),
    detailCount: detailRows.length,
    controlCount: controlRows.length,
    headers,
  };
}

async function buildPayrollRegisterWorkbook({ payslips = [], runById = new Map(), profileByUserId = new Map() }) {
  const detailRows = payslips.map((payslip) => buildDetailRow(
    payslip,
    runById.get(mapKey(payslip?.payrollRunId)) || null,
    profileByUserId.get(mapKey(payslip?.userId)) || null
  ));
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Seemplify Payroll';
  workbook.created = new Date();
  const registerRows = detailRows.map(row => Object.fromEntries(
    COLUMN_DEFINITIONS.map(({ key, header }) => [header, row[key] ?? ''])
  ));
  const registerSheet = workbook.addWorksheet('Payroll register', { views: [{ state: 'frozen', ySplit: 1 }] });
  registerSheet.columns = COLUMN_DEFINITIONS.map(({ header }) => ({ header, key: header, width: Math.min(34, Math.max(12, header.length + 2)) }));
  registerSheet.addRows(registerRows);
  registerSheet.autoFilter = { from: 'A1', to: { row: 1, column: COLUMN_DEFINITIONS.length } };
  registerSheet.getRow(1).font = { bold: true };

  const summaries = new Map();
  detailRows.forEach(row => {
    const key = `${row.periodLabel}|${row.currency}`;
    const current = summaries.get(key) || {
      Period: row.periodLabel,
      Currency: row.currency,
      Employees: 0,
      'Gross pay': 0,
      Deductions: 0,
      'Net pay': 0,
      Tax: 0,
      'Employer contributions': 0,
    };
    current.Employees += 1;
    current['Gross pay'] = roundMoney(current['Gross pay'] + row.grossPay);
    current.Deductions = roundMoney(current.Deductions + row.totalDeductions);
    current['Net pay'] = roundMoney(current['Net pay'] + row.netPay);
    current.Tax = roundMoney(current.Tax + row.incomeTax);
    current['Employer contributions'] = roundMoney(current['Employer contributions'] + row.totalEmployerContributions);
    summaries.set(key, current);
  });
  const summaryRows = Array.from(summaries.values());
  const summarySheet = workbook.addWorksheet('Period summary', { views: [{ state: 'frozen', ySplit: 1 }] });
  const summaryHeaders = ['Period', 'Currency', 'Employees', 'Gross pay', 'Deductions', 'Net pay', 'Tax', 'Employer contributions'];
  summarySheet.columns = summaryHeaders.map(header => ({ header, key: header, width: Math.max(14, header.length + 2) }));
  summarySheet.addRows(summaryRows);
  summarySheet.getRow(1).font = { bold: true };

  const contractRows = registerRows.filter(row => row['Employment Type'] === 'contract' || row['Pay Basis'] !== 'salary');
  const contractSheet = workbook.addWorksheet('Contract work', { views: [{ state: 'frozen', ySplit: 1 }] });
  contractSheet.columns = COLUMN_DEFINITIONS.map(({ header }) => ({ header, key: header, width: Math.min(34, Math.max(12, header.length + 2)) }));
  contractSheet.addRows(contractRows);
  contractSheet.getRow(1).font = { bold: true };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

module.exports = {
  buildPayrollRegisterCsv,
  buildPayrollRegisterWorkbook,
};
