const express = require('express');
const router = express.Router();
const axios = require('axios');
const PayrollRun = require('../models/PayrollRun');
const Payslip = require('../models/Payslip');
const PayrollProfile = require('../models/PayrollProfile');
const CompensationRequest = require('../models/CompensationRequest');
const PayrollEngineService = require('../services/PayrollEngineService');
const taxService = require('../services/TaxCalculationService');
const organizationCurrencyService = require('../services/OrganizationCurrencyService');
const payComponentTaxService = require('../services/PayComponentTaxService');
const payrollReportingService = require('../services/PayrollReportingService');
const payrollFinalizationService = require('../services/PayrollFinalizationService');
const payrollRetractionService = require('../services/PayrollRetractionService');
const payrollAnalyticsService = require('../services/PayrollAnalyticsService');
const employerEntityService = require('../services/PayrollEmployerEntityService');
const payrollCountryAutomationService = require('../services/PayrollCountryAutomationService');
const { queuePayrollReadyEvent } = require('../services/automationEventService');
const { buildPayrollRegisterCsv } = require('../services/payrollExportService');
const { hash: hashPayrollTotals, runTotals: getPayrollRunTotals } = require('../services/PayrollCycleService');
const payrollCycleService = require('../services/PayrollCycleService');
const { createPayslipPdf } = require('../services/payslipPdfService');
const { hasPayConfiguration } = require('../services/contractPayService');
const { getIdentityProviderIssuerUrl } = require('../config/identityProvider');
const peopleTransitionsClient = require('../services/peopleTransitionsClient');
const taxWithholdingTreatmentService = require('../services/TaxWithholdingTreatmentService');
const payrollEngineService = new PayrollEngineService();
const PAY_FREQUENCIES = new Set(['monthly', 'semi-monthly', 'bi-weekly', 'weekly']);
const ANALYTICS_PAYSLIP_STATUSES = ['draft', 'pending_approval', 'approved', 'exported', 'paid', 'revised'];

function reportingMetadata(reporting) {
  return {
    currency: reporting.reportingCurrency,
    reportingCurrency: reporting.reportingCurrency,
    hasAggregateTotals: reporting.hasAggregateTotals,
    isMultiCurrency: reporting.isMultiCurrency,
    currencies: reporting.currencies,
    currencyBreakdown: reporting.currencyBreakdown,
    unconvertedCurrencies: reporting.unconvertedCurrencies,
    conversionWarnings: reporting.conversionWarnings,
  };
}

function aggregatePreparedSubset(prepared, rows) {
  return payrollReportingService.aggregatePreparedRows(rows, {
    reportingCurrency: prepared.reportingCurrency,
    reportingMinorUnits: prepared.reportingMinorUnits,
  });
}

function percentageGrowth(current, previous) {
  if (current === null || previous === null) return null;
  if (previous <= 0) return 0;
  return Math.round((((current - previous) / previous) * 100) * 10) / 10;
}

function roundReportingAmount(value, minorUnits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const factor = 10 ** minorUnits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

// Import RBAC middleware
const { requireAuth, requireHRAdmin, requireManager, requirePermission } = require('../middleware/rbac');

// Import email service for notifications
const { emailService } = require('../services/emailService');

// Helper to get user info from session
const getUserInfo = (req) => ({
  userId: req.session?.user?.sub || req.session?.user?.id,
  organizationId: req.currentOrganization?.id || req.session?.currentOrganizationId,
  organizationName: req.currentOrganization?.name
    || req.session?.user?.currentOrganization?.name
    || req.session?.user?.organizations?.find((organization) => (
      organization.id === (req.currentOrganization?.id || req.session?.currentOrganizationId)
    ))?.name,
  name: req.session?.user?.name,
  role: req.currentOrganization?.role || req.session?.user?.currentRole
});

const HR_ADMIN_ORG_ROLES = new Set(['owner', 'admin', 'hr_manager']);
const ORG_ADMIN_ONLY_ROLES = new Set(['owner', 'admin']);

function getRunBlockingIssues(run = {}) {
  const issues = [];
  const errors = Array.isArray(run.errors) ? run.errors : [];
  const employeeErrors = (Array.isArray(run.employees) ? run.employees : [])
    .filter((employee) => employee?.status === 'error');
  const errorCount = Number(run.summary?.errorCount || 0);
  if (errors.length > 0) issues.push(`${errors.length} calculation error(s)`);
  if (employeeErrors.length > 0) issues.push(`${employeeErrors.length} employee calculation failure(s)`);
  if (errorCount > 0) issues.push(`${errorCount} summary error(s)`);
  return Array.from(new Set(issues));
}

function assertRunHasNoBlockingIssues(run) {
  const issues = getRunBlockingIssues(run);
  if (issues.length === 0) return;
  const error = new Error(`Payroll cannot proceed while blocking calculation issues remain: ${issues.join(', ')}. Recalculate after correcting them.`);
  error.statusCode = 409;
  error.code = 'PAYROLL_RUN_HAS_BLOCKING_ERRORS';
  throw error;
}

async function markRunCalculationFailure(run, error) {
  if (!run?._id || !run?.organizationId) return;
  const errorType = String(error?.code || 'RUN_CALCULATION_FAILED');
  const errorMessage = String(error?.message || 'Payroll calculation failed before completion.');
  await PayrollRun.updateOne(
    { _id: run._id, organizationId: run.organizationId, status: 'calculating' },
    {
      $set: { status: 'pending_review' },
      $inc: { 'summary.errorCount': 1 },
      $push: {
        errors: {
          userId: '',
          employeeName: 'Payroll run',
          errorType,
          errorMessage,
          occurredAt: new Date(),
        },
      },
    }
  );
}

function getVisiblePayslipStatusesForRole(role) {
  if (HR_ADMIN_ORG_ROLES.has(role)) {
    // HR/Admin users can see their own draft-to-final lifecycle.
    return ['draft', 'pending_approval', 'approved', 'exported', 'paid', 'revised'];
  }
  return ['approved', 'exported', 'paid'];
}

function requireOrganizationAdminOnly(req, res, next) {
  return requireHRAdmin(req, res, () => {
    const { role } = getUserInfo(req);
    if (!ORG_ADMIN_ONLY_ROLES.has(role)) {
      return res.status(403).json({
        error: 'Only organization admins can retract payroll runs'
      });
    }

    next();
  });
}

// Use the same production-safe issuer resolution as OIDC itself. Falling back
// independently here previously sent roster/payroll-sync calls to localhost
// inside the production container even though login used the live IDP.
const getIdpBaseUrl = () => getIdentityProviderIssuerUrl('http://localhost:4000').replace(/\/$/, '');

function getBearerAccessToken(req) {
  const authHeader = String(req.headers?.authorization || '').trim();
  if (!authHeader.toLowerCase().startsWith('bearer ')) return '';
  return authHeader.substring(7).trim();
}

function getIdpAccessToken(req) {
  return String(req.session?.user?.accessToken || getBearerAccessToken(req) || '').trim();
}

function isIdpUpstreamAuthFailure(error) {
  const status = Number(error?.response?.status || 0);
  return status === 401 || status === 403;
}

function getIdpProxyErrorMessage(error, fallbackMessage) {
  return (
    error?.response?.data?.error ||
    error?.response?.data?.message ||
    error?.message ||
    fallbackMessage
  );
}

function buildIdpListFallback(organizationId, key, syncError) {
  return {
    organizationId,
    [key]: [],
    syncAvailable: false,
    syncError
  };
}

async function fetchIdpOrgMembers(accessToken, organizationId) {
  const idpBaseUrl = getIdpBaseUrl();
  const url = `${idpBaseUrl}/api/organizations/${organizationId}/members`;

  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15000,
  });

  return res.data;
}

async function fetchIdpMemberPayrollSync(accessToken, organizationId, memberId) {
  const idpBaseUrl = getIdpBaseUrl();
  const encodedMemberId = encodeURIComponent(String(memberId || '').trim());
  const url = `${idpBaseUrl}/api/organizations/${organizationId}/members/${encodedMemberId}/payroll-sync`;

  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15000,
  });

  return res.data;
}

async function attachPeopleTransitionPayrollSync(member, organizationId, memberId) {
  const subjectId = String(member?.sub || member?.id || memberId || '').trim();
  if (!subjectId) return member;
  const transitionData = await peopleTransitionsClient.getTransitionSummaries({
    idpOrganizationId: organizationId,
    subjectIds: [subjectId],
  });
  const summary = (Array.isArray(transitionData?.summaries) ? transitionData.summaries : [])
    .find((item) => String(item?.subjectId || '') === subjectId);
  if (!summary?.payrollSync) return member;
  const transitionPayrollSync = {
    ...summary.payrollSync,
    emergencyContact: summary.payrollSync.emergencyContact
      || summary.payrollSync.personalInfo?.emergencyContact,
    dependentsCount: Number(
      summary.payrollSync.dependentsCount
      || summary.payrollSync.dependentsDeclaration?.count
      || 0
    ),
  };
  return {
    ...member,
    payrollSync: {
      ...(member?.payrollSync || {}),
      ...transitionPayrollSync,
      personalInfo: {
        ...(member?.payrollSync?.personalInfo || {}),
        ...(transitionPayrollSync.personalInfo || {}),
      },
      taxInfo: {
        ...(member?.payrollSync?.taxInfo || {}),
        ...(transitionPayrollSync.taxInfo || {}),
      },
    },
    peopleTransition: summary,
  };
}

async function fetchIdpOrgTeams(accessToken, organizationId) {
  const idpBaseUrl = getIdpBaseUrl();
  // The IDP teams router is mounted at /api/teams and retains its
  // organization-scoped route prefix beneath that mount.
  const url = `${idpBaseUrl}/api/teams/organizations/${organizationId}/teams`;

  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15000,
  });

  return res.data;
}

async function updateIdpMemberPayrollSync(accessToken, organizationId, memberId, payload) {
  const idpBaseUrl = getIdpBaseUrl();
  const encodedMemberId = encodeURIComponent(String(memberId || '').trim());
  const url = `${idpBaseUrl}/api/organizations/${organizationId}/members/${encodedMemberId}/payroll-sync`;

  const res = await axios.put(url, payload, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15000,
  });

  return res.data;
}

async function addIdpTeamMember(accessToken, teamId, payload) {
  const idpBaseUrl = getIdpBaseUrl();
  const url = `${idpBaseUrl}/api/teams/${teamId}/members`;

  const res = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15000,
  });

  return res.data;
}

function getPrimaryMemberTeam(member = {}) {
  const teamIds = Array.isArray(member?.teamIds) ? member.teamIds.map((value) => String(value || '').trim()).filter(Boolean) : [];
  const teamNames = Array.isArray(member?.teamNames) ? member.teamNames.map((value) => String(value || '').trim()).filter(Boolean) : [];

  return {
    teamId: teamIds[0] || '',
    teamName: teamNames[0] || '',
  };
}

function buildEmployeeSnapshotFromMember(member = {}, existingEmployeeInfo = {}) {
  const { teamId, teamName } = getPrimaryMemberTeam(member);
  const idpDateOfBirth = member?.payrollSync?.personalInfo?.dateOfBirth
    ? new Date(member.payrollSync.personalInfo.dateOfBirth)
    : null;

  return {
    ...(existingEmployeeInfo || {}),
    name: member.name || existingEmployeeInfo?.name,
    email: member.email || existingEmployeeInfo?.email,
    employeeId: member.employeeId || existingEmployeeInfo?.employeeId,
    department: member.departmentName || '',
    designation: member.designation || existingEmployeeInfo?.designation,
    teamId: teamId || existingEmployeeInfo?.teamId || '',
    teamName: teamName || existingEmployeeInfo?.teamName || '',
    dateOfBirth: idpDateOfBirth || existingEmployeeInfo?.dateOfBirth || null,
    countryName: member?.payrollSync?.personalInfo?.mailingAddress?.country || existingEmployeeInfo?.countryName || '',
    lastSyncedAt: new Date()
  };
}

function normalizePayrollBankAccountType(type = '', country = '') {
  const rawType = String(type || '').trim().toLowerCase();
  if (['checking', 'savings', 'current'].includes(rawType)) {
    return rawType;
  }

  if (rawType === 'salary' || country === 'UK' || country === 'Nigeria') {
    return 'current';
  }

  return 'checking';
}

function buildPayrollBankAccountsFromMember(member = {}, existingBankAccounts = []) {
  const accounts = Array.isArray(member?.payrollSync?.banking?.accounts)
    ? member.payrollSync.banking.accounts
    : [];

  if (accounts.length === 0) {
    return Array.isArray(existingBankAccounts) ? existingBankAccounts : [];
  }

  const hasExplicitPrimary = accounts.some((account) => account?.isPrimary === true);

  return accounts
    .filter((account) => account && (account.bankName || account.accountNumber || account.iban))
    .map((account, index) => {
      const country = String(account.country || member?.payrollSync?.banking?.country || '').trim();
      return {
        isPrimary: hasExplicitPrimary ? account.isPrimary === true : index === 0,
        country,
        accountName: account.accountHolderName || member.name || 'Primary',
        accountNumber: account.accountNumber || '',
        bankName: account.bankName || '',
        branchCode: account.sortCode || account.bankCode || '',
        swiftCode: account.bicSwift || '',
        routingNumber: account.routingNumber || '',
        iban: account.iban || '',
        accountType: normalizePayrollBankAccountType(account.accountType, country),
        splitPercentage: Number(account.percentage || 100),
        isVerified: false,
      };
    });
}

function buildEmergencyContactFromMember(member = {}, existingEmergencyContact = null) {
  const contact = member?.payrollSync?.emergencyContact;
  if (!contact || (!contact.name && !contact.phone && !contact.email)) {
    return existingEmergencyContact;
  }

  return {
    ...(existingEmergencyContact || {}),
    name: contact.name || existingEmergencyContact?.name || '',
    relationship: contact.relationship || existingEmergencyContact?.relationship || '',
    phone: contact.phone || existingEmergencyContact?.phone || '',
    email: contact.email || existingEmergencyContact?.email || '',
  };
}

function applyPayrollSyncFromMember(profile, member = {}, options = {}) {
  profile.employeeInfo = buildEmployeeSnapshotFromMember(member, profile.employeeInfo);
  // An approved Recruiter onboarding snapshot is imported only while Payroll
  // has no account. Later refreshes must never overwrite an admin update or an
  // HR-approved employee request.
  if (options.importLegacyBanking !== false
    && (!Array.isArray(profile.bankAccounts) || profile.bankAccounts.length === 0)) {
    profile.bankAccounts = buildPayrollBankAccountsFromMember(member, []);
  }
  profile.emergencyContact = buildEmergencyContactFromMember(member, profile.emergencyContact);

  // Approved onboarding dependents are imported once. Payroll is authoritative
  // as soon as any local dependent or declaration exists.
  const legacyDependents = Array.isArray(member?.payrollSync?.dependents) ? member.payrollSync.dependents : [];
  const hasLocalDependentDecision = (Array.isArray(profile.dependents) && profile.dependents.length > 0)
    || ['none', 'provided'].includes(String(profile?.dependentsDeclaration?.status || ''));
  if (!hasLocalDependentDecision && legacyDependents.length > 0) {
    profile.dependents = legacyDependents.map((dependent) => ({
      name: dependent.name,
      relationship: dependent.relationship || 'other',
      dateOfBirth: dependent.dateOfBirth,
      taxDependent: dependent.taxDependent !== false,
      benefitEligible: dependent.benefitEligible !== false,
      isBeneficiary: dependent.isBeneficiary === true,
      beneficiaryPercentage: Number(dependent.beneficiaryPercentage || 0),
    }));
    profile.dependentsDeclaration = { status: 'provided', confirmedAt: new Date(), lastUpdated: new Date() };
  } else if (!hasLocalDependentDecision && member?.payrollSync?.dependentsDeclaration?.status === 'none') {
    profile.dependentsDeclaration = { status: 'none', confirmedAt: new Date(), lastUpdated: new Date() };
  }

  const taxId = String(member?.payrollSync?.taxInfo?.taxId || '').trim();
  const dependentsCount = Array.isArray(profile.dependents) && profile.dependents.length
    ? profile.dependents.filter((dependent) => dependent.taxDependent !== false).length
    : Number(member?.payrollSync?.dependentsCount || 0);
  if (taxId || (dependentsCount > 0 && Number(profile?.taxConfig?.dependents || 0) === 0)) {
    profile.taxConfig = {
      ...(profile.taxConfig || {}),
      ...(taxId ? { taxId } : {}),
      ...(dependentsCount > 0 ? { dependents: dependentsCount } : {}),
    };
  }

  return profile;
}

function deriveLegacyCalculationRegime(taxConfig = {}) {
  if (taxConfig.taxRegime === 'exempt') return 'none';

  if (taxConfig.calculationMode === 'builtin' || taxConfig.calculationMode === 'configured') {
    if (taxConfig.jurisdictionCode === 'GB') return 'progressive_uk';
    if (taxConfig.jurisdictionCode === 'US') return 'progressive_us';
    return 'progressive_generic';
  }

  if (taxConfig.manualCalculationType === 'none') return 'none';
  if (taxConfig.manualCalculationType === 'flat') return 'flat';
  return 'progressive_generic';
}

function normalizeTaxConfigPayload(input) {
  if (input === undefined) return undefined;

  const normalized = taxService.normalizeConfig(input || {});

  return {
    ...input,
    ...normalized,
    calculationRegime: deriveLegacyCalculationRegime(normalized),
    jurisdictionConfigId: normalized.jurisdictionConfigId || null,
    jurisdictionVersionId: normalized.jurisdictionVersionId || null,
    employeeTaxInputs: (normalized.employeeTaxInputs && typeof normalized.employeeTaxInputs === 'object')
      ? normalized.employeeTaxInputs
      : {},
    taxValidation: normalizeTaxValidationPayload(normalized.taxValidation),
    withholdingMode: taxWithholdingTreatmentService.normalizeMode(input?.withholdingMode),
    withholdingReason: String(input?.withholdingReason || '').trim(),
    withholdingEffectiveFrom: input?.withholdingEffectiveFrom || null,
    withholdingEffectiveTo: input?.withholdingEffectiveTo || null,
    flatTaxRate: Number(normalized.flatTaxRate || 0),
    manualTaxFreeAllowance: Number(normalized.manualTaxFreeAllowance || 0),
    socialSecurityRate: Number(normalized.socialSecurityRate || 0),
    socialSecurityCap: Number(normalized.socialSecurityCap || 0),
    additionalWithholding: Number(normalized.additionalWithholding || 0),
    otherIncome: Number(normalized.otherIncome || 0),
    deductionsAdjustment: Number(normalized.deductionsAdjustment || 0),
    taxCredits: Number(normalized.taxCredits || 0),
    dependents: Number(normalized.dependents || 0),
    multipleJobs: !!normalized.multipleJobs,
    customBrackets: Array.isArray(normalized.customBrackets)
      ? normalized.customBrackets.map((bracket) => ({
        min: Number(bracket.min || 0),
        max: bracket.max === null || bracket.max === undefined ? null : Number(bracket.max),
        rate: Number(bracket.rate || 0),
      }))
      : [],
  };
}

function validateTaxWithholdingTreatment(taxConfig = {}) {
  if (taxConfig.withholdingMode !== 'employee_responsible') return;
  if (String(taxConfig.withholdingReason || '').trim().length < 5) {
    const error = new Error('Enter a reason for assigning tax responsibility to the employee.');
    error.statusCode = 400;
    error.code = 'TAX_RESPONSIBILITY_REASON_REQUIRED';
    throw error;
  }
  const effectiveFrom = new Date(taxConfig.withholdingEffectiveFrom || '');
  if (Number.isNaN(effectiveFrom.getTime())) {
    const error = new Error('An effective-from date is required when the employee handles their own tax.');
    error.statusCode = 400;
    error.code = 'TAX_RESPONSIBILITY_EFFECTIVE_DATE_REQUIRED';
    throw error;
  }
  if (taxConfig.withholdingEffectiveTo) {
    const effectiveTo = new Date(taxConfig.withholdingEffectiveTo);
    if (Number.isNaN(effectiveTo.getTime()) || effectiveTo < effectiveFrom) {
      const error = new Error('The tax responsibility end date must be on or after its start date.');
      error.statusCode = 400;
      error.code = 'TAX_RESPONSIBILITY_DATE_RANGE_INVALID';
      throw error;
    }
  }
}

function comparableDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function normalizeTaxValidationPayload(input = {}) {
  const statusMap = {
    valid: 'valid',
    ready: 'valid',
    configured: 'valid',
    success: 'valid',
    ok: 'valid',
    warning: 'warning',
    needs_configuration: 'warning',
    pending_configuration: 'warning',
    error: 'error',
    invalid: 'error',
    failed: 'error',
    unknown: 'unknown',
    pending: 'unknown',
  };

  const rawStatus = String(input?.status || '').trim().toLowerCase();
  const normalizedStatus = statusMap[rawStatus] || 'unknown';
  const validatedAt = input?.validatedAt ? new Date(input.validatedAt) : null;

  return {
    status: normalizedStatus,
    messages: Array.isArray(input?.messages)
      ? input.messages.map((message) => String(message || '').trim()).filter(Boolean)
      : [],
    validatedAt: validatedAt && !Number.isNaN(validatedAt.getTime()) ? validatedAt : null,
  };
}

function normalizePayrollFlagsPayload(input, basicSalary, existingFlags = {}, workTerms = {}) {
  const merged = {
    excludeFromNextRun: false,
    ...(existingFlags || {}),
    ...(input || {}),
  };
  const manualExclusionReason = 'Excluded from payroll run by payroll admin.';
  const inputHasManualPreference = !!input
    && Object.prototype.hasOwnProperty.call(input, 'excludeFromNextRun');

  if (inputHasManualPreference) {
    merged.excludeFromNextRun = input.excludeFromNextRun === true;
    merged.includeInNextRun = !merged.excludeFromNextRun;
    merged.requiresReview = false;
    merged.reviewReason = merged.excludeFromNextRun ? manualExclusionReason : '';
  } else if (merged.excludeFromNextRun !== true
    && String(merged.reviewReason || '').trim() === manualExclusionReason) {
    // Backfill the explicit preference for profiles excluded by the legacy UI.
    merged.excludeFromNextRun = true;
  }

  if (!hasPayConfiguration({ basicSalary, workTerms })) {
    merged.includeInNextRun = false;
    merged.requiresReview = true;
    if (!String(merged.reviewReason || '').trim()) {
      merged.reviewReason = 'Automatically excluded from payroll until payroll setup is completed.';
    }
  } else if (merged.excludeFromNextRun) {
    merged.includeInNextRun = false;
    merged.requiresReview = false;
    merged.reviewReason = manualExclusionReason;
  }

  return merged;
}

function roundMoney(value) {
  const parsed = Number(value || 0);
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isEffectiveOn(item, date, startKey = 'effectiveFrom', endKey = 'effectiveTo') {
  const asOf = new Date(date);
  const start = item?.[startKey] ? new Date(item[startKey]) : null;
  const end = item?.[endKey] ? new Date(item[endKey]) : null;
  return (!start || asOf >= start) && (!end || asOf <= end);
}

function extractValidationMessages(error) {
  if (!error || typeof error !== 'object') {
    return [];
  }

  return Object.values(error.errors || {})
    .map((entry) => String(entry?.message || '').trim())
    .filter(Boolean);
}

function sumAllowanceAmount(allowances = [], { taxableOnly = false } = {}) {
  return roundMoney(
    (Array.isArray(allowances) ? allowances : [])
      .filter((item) => item && item.isActive !== false)
      .filter((item) => !taxableOnly || item.isTaxable !== false)
      .reduce((sum, item) => sum + Math.max(0, toNumber(item.amount)), 0)
  );
}

function sumRecurringDeductionAmount(deductions = [], grossPay = 0, { isPreTax = false } = {}) {
  return roundMoney(
    (Array.isArray(deductions) ? deductions : [])
      .filter((item) => item && item.isActive !== false)
      .filter((item) => !!item.isPreTax === isPreTax)
      .reduce((sum, item) => {
        if (item.isPercentage) {
          return sum + (grossPay * (Math.max(0, toNumber(item.percentage)) / 100));
        }
        return sum + Math.max(0, toNumber(item.amount));
      }, 0)
  );
}

// =====================================================
// PAYROLL PROFILE ROUTES (Employee & HR Admin)
// =====================================================

/**
 * GET /api/payroll/profile/me
 * Get current user's payroll profile
 */
router.get('/profile/me', requireAuth, async (req, res) => {
  try {
    const { userId, organizationId } = getUserInfo(req);

    let profile = await PayrollProfile.findOne({ userId, organizationId });

    if (!profile) {
      // Create a basic profile if none exists
      await organizationCurrencyService.getPolicy(organizationId, {
        userId,
        name: req.session.user?.name,
      });
      const defaultPaymentCurrency = await organizationCurrencyService.getDefaultPaymentCurrency(organizationId);
      profile = new PayrollProfile({
        userId,
        organizationId,
        basicSalary: 0,
        currency: defaultPaymentCurrency,
        payrollFlags: normalizePayrollFlagsPayload({}, 0, {}),
        employeeInfo: {
          name: req.session.user?.name,
          email: req.session.user?.email
        }
      });
      await profile.save();
    }

    // Return limited info for employees
    const response = {
      id: profile._id,
      employeeInfo: profile.employeeInfo,
      basicSalary: profile.basicSalary,
      workTerms: profile.workTerms,
      currency: profile.currency,
      salaryGrade: profile.salaryGrade,
      allowances: profile.allowances,
      recurringDeductions: profile.recurringDeductions,
      benefitItems: profile.benefitItems,
      benefits: profile.benefits,
      status: profile.status,
      grossMonthlySalary: profile.grossMonthlySalary,
      totalAllowances: profile.totalAllowances,
      totalRecurringDeductions: profile.totalRecurringDeductions
    };

    res.json(response);
  } catch (err) {
    console.error('Get Profile Error:', err);
    res.status(500).json({ error: 'Failed to fetch payroll profile' });
  }
});

/**
 * GET /api/payroll/dashboard-stats
 * Get current user's dashboard statistics (YTD, next payday, etc.)
 */
router.get('/dashboard-stats', requireAuth, async (req, res) => {
  try {
    const { userId, organizationId, role } = getUserInfo(req);
    const currentYear = new Date().getFullYear();
    const visibleStatuses = getVisiblePayslipStatusesForRole(role);

    // Get profile for salary info
    const profile = await PayrollProfile.findOne({ userId, organizationId });

    // Get payslips for YTD calculations
    const payslips = await Payslip.find({
      userId,
      organizationId,
      'payPeriod.year': currentYear,
      status: { $in: visibleStatuses }
    }).sort({ 'payPeriod.month': -1 });

    const reporting = await payrollReportingService.preparePayslips(
      organizationId,
      payslips
    );

    // Get next payday from latest payroll run
    const nextRun = await PayrollRun.findOne({
      organizationId,
      status: { $in: ['draft', 'calculating', 'calculated', 'pending_review', 'pending_approval', 'approved'] },
      'payPeriod.paymentDate': { $gte: new Date() }
    }).sort({ 'payPeriod.paymentDate': 1 });

    // Calculate next scheduled payday (default: end of next month)
    let nextPayday = null;
    if (nextRun) {
      nextPayday = nextRun.payPeriod.paymentDate;
    } else {
      // Default: last day of current/next month
      const today = new Date();
      const currentMonth = today.getDate() > 25 ? today.getMonth() + 1 : today.getMonth();
      nextPayday = new Date(today.getFullYear(), currentMonth + 1, 0);
    }

    res.json({
      ytd: {
        grossEarnings: reporting.totals.grossPay,
        totalTax: reporting.totals.totalTax,
        netPay: reporting.totals.netPay
      },
      totalPayslips: payslips.length,
      nextPayday: nextPayday?.toISOString().split('T')[0] || null,
      ...reportingMetadata(reporting),
      paymentCurrency: profile?.currency || 'USD',
      profileStatus: profile?.status || 'pending_setup',
      hasProfile: !!profile && hasPayConfiguration(profile)
    });
  } catch (err) {
    console.error('Get Dashboard Stats Error:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

/**
 * GET /api/payroll/admin/overview
 * Lightweight stats for HR dashboard widgets
 */
router.get('/admin/overview', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const accessToken = req.session?.user?.accessToken;

    const [
      activeProfiles,
      pendingCompensationRequests,
      pendingRuns,
      latestRun
    ] = await Promise.all([
      PayrollProfile.find({ organizationId, isActive: true }, { userId: 1, basicSalary: 1, workTerms: 1 }).lean(),
      CompensationRequest.countDocuments({ organizationId, status: { $in: ['pending', 'approved_l1'] } }),
      PayrollRun.countDocuments({ organizationId, status: { $in: ['pending_review', 'pending_approval'] } }),
      PayrollRun.getLatestByOrganization(organizationId).lean()
    ]);

    let activeEmployees = activeProfiles.length;
    let profilesNeedingSetup = activeProfiles.filter((p) => !hasPayConfiguration(p)).length;

    const idpSync = {
      source: 'payroll_profiles',
      totalMembers: activeEmployees,
      missingProfiles: 0,
      syncedProfiles: activeProfiles.length,
      failed: false
    };

    if (accessToken) {
      try {
        const idpData = await fetchIdpOrgMembers(accessToken, organizationId);
        const idpMembers = Array.isArray(idpData?.members) ? idpData.members : [];
        const memberIds = Array.from(new Set(
          idpMembers
            .map((m) => String(m?.sub || m?.id || '').trim())
            .filter(Boolean)
        ));

        if (memberIds.length > 0) {
          const profileByUserId = new Map(
            activeProfiles.map((profile) => [String(profile.userId), profile])
          );

          let missingProfiles = 0;
          let incompleteProfiles = 0;

          for (const memberId of memberIds) {
            const profile = profileByUserId.get(memberId);
            if (!profile) {
              missingProfiles += 1;
              continue;
            }
            if (!hasPayConfiguration(profile)) {
              incompleteProfiles += 1;
            }
          }

          activeEmployees = memberIds.length;
          profilesNeedingSetup = missingProfiles + incompleteProfiles;
          idpSync.source = 'identity_provider';
          idpSync.totalMembers = memberIds.length;
          idpSync.missingProfiles = missingProfiles;
          idpSync.syncedProfiles = memberIds.length - missingProfiles;
          idpSync.failed = false;
        }
      } catch (syncErr) {
        console.warn('Admin overview IDP sync failed:', syncErr?.message || syncErr);
        idpSync.failed = true;
      }
    }

    res.json({
      activeEmployees,
      profilesNeedingSetup,
      pendingCompensationRequests,
      pendingRuns,
      latestRun,
      idpSync
    });
  } catch (err) {
    console.error('Admin Overview Error:', err);
    res.status(500).json({ error: 'Failed to fetch admin overview' });
  }
});

/**
 * GET /api/payroll/idp/members
 * Proxy to IDP organization members (HR Admin only)
 *
 * This is used to list employees from the Identity Provider even if they haven't logged into Payroll yet.
 */
router.get('/idp/members', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const accessToken = getIdpAccessToken(req);

    if (!organizationId) {
      return res.status(400).json({ error: 'No organization selected' });
    }

    if (!accessToken) {
      return res.json(buildIdpListFallback(
        organizationId,
        'members',
        'Identity Provider sync is currently unavailable for this session'
      ));
    }

    const data = await fetchIdpOrgMembers(accessToken, organizationId);
    const members = Array.isArray(data?.members) ? data.members : [];
    let transitionSyncAvailable = true;
    let transitionSyncError = '';
    let summaries = [];
    try {
      const subjectIds = members
        .map((member) => String(member?.id || member?.sub || '').trim())
        .filter(Boolean);
      if (subjectIds.length) {
        const transitionData = await peopleTransitionsClient.getTransitionSummaries({
          idpOrganizationId: organizationId,
          subjectIds,
        });
        summaries = Array.isArray(transitionData?.summaries) ? transitionData.summaries : [];
      }
    } catch (transitionError) {
      transitionSyncAvailable = false;
      transitionSyncError = transitionError.message || 'People Transitions sync is unavailable';
      console.error('People Transitions Summary Error:', transitionError.response || transitionError.message || transitionError);
    }
    const summaryBySubjectId = new Map(summaries.map((summary) => [String(summary.subjectId), summary]));
    res.json({
      ...data,
      organizationId: data?.organizationId || organizationId,
      members: members.map((member) => {
        const peopleTransition = summaryBySubjectId.get(String(member?.id || member?.sub || '')) || null;
        return {
          ...member,
          ...(peopleTransition?.payrollSync
            ? {
                payrollSync: {
                  ...(member?.payrollSync || {}),
                  ...peopleTransition.payrollSync,
                  personalInfo: {
                    ...(member?.payrollSync?.personalInfo || {}),
                    ...(peopleTransition.payrollSync.personalInfo || {}),
                  },
                  taxInfo: {
                    ...(member?.payrollSync?.taxInfo || {}),
                    ...(peopleTransition.payrollSync.taxInfo || {}),
                  },
                },
              }
            : {}),
          peopleTransition,
        };
      }),
      syncAvailable: true,
      transitionSyncAvailable,
      transitionSyncError,
    });
  } catch (err) {
    console.error('IDP Members Proxy Error:', err?.response?.data || err.message || err);
    if (isIdpUpstreamAuthFailure(err)) {
      const { organizationId } = getUserInfo(req);
      return res.json(buildIdpListFallback(
        organizationId,
        'members',
        'Identity Provider session expired while loading members'
      ));
    }
    res.status(err?.response?.status || 500).json({ error: 'Failed to fetch IDP members' });
  }
});

router.get('/idp/teams', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const accessToken = getIdpAccessToken(req);

    if (!organizationId) {
      return res.status(400).json({ error: 'No organization selected' });
    }

    if (!accessToken) {
      return res.json(buildIdpListFallback(
        organizationId,
        'teams',
        'Identity Provider sync is currently unavailable for this session'
      ));
    }

    const data = await fetchIdpOrgTeams(accessToken, organizationId);
    const teams = Array.isArray(data) ? data : (Array.isArray(data?.teams) ? data.teams : []);

    res.json({
      organizationId,
      teams,
      syncAvailable: true
    });
  } catch (err) {
    console.error('IDP Teams Proxy Error:', err?.response?.data || err.message || err);
    if (isIdpUpstreamAuthFailure(err)) {
      const { organizationId } = getUserInfo(req);
      return res.json(buildIdpListFallback(
        organizationId,
        'teams',
        'Identity Provider session expired while loading teams'
      ));
    }
    res.status(err?.response?.status || 500).json({ error: 'Failed to fetch IDP teams' });
  }
});

router.post('/idp/teams/:teamId/members', requireHRAdmin, async (req, res) => {
  try {
    const accessToken = getIdpAccessToken(req);
    const { teamId } = req.params;
    const { accountId, role = 'member' } = req.body || {};

    if (!accessToken) {
      return res.status(502).json({ error: 'Identity Provider sync is currently unavailable' });
    }

    if (!teamId || !accountId) {
      return res.status(400).json({ error: 'teamId and accountId are required' });
    }

    const data = await addIdpTeamMember(accessToken, teamId, { accountId, role });
    res.status(201).json(data);
  } catch (err) {
    console.error('IDP Team Member Add Proxy Error:', err?.response?.data || err.message || err);
    const status = isIdpUpstreamAuthFailure(err) ? 502 : (err?.response?.status || 500);
    res.status(status).json({
      error: getIdpProxyErrorMessage(err, 'Failed to assign member to team')
    });
  }
});

router.post('/idp/onboarding/assign', requireHRAdmin, async (req, res) => {
  try {
    const userInfo = getUserInfo(req);
    const { organizationId } = userInfo;
    const memberId = String(req.body?.memberId || '').trim();
    const dueAt = req.body?.dueAt;

    if (!organizationId) {
      return res.status(400).json({ error: 'No organization selected' });
    }

    if (!memberId) {
      return res.status(400).json({ error: 'memberId is required' });
    }

    const data = await peopleTransitionsClient.startMemberOnboarding({
      idpOrganizationId: organizationId,
      member: {
        id: memberId,
        email: req.body?.email,
        name: req.body?.name,
        phone: req.body?.phone,
        employeeId: req.body?.employeeId,
        designation: req.body?.designation,
        departmentId: req.body?.departmentId,
        departmentName: req.body?.departmentName,
        role: req.body?.role,
      },
      dueAt,
      requestedBy: {
        subjectId: userInfo.userId,
        email: req.session?.user?.email,
        name: userInfo.name,
      },
    });

    res.status(201).json(data);
  } catch (err) {
    console.error('People Transitions Start Error:', err?.response || err.message || err);
    res.status(err.statusCode || 502).json({
      error: err.message || 'Failed to start onboarding in People Transitions'
    });
  }
});

router.post('/idp/onboarding/members/:memberId/reminder', requireHRAdmin, async (req, res) => {
  try {
    const userInfo = getUserInfo(req);
    const { organizationId } = userInfo;
    const memberId = String(req.params?.memberId || '').trim();

    if (!organizationId) {
      return res.status(400).json({ error: 'No organization selected' });
    }

    if (!memberId) {
      return res.status(400).json({ error: 'memberId is required' });
    }

    const data = await peopleTransitionsClient.remindMemberOnboarding({
      idpOrganizationId: organizationId,
      subjectId: memberId,
      requestedBy: {
        subjectId: userInfo.userId,
        email: req.session?.user?.email,
        name: userInfo.name,
      },
    });
    res.json(data);
  } catch (err) {
    console.error('People Transitions Reminder Error:', err?.response || err.message || err);
    res.status(err.statusCode || 502).json({
      error: err.message || 'Failed to send onboarding reminder'
    });
  }
});

router.patch('/idp/onboarding/members/:memberId/status', requireHRAdmin, async (req, res) => {
  res.status(410).json({
    error: 'Manual onboarding status overrides have been retired. Complete and approve onboarding in Recruiter People Transitions, or configure the employee manually in Payroll.',
  });
});

/**
 * GET /api/payroll/profiles
 * Get all payroll profiles (HR Admin only)
 */
router.get('/profiles', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const { status, teamId, department, limit = 50, skip = 0 } = req.query;

    const query = { organizationId };
    if (status) query.status = status;
    if (teamId) query['employeeInfo.teamId'] = teamId;
    if (department) query['employeeInfo.department'] = department;

    const profiles = await PayrollProfile.find(query)
      .sort({ 'employeeInfo.name': 1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    const total = await PayrollProfile.countDocuments(query);

    res.json({
      profiles,
      total,
      limit: parseInt(limit),
      skip: parseInt(skip)
    });
  } catch (err) {
    console.error('Get Profiles Error:', err);
    res.status(500).json({ error: 'Failed to fetch profiles' });
  }
});

/**
 * GET /api/payroll/profiles/:userId
 * Get specific user's payroll profile (HR Admin only)
 */
router.get('/profiles/:userId', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const accessToken = getIdpAccessToken(req);
    let idpSync = null;

    let profile = await PayrollProfile.findOne({
      userId: req.params.userId,
      organizationId
    }).populate('salaryGrade.gradeId');

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    if (accessToken) {
      try {
        let member = await fetchIdpMemberPayrollSync(accessToken, organizationId, req.params.userId);
        member = await attachPeopleTransitionPayrollSync(member, organizationId, req.params.userId);
        if (member) {
          idpSync = member;
          applyPayrollSyncFromMember(profile, member);
          await profile.save();
          profile = await PayrollProfile.findOne({
            userId: req.params.userId,
            organizationId
          }).populate('salaryGrade.gradeId');
        }
      } catch (syncErr) {
        console.warn('Profile IDP sync failed:', syncErr?.message || syncErr);
      }
    }

    const automationResult = await payrollCountryAutomationService.reconcileProfile(profile, organizationId, {
      countryHint: idpSync?.payrollSync?.personalInfo?.mailingAddress?.country,
      validateBankDetails: false,
    });
    payrollCountryAutomationService.applyReadiness(profile, automationResult);
    await profile.save();

    const payload = profile.toObject({ virtuals: true });
    if (idpSync) {
      payload.idpSync = idpSync;
    }

    res.json(payload);
  } catch (err) {
    console.error('Get Profile Error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

/**
 * POST /api/payroll/profiles/:userId/tax-preview
 * Preview tax and statutory calculations for the current profile form state
 */
router.post('/profiles/:userId/tax-preview', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const profile = await PayrollProfile.findOne({
      userId: req.params.userId,
      organizationId
    });

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const basicSalary = Math.max(0, toNumber(req.body?.basicSalary, profile.basicSalary || 0));
    const currency = String(req.body?.currency || profile.currency || 'USD').trim().toUpperCase() || 'USD';
    const payFrequency = String(req.body?.payFrequency || profile.payFrequency || 'monthly').trim() || 'monthly';
    const allowances = Array.isArray(req.body?.allowances) ? req.body.allowances : (profile.allowances || []);
    const benefitItems = Array.isArray(req.body?.benefitItems) ? req.body.benefitItems : (profile.benefitItems || []);
    const recurringDeductions = Array.isArray(req.body?.recurringDeductions)
      ? req.body.recurringDeductions
      : (profile.recurringDeductions || []);
    const employeeInfo = {
      ...(profile.employeeInfo || {}),
      ...(req.body?.employeeInfo || {}),
    };
    const taxConfig = normalizeTaxConfigPayload(
      req.body?.taxConfig !== undefined ? req.body.taxConfig : (profile.taxConfig || {})
    ) || {};
    validateTaxWithholdingTreatment(taxConfig);
    const statutoryContributions = {
      ...(profile.statutoryContributions || {}),
      ...(req.body?.statutoryContributions || {}),
    };

    const previewDate = req.body?.paymentDate ? new Date(req.body.paymentDate) : new Date();
    const jurisdictionCode = String(taxConfig.jurisdictionCode || '').toUpperCase();
    const componentReviewErrors = [];
    const activeAllowances = allowances
      .filter((item) => item && item.isActive !== false && isEffectiveOn(item, previewDate));
    const activeBenefits = benefitItems
      .filter((item) => item && item.isActive !== false && isEffectiveOn(item, previewDate));
    const activeRecurringDeductions = recurringDeductions
      .filter((item) => item && item.isActive !== false && isEffectiveOn(item, previewDate, 'startDate', 'endDate'));
    const resolvedAllowances = activeAllowances
      .map((item) => payComponentTaxService.resolveComponent(item, previewDate, jurisdictionCode));
    const resolvedBenefits = activeBenefits
      .map((item) => payComponentTaxService.resolveComponent(item, previewDate, jurisdictionCode));
    [...resolvedAllowances, ...resolvedBenefits].forEach((item) => {
      if (item.requiresReview) componentReviewErrors.push(item.reviewMessage);
    });
    const cashAllowances = resolvedAllowances.reduce((sum, item) => sum + (item.cashPayable ? item.value : 0), 0);
    const cashBenefits = resolvedBenefits.reduce((sum, item) => sum + (item.cashPayable ? item.value : 0), 0);
    const taxableAllowances = resolvedAllowances.reduce((sum, item) => sum + item.taxableAmount, 0);
    const taxableBenefits = resolvedBenefits.reduce((sum, item) => sum + item.taxableAmount, 0);
    const grossPay = roundMoney(basicSalary + cashAllowances + cashBenefits);
    const taxableEarnings = roundMoney(basicSalary + taxableAllowances + taxableBenefits);
    const ungovernedPreTax = activeRecurringDeductions.find((item) => item?.isPreTax);
    if (ungovernedPreTax) {
      componentReviewErrors.push(`Recurring deduction "${ungovernedPreTax.name || 'Unnamed deduction'}" cannot reduce taxable income from a profile flag. Configure it through the statutory pack.`);
    }
    const recurringPreTaxDeductions = 0;
    const recurringPostTaxDeductions = sumRecurringDeductionAmount(activeRecurringDeductions, grossPay, { isPreTax: false });
    const effectivePension = taxService.resolveEffectivePensionSettings(taxConfig, statutoryContributions);
    const pensionIsPackManaged = jurisdictionCode === 'NG';
    const employeePensionAmount = effectivePension.enabled && !pensionIsPackManaged
      ? roundMoney(grossPay * (toNumber(effectivePension.employeePercent) / 100))
      : 0;
    const employerPensionAmount = effectivePension.enabled && !pensionIsPackManaged
      ? roundMoney(grossPay * (toNumber(effectivePension.employerPercent) / 100))
      : 0;
    // Voluntary profile pension settings are post-tax unless the statutory pack
    // explicitly owns and limits the relief.
    const preTaxDeductions = 0;
    const taxableIncome = Math.max(0, roundMoney(taxableEarnings));

    const taxResult = await taxService.calculatePayrollTaxes({
      organizationId,
      taxConfig,
      statutoryContributions,
      grossPay,
      taxableIncome,
      basicSalary,
      preTaxDeductions,
      paymentDate: previewDate,
      payFrequency,
      employeeInfo,
      ytdGrossPay: 0,
      ytdTaxableIncome: 0,
      currency,
      statutoryBases: {
        pensionablePay: roundMoney(basicSalary + activeAllowances
          .filter((item) => ['hra', 'transport'].includes(item?.type))
          .reduce((sum, item) => sum + Math.max(0, toNumber(item?.amount)), 0)),
        socialSecurityPay: taxableEarnings,
        insurablePay: taxableEarnings,
      },
    });

    const withholdingTreatment = taxWithholdingTreatmentService.applyTaxWithholdingTreatment(
      taxResult,
      taxConfig,
      previewDate
    );
    const statutoryDeductions = roundMoney(withholdingTreatment.employeeStatutoryAmount);
    const incomeTax = roundMoney(withholdingTreatment.incomeTaxAmount);
    const estimatedEmployeeDeductions = roundMoney(
      recurringPreTaxDeductions
      + employeePensionAmount
      + statutoryDeductions
      + incomeTax
      + recurringPostTaxDeductions
    );
    const estimatedNetPay = roundMoney(grossPay - estimatedEmployeeDeductions);

    res.json({
      currency,
      payFrequency,
      calculationMode: taxConfig.calculationMode,
      withholdingTreatment: {
        mode: withholdingTreatment.mode,
        employeeResponsible: withholdingTreatment.employeeResponsible,
        reason: withholdingTreatment.reason,
      },
      validationErrors: [...componentReviewErrors, ...(Array.isArray(taxResult?.validationErrors) ? taxResult.validationErrors : [])],
      blockingErrors: [...componentReviewErrors, ...(Array.isArray(taxResult?.blockingErrors) ? taxResult.blockingErrors : [])],
      payrollRunnable: componentReviewErrors.length === 0 && taxResult?.payrollRunnable !== false,
      compliance: taxResult?.compliance || {},
      calculationCurrency: taxResult?.calculationCurrency || currency,
      currencyConversion: taxResult?.currencyConversion || null,
      jurisdictionVersion: taxResult?.jurisdictionVersion ? {
        _id: taxResult.jurisdictionVersion._id,
        label: taxResult.jurisdictionVersion.label,
        versionNumber: taxResult.jurisdictionVersion.versionNumber,
        effectiveFrom: taxResult.jurisdictionVersion.effectiveFrom,
        effectiveTo: taxResult.jurisdictionVersion.effectiveTo,
      } : null,
      summary: {
        basicSalary: roundMoney(basicSalary),
        grossPay,
        taxableBenefits: roundMoney(taxableBenefits),
        taxableEarnings,
        recurringPreTaxDeductions,
        recurringPostTaxDeductions,
        employeePensionAmount,
        employerPensionAmount,
        statutoryEmployerContributions: roundMoney(taxResult?.statutoryContributions?.totalEmployerAmount || 0),
        statutoryDeductions,
        incomeTax,
        estimatedEmployeeDeductions,
        estimatedNetPay,
      },
      pension: {
        enabled: effectivePension.enabled,
        employeePercent: roundMoney(effectivePension.employeePercent),
        employerPercent: roundMoney(effectivePension.employerPercent),
        source: effectivePension.source,
      },
      incomeTax: {
        ...(taxResult?.incomeTax || {}),
        taxAmount: incomeTax,
        method: withholdingTreatment.employeeResponsible
          ? 'employee_responsible'
          : taxResult?.incomeTax?.method,
        notes: [
          ...(Array.isArray(taxResult?.incomeTax?.notes) ? taxResult.incomeTax.notes : []),
          ...(withholdingTreatment.employeeResponsible
            ? ['No employee tax will be withheld because this employee is responsible for their own tax.']
            : []),
        ],
      },
      statutoryContributions: {
        ...(taxResult?.statutoryContributions || {}),
        totalAmount: statutoryDeductions,
        components: withholdingTreatment.statutoryComponents,
      },
    });
  } catch (err) {
    console.error('Tax Preview Error:', err);
    res.status(err.statusCode || 500).json({
      error: err.statusCode ? err.message : 'Failed to preview payroll tax',
      details: err.message,
      code: err.code,
    });
  }
});

/**
 * PUT /api/payroll/profiles/:userId
 * Update user's payroll profile (HR Admin only)
 */
router.put('/profiles/:userId', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId, organizationName, userId: adminId, name: adminName } = getUserInfo(req);
    const accessToken = getIdpAccessToken(req);
    const {
      basicSalary,
      currency,
      payFrequency,
      workTerms,
      employeeInfo,
      allowances,
      recurringDeductions,
      benefits,
      benefitItems,
      taxConfig,
      statutoryContributions,
      bankAccounts,
      payrollFlags,
      status,
      isActive,
      terminationDate,
      terminationReason,
      notes,
      tags,
      employerEntityId,
      taxAssignment,
      idpProfileSync
    } = req.body || {};
    const normalizedTaxConfig = normalizeTaxConfigPayload(taxConfig);
    if (normalizedTaxConfig !== undefined) validateTaxWithholdingTreatment(normalizedTaxConfig);
    const normalizedBasicSalary = Math.max(0, toNumber(basicSalary, 0));
    let syncedMember = null;

    if (idpProfileSync !== undefined) {
      if (!accessToken) {
        return res.status(502).json({ error: 'Identity Provider sync is currently unavailable' });
      }

      try {
        syncedMember = await updateIdpMemberPayrollSync(accessToken, organizationId, req.params.userId, idpProfileSync);
      } catch (syncErr) {
        console.error('Update IDP Member Payroll Sync Error:', syncErr?.response?.data || syncErr.message || syncErr);
        const statusCode = isIdpUpstreamAuthFailure(syncErr) ? 502 : (syncErr?.response?.status || 500);
        return res.status(statusCode).json({
          error: getIdpProxyErrorMessage(syncErr, 'Failed to update employee profile in Identity Provider')
        });
      }
    }

    let profile = await PayrollProfile.findOne({
      userId: req.params.userId,
      organizationId
    });

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Track salary changes
    if (basicSalary !== undefined) {
      if (normalizedBasicSalary !== Number(profile.basicSalary)) {
        profile.recordSalaryChange(normalizedBasicSalary, 'market_adjustment', adminId, adminName, 'Updated by HR');
      } else {
        profile.basicSalary = normalizedBasicSalary;
      }
    }

    // Update other fields
    if (currency !== undefined) {
      profile.currency = String(currency || '').trim().toUpperCase();
    }
    if (payFrequency !== undefined) profile.payFrequency = payFrequency;
    if (workTerms !== undefined) {
      const existingWorkTerms = profile.workTerms?.toObject?.() || profile.workTerms || {};
      profile.workTerms = { ...existingWorkTerms, ...(workTerms || {}) };
    }
    if (employeeInfo !== undefined) {
      profile.employeeInfo = { ...(profile.employeeInfo || {}), ...(employeeInfo || {}) };
    }
    const usesContractPeriod = profile.workTerms?.payBasis === 'fixed_contract'
      || profile.employeeInfo?.employmentType === 'contract';
    if (!usesContractPeriod && profile.workTerms) {
      profile.workTerms.contractStartDate = null;
      profile.workTerms.contractEndDate = null;
      profile.workTerms.contractReference = '';
    }
    if (allowances !== undefined) profile.allowances = allowances;
    if (recurringDeductions !== undefined) profile.recurringDeductions = recurringDeductions;
    if (benefits !== undefined) profile.benefits = benefits;
    if (benefitItems !== undefined) profile.benefitItems = benefitItems;
    if (normalizedTaxConfig !== undefined) {
      const currentTaxConfig = profile.taxConfig?.toObject?.() || profile.taxConfig || {};
      const previousMode = taxWithholdingTreatmentService.normalizeMode(currentTaxConfig.withholdingMode);
      const nextMode = normalizedTaxConfig.withholdingMode;
      const taxTreatmentChanged = previousMode !== nextMode
        || String(currentTaxConfig.withholdingReason || '') !== String(normalizedTaxConfig.withholdingReason || '')
        || comparableDate(currentTaxConfig.withholdingEffectiveFrom) !== comparableDate(normalizedTaxConfig.withholdingEffectiveFrom)
        || comparableDate(currentTaxConfig.withholdingEffectiveTo) !== comparableDate(normalizedTaxConfig.withholdingEffectiveTo);

      if (taxTreatmentChanged) {
        const reviewedAt = new Date();
        normalizedTaxConfig.withholdingReviewedBy = adminId;
        normalizedTaxConfig.withholdingReviewedByName = adminName || '';
        normalizedTaxConfig.withholdingReviewedAt = reviewedAt;
        profile.taxTreatmentHistory = profile.taxTreatmentHistory || [];
        profile.taxTreatmentHistory.push({
          previousMode,
          newMode: nextMode,
          reason: normalizedTaxConfig.withholdingReason,
          effectiveFrom: normalizedTaxConfig.withholdingEffectiveFrom || null,
          effectiveTo: normalizedTaxConfig.withholdingEffectiveTo || null,
          changedBy: adminId,
          changedByName: adminName || '',
          changedAt: reviewedAt,
        });
      } else {
        normalizedTaxConfig.withholdingReviewedBy = currentTaxConfig.withholdingReviewedBy || '';
        normalizedTaxConfig.withholdingReviewedByName = currentTaxConfig.withholdingReviewedByName || '';
        normalizedTaxConfig.withholdingReviewedAt = currentTaxConfig.withholdingReviewedAt || null;
      }
      profile.taxConfig = normalizedTaxConfig;
    }
    if (statutoryContributions !== undefined) {
      profile.statutoryContributions = { ...(profile.statutoryContributions || {}), ...(statutoryContributions || {}) };
    }
    if (bankAccounts !== undefined) {
      // Direct edits on this HR-only endpoint are authoritative Payroll
      // updates. Mark them verified so they stay in sync with employee
      // requests that become active only after HR approval.
      profile.bankAccounts = (Array.isArray(bankAccounts) ? bankAccounts : []).map((account) => ({
        ...account,
        isVerified: true,
        verifiedAt: new Date(),
      }));
    }
    if (status !== undefined) profile.status = status;
    if (isActive !== undefined) profile.isActive = !!isActive;
    if (terminationDate !== undefined) profile.terminationDate = terminationDate ? new Date(terminationDate) : null;
    if (terminationReason !== undefined) profile.terminationReason = terminationReason;
    if (notes !== undefined) profile.notes = notes;
    if (tags !== undefined) profile.tags = tags;
    if (employerEntityId !== undefined) profile.employerEntityId = employerEntityId || null;
    if (taxAssignment !== undefined) {
      profile.taxAssignment = { ...(profile.taxAssignment?.toObject?.() || profile.taxAssignment || {}), ...(taxAssignment || {}) };
    }
    if (syncedMember) {
      applyPayrollSyncFromMember(profile, syncedMember, { importLegacyBanking: bankAccounts === undefined });
    }
    profile.payrollFlags = normalizePayrollFlagsPayload(payrollFlags, profile.basicSalary, profile.payrollFlags, profile.workTerms);

    const automationResult = await payrollCountryAutomationService.reconcileProfile(profile, organizationId, {
      countryHint: taxAssignment?.workCountryCode
        || idpProfileSync?.personalInfo?.mailingAddress?.country
        || syncedMember?.payrollSync?.personalInfo?.mailingAddress?.country,
      autoCreateEmployer: true,
      actor: { userId: adminId, name: adminName, organizationName },
    });
    payrollCountryAutomationService.applyReadiness(profile, automationResult);

    if (profile.employerEntityId) {
      const employerEntity = await employerEntityService.assertAssignableEntity(profile.employerEntityId, organizationId);
      employerEntityService.assertProfileAssignment(profile, employerEntity);
    } else if (profile.payrollFlags?.includeInNextRun) {
      profile.payrollFlags.includeInNextRun = false;
      profile.payrollFlags.requiresReview = true;
      profile.payrollFlags.reviewReason = 'Assign a legal employer before including this employee in payroll.';
    }

    profile.lastModifiedBy = adminId;
    await profile.save();

    res.json({ success: true, profile, idpSync: syncedMember });
  } catch (err) {
    console.error('Update Profile Error:', err);
    if (err?.name === 'ValidationError') {
      return res.status(400).json({
        error: 'Invalid payroll profile data',
        details: extractValidationMessages(err)
      });
    }
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update profile', details: err.details });
  }
});

/**
 * POST /api/payroll/profiles
 *
 * Retired: Payroll does not own employee identities. A payroll configuration
 * may only be initialized for a member verified against the selected Identity
 * Provider organization through /profiles/sync-from-idp.
 */
router.post('/profiles', requireHRAdmin, (_req, res) => {
  res.status(410).json({
    error: 'Payroll cannot create employees. Configure an existing Identity Provider member instead.',
    code: 'PAYROLL_PROFILE_REQUIRES_IDP_MEMBER',
    replacement: '/api/payroll/profiles/sync-from-idp'
  });
});

/**
 * Initialize or refresh the payroll-only configuration attached to an
 * authoritative IDP member. This never creates an employee identity.
 */
async function syncPayrollProfileFromIdp(req, res) {
  try {
    const { organizationId, organizationName, userId: adminId, name: adminName } = getUserInfo(req);
    const accessToken = getIdpAccessToken(req);
    const targetUserId = String(req.body?.userId || '').trim();

    if (!organizationId) {
      return res.status(400).json({ error: 'No organization selected' });
    }

    if (!accessToken) {
      return res.status(502).json({ error: 'Identity Provider sync is currently unavailable' });
    }

    if (!targetUserId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    let member = await fetchIdpMemberPayrollSync(accessToken, organizationId, targetUserId);
    member = await attachPeopleTransitionPayrollSync(member, organizationId, targetUserId);

    if (!member) {
      return res.status(404).json({ error: 'Employee not found in IDP organization members' });
    }

    const resolvedUserId = String(member.sub || targetUserId).trim();
    const existing = await PayrollProfile.findOne({
      userId: { $in: Array.from(new Set([resolvedUserId, targetUserId].filter(Boolean))) },
      organizationId
    });

    if (existing) {
      existing.userId = resolvedUserId;
      applyPayrollSyncFromMember(existing, member);
      existing.payrollFlags = normalizePayrollFlagsPayload(undefined, existing.basicSalary, existing.payrollFlags, existing.workTerms);
      const automationResult = await payrollCountryAutomationService.reconcileProfile(existing, organizationId, {
        countryHint: member?.payrollSync?.personalInfo?.mailingAddress?.country,
        validateBankDetails: false,
        autoCreateEmployer: true,
        actor: { userId: adminId, name: adminName, organizationName },
      });
      payrollCountryAutomationService.applyReadiness(existing, automationResult);
      await existing.save();
      return res.json({
        success: true,
        profile: existing,
        existed: true,
        identitySource: 'identity_provider'
      });
    }

    await organizationCurrencyService.getPolicy(organizationId, { userId: adminId });
    const defaultPaymentCurrency = await organizationCurrencyService.getDefaultPaymentCurrency(organizationId);
    const profile = new PayrollProfile({
      userId: resolvedUserId,
      organizationId,
      basicSalary: 0,
      currency: defaultPaymentCurrency,
      employeeInfo: buildEmployeeSnapshotFromMember(member),
      bankAccounts: buildPayrollBankAccountsFromMember(member, []),
      emergencyContact: buildEmergencyContactFromMember(member, null),
      taxConfig: {
        ...(String(member?.payrollSync?.taxInfo?.taxId || '').trim()
          ? { taxId: String(member.payrollSync.taxInfo.taxId).trim() }
          : {}),
        ...(Number(member?.payrollSync?.dependentsCount || 0) > 0
          ? { dependents: Number(member.payrollSync.dependentsCount) }
          : {}),
      },
      payrollFlags: normalizePayrollFlagsPayload({}, 0, {}),
      createdBy: adminId,
      status: 'active',
      isActive: true,
    });
    applyPayrollSyncFromMember(profile, member);

    const automationResult = await payrollCountryAutomationService.reconcileProfile(profile, organizationId, {
      countryHint: member?.payrollSync?.personalInfo?.mailingAddress?.country
        || member?.payrollSync?.banking?.country,
      validateBankDetails: false,
      autoCreateEmployer: true,
      actor: { userId: adminId, name: adminName, organizationName },
    });
    payrollCountryAutomationService.applyReadiness(profile, automationResult);

    await profile.save();

    res.status(201).json({ success: true, profile, existed: false, identitySource: 'identity_provider' });
  } catch (err) {
    console.error('Sync Payroll Profile From IDP Error:', err);
    const upstreamStatus = Number(err?.response?.status || 0);
    const statusCode = err?.statusCode || (isIdpUpstreamAuthFailure(err)
      ? 502
      : (upstreamStatus === 404 ? 404 : 500));
    res.status(statusCode).json({ error: getIdpProxyErrorMessage(err, 'Failed to synchronize payroll configuration from IDP') });
  }
}

/**
 * POST /api/payroll/profiles/sync-from-idp
 * Initialize or refresh payroll configuration for an existing IDP member.
 * Body: { userId: "<idp_sub>" }
 */
router.post('/profiles/sync-from-idp', requireHRAdmin, syncPayrollProfileFromIdp);

// Compatibility alias for already-deployed clients. It retains the same
// IDP-membership verification and cannot create a payroll-only employee.
router.post('/profiles/import-from-idp', requireHRAdmin, (req, res) => {
  res.set('Deprecation', 'true');
  res.set('Link', '</api/payroll/profiles/sync-from-idp>; rel="successor-version"');
  return syncPayrollProfileFromIdp(req, res);
});

// =====================================================
// PAYSLIP ROUTES (Employee & HR Admin)
// =====================================================

/**
 * GET /api/payroll/my-payslips
 * Get current user's payslips
 */
router.get('/my-payslips', requireAuth, async (req, res) => {
  try {
    const { userId, organizationId, role } = getUserInfo(req);
    const { year, limit = 12 } = req.query;
    const visibleStatuses = getVisiblePayslipStatusesForRole(role);

    const query = { userId, organizationId };
    if (year) query['payPeriod.year'] = parseInt(year);
    query.status = { $in: visibleStatuses };

    const payslips = await Payslip.find(query)
      .populate('payrollRunId', 'runNumber payPeriod status')
      .sort({ 'payPeriod.year': -1, 'payPeriod.month': -1 })
      .limit(parseInt(limit));

    res.json(payslips);
  } catch (err) {
    console.error('Get My Payslips Error:', err);
    res.status(500).json({ error: 'Failed to fetch payslips' });
  }
});

/**
 * GET /api/payroll/my-payslips/:id
 * Get specific payslip details
 */
router.get('/my-payslips/:id', requireAuth, async (req, res) => {
  try {
    const { userId, organizationId, role } = getUserInfo(req);
    const visibleStatuses = getVisiblePayslipStatusesForRole(role);

    const payslip = await Payslip.findOne({
      _id: req.params.id,
      userId,
      organizationId,
      status: { $in: visibleStatuses }
    }).populate('payrollRunId');

    if (!payslip) {
      return res.status(404).json({ error: 'Payslip not found' });
    }

    res.json(payslip);
  } catch (err) {
    console.error('Get Payslip Error:', err);
    res.status(500).json({ error: 'Failed to fetch payslip' });
  }
});

/**
 * GET /api/payroll/payslips
 * Get all payslips for the organization (HR Admin only)
 */
router.get('/payslips', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const { year, month, payrollRunId, status, limit = 50, skip = 0 } = req.query;

    const query = { organizationId };
    if (year) query['payPeriod.year'] = parseInt(year);
    if (month) query['payPeriod.month'] = parseInt(month);
    if (payrollRunId) query.payrollRunId = payrollRunId;
    if (status) query.status = status;

    const payslips = await Payslip.find(query)
      .populate('payrollRunId', 'runNumber status')
      .sort({ 'employeeSnapshot.name': 1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    const total = await Payslip.countDocuments(query);

    res.json({
      payslips,
      total,
      limit: parseInt(limit),
      skip: parseInt(skip)
    });
  } catch (err) {
    console.error('Get Payslips Error:', err);
    res.status(500).json({ error: 'Failed to fetch payslips' });
  }
});

/**
 * GET /api/payroll/payslips/:id
 * Get specific payslip details (HR Admin only)
 */
router.get('/payslips/:id', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);

    const payslip = await Payslip.findOne({
      _id: req.params.id,
      organizationId
    }).populate('payrollRunId');

    if (!payslip) {
      return res.status(404).json({ error: 'Payslip not found' });
    }

    res.json(payslip);
  } catch (err) {
    console.error('Get Payslip Error:', err);
    res.status(500).json({ error: 'Failed to fetch payslip' });
  }
});

/**
 * GET /api/payroll/payslips/:id/pdf
 * Generate and download payslip as PDF
 */
router.get('/payslips/:id/pdf', requireAuth, async (req, res) => {
  try {
    const { userId, organizationId, role } = getUserInfo(req);
    const isHRAdmin = ['owner', 'admin', 'hr_manager'].includes(role);

    const payslip = await Payslip.findOne({
      _id: req.params.id,
      organizationId
    }).populate('payrollRunId');

    if (!payslip) {
      return res.status(404).json({ error: 'Payslip not found' });
    }

    // Check permission - only HR admin or own payslip
    if (!isHRAdmin && payslip.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Set response headers
    const filename = `payslip-${payslip.payslipNumber}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = createPayslipPdf({
      payslip,
      organization: req.currentOrganization || req.session?.user?.currentOrganization || {},
    });

    // Pipe PDF to response
    doc.pipe(res);
    doc.end();

  } catch (err) {
    console.error('Generate PDF Error:', err);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// =====================================================
// PAYROLL RUN ROUTES (HR Admin only)
// =====================================================

/**
 * GET /api/payroll/runs
 * Get payroll runs for the organization
 */
router.get('/runs', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const { year, status, employerEntityId, limit = 12 } = req.query;

    const runs = await PayrollRun.getByOrganization(organizationId, {
      year: year ? parseInt(year) : undefined,
      status,
      employerEntityId,
      limit: parseInt(limit)
    });

    res.json(runs);
  } catch (err) {
    console.error('Get Runs Error:', err);
    res.status(500).json({ error: 'Failed to fetch payroll runs' });
  }
});

/**
 * GET /api/payroll/runs/:id
 * Get specific payroll run details
 */
router.get('/runs/:id', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);

    const run = await PayrollRun.findOne({
      _id: req.params.id,
      organizationId
    });

    if (!run) {
      return res.status(404).json({ error: 'Payroll run not found' });
    }

    res.json(run);
  } catch (err) {
    console.error('Get Run Error:', err);
    res.status(500).json({ error: 'Failed to fetch payroll run' });
  }
});

/**
 * POST /api/payroll/runs
 * Create and process a new payroll run
 */
router.post('/runs', requireHRAdmin, async (req, res) => {
  let createdRun = null;
  try {
    const { organizationId, userId: adminId, name: adminName, role } = getUserInfo(req);
    const { month, year, settings = {}, paymentDate, workInputs = [], employerEntityId } = req.body;
    const payFrequency = String(req.body?.payFrequency || settings.payFrequency || 'monthly').trim().toLowerCase();

    // Validate month/year
    if (!Number.isInteger(Number(month)) || Number(month) < 1 || Number(month) > 12
      || !Number.isInteger(Number(year)) || Number(year) < 2000 || Number(year) > 2200) {
      return res.status(400).json({ error: 'Month must be an integer from 1 to 12 and year must be an integer from 2000 to 2200.' });
    }
    if (!PAY_FREQUENCIES.has(payFrequency)) {
      return res.status(400).json({ error: 'Pay frequency must be monthly, semi-monthly, bi-weekly, or weekly' });
    }
    if (payFrequency !== 'monthly') {
      return res.status(422).json({
        error: 'Only monthly payroll runs are currently certified. Weekly, bi-weekly, and semi-monthly runs remain blocked until salary-frequency, period-overlap, and leave-period rules are certified.',
        code: 'PAY_FREQUENCY_NOT_CERTIFIED',
      });
    }

    if (req.body?.startDate !== undefined || req.body?.endDate !== undefined) {
      return res.status(400).json({
        error: 'Monthly payroll periods use canonical calendar-month boundaries; startDate and endDate cannot be overridden.',
        code: 'PAYROLL_PERIOD_OVERRIDE_NOT_ALLOWED',
      });
    }

    const normalizedMonth = Number(month);
    const normalizedYear = Number(year);
    const startDate = new Date(Date.UTC(normalizedYear, normalizedMonth - 1, 1));
    const endDate = new Date(Date.UTC(normalizedYear, normalizedMonth, 0, 23, 59, 59, 999));
    const defaultPaymentDate = paymentDate ? new Date(paymentDate) : endDate;
    if (Number.isNaN(defaultPaymentDate.getTime())) {
      return res.status(400).json({ error: 'Payment date is invalid' });
    }
    if (!employerEntityId) {
      return res.status(422).json({
        error: 'Select the legal employer that owns this payroll run.',
        code: 'PAYROLL_EMPLOYER_ENTITY_REQUIRED',
      });
    }
    const employerContext = await employerEntityService.assertRunEntity(
      employerEntityId,
      organizationId,
      defaultPaymentDate
    );

    const exists = await PayrollRun.existsForPeriod(organizationId, normalizedYear, normalizedMonth, {
      type: payFrequency,
      employerEntityId,
    });
    if (exists) {
      return res.status(409).json({ error: 'Payroll run for this legal employer and period already exists' });
    }

    const runNumber = await PayrollRun.generateRunNumber(organizationId, normalizedYear, normalizedMonth);
    const currencyPolicy = await organizationCurrencyService.getPolicy(organizationId, {
      userId: adminId,
      name: adminName,
    });
    const reportingCurrency = await organizationCurrencyService.assertReportingCurrency(
      organizationId,
      settings.reportingCurrency || employerContext.entity.defaultCurrency
    );
    if (reportingCurrency !== employerContext.entity.defaultCurrency) {
      return res.status(422).json({
        error: `Payroll runs must use the legal employer currency ${employerContext.entity.defaultCurrency}. Cross-currency reporting remains available outside the statutory run.`,
        code: 'PAYROLL_RUN_CURRENCY_MUST_MATCH_EMPLOYER',
      });
    }

    // Create Run Record
    const run = new PayrollRun({
      runNumber,
      organizationId,
      employerEntityId: employerContext.entity._id,
      employerEntitySnapshot: {
        code: employerContext.entity.code,
        legalName: employerContext.entity.legalName,
        employerType: employerContext.entity.employerType,
        countryCode: employerContext.entity.countryCode,
        jurisdictionCode: employerContext.entity.jurisdictionCode,
        currency: employerContext.entity.defaultCurrency,
        taxJurisdictionConfigId: employerContext.entity.taxJurisdictionConfigId,
        taxJurisdictionVersionId: employerContext.entity.taxJurisdictionVersionId,
        taxAdapterCandidateId: employerContext.entity.taxAdapterCandidateId,
        taxPackContentHash: employerContext.readiness.taxPack?.contentHash || '',
        payrollRunnableAtCreation: employerContext.readiness.payrollRunnable,
        blockingIssuesAtCreation: employerContext.readiness.blockingIssues,
      },
      payPeriod: {
        type: payFrequency,
        month: normalizedMonth,
        year: normalizedYear,
        startDate,
        endDate,
        paymentDate: defaultPaymentDate
      },
      status: 'calculating',
      settings: {
        includeAllowances: settings.includeAllowances !== false,
        includeBonuses: settings.includeBonuses !== false,
        includeOvertime: settings.includeOvertime !== false,
        includeCommissions: settings.includeCommissions !== false,
        processStatutoryDeductions: settings.processStatutoryDeductions !== false,
        processLoans: settings.processLoans !== false,
        // Leave verification is a payroll control, not an optional employee deduction toggle.
        processUnpaidLeave: true,
        calculateTax: settings.calculateTax !== false,
        prorate: settings.prorate !== false,
        departments: Array.isArray(settings.departments) ? settings.departments : [],
        teams: Array.isArray(settings.teams) ? settings.teams : [],
        employmentTypes: Array.isArray(settings.employmentTypes) ? settings.employmentTypes : [],
        reportingCurrency,
      },
      workInputs: (Array.isArray(workInputs) ? workInputs : []).map(input => ({
        userId: String(input?.userId || '').trim(),
        employeeName: String(input?.employeeName || '').trim(),
        regularHours: Math.max(0, toNumber(input?.regularHours)),
        daysWorked: Math.max(0, toNumber(input?.daysWorked)),
        notes: String(input?.notes || '').trim(),
        enteredBy: adminId,
        enteredAt: new Date(),
      })).filter(input => input.userId),
      createdBy: adminId,
      createdByName: adminName
    });

    await run.save();
    createdRun = run;

    // =====================================================
    // DELEGATE TO PAYROLL ENGINE SERVICE
    // =====================================================

    const result = await payrollEngineService.calculateRun(run._id, organizationId);
    const calculatedRun = await PayrollRun.findOne({ _id: run._id, organizationId });
    calculatedRun.calculationTotalsHash = hashPayrollTotals(getPayrollRunTotals(calculatedRun));
    await calculatedRun.save();
    result.run = calculatedRun;

    // =====================================================
    // SEND EMAIL NOTIFICATIONS (async, don't block response)
    // =====================================================
    (async () => {
      try {
        // Notify HR Admin that payroll calculation is complete
        // (employee payslip notifications should happen after approval/finalize)
        if (req.session?.user?.email) {
          await emailService.sendPayrollCompleteNotification(
            req.session.user.email,
            adminName,
            { month: normalizedMonth, year: normalizedYear },
            result.summary?.processed || result.summary?.totalEmployees || 0,
            result.summary?.totalGrossPayroll || 0,
            result.run?.summary?.currency || 'USD'
          );
        }
      } catch (emailErr) {
        console.error('Email notification error (non-blocking):', emailErr.message);
      }
    })();

    res.status(201).json({
      success: true,
      run: result.run,
      summary: result.summary,
      errors: result.errors
    });
  } catch (err) {
    console.error('Create Payroll Run Error:', err);
    try {
      await markRunCalculationFailure(createdRun, err);
    } catch (statusError) {
      console.error('Failed to mark payroll run for review:', statusError.message);
    }
    const statusCode = err?.code === 11000 ? 409 : (err?.statusCode || (err?.code === 'PAY_FREQUENCY_NOT_CERTIFIED' ? 422 : 500));
    res.status(statusCode).json({ error: 'Failed to create payroll run', details: err.message, code: err?.code });
  }
});

/**
 * POST /api/payroll/runs/:id/recalculate
 * Recalculate a payroll run (HR Admin only)
 *
 * This exists because payroll profiles/requests often change after an initial calculation.
 * Allowed only before submission for approval.
 */
router.post('/runs/:id/recalculate', requireHRAdmin, async (req, res) => {
  let run = null;
  try {
    const { organizationId, userId: adminId, name: adminName, role } = getUserInfo(req);
    run = await PayrollRun.findOne({ _id: req.params.id, organizationId });

    if (!run) {
      return res.status(404).json({ error: 'Payroll run not found' });
    }

    if (!['calculated', 'pending_review'].includes(run.status)) {
      return res.status(400).json({ error: `Cannot recalculate run with status: ${run.status}` });
    }

    run.status = 'calculating';
    run.calculationRevision = Number(run.calculationRevision || 1) + 1;
    run.submittedRevision = undefined;
    run.submittedTotalsHash = undefined;
    run.currentApprovalLevel = 0;
    run.addApproval('revised', adminId, adminName, role, req.body?.comments || 'Recalculated');
    await run.save();

    const result = await payrollEngineService.calculateRun(run._id, organizationId);
    const calculatedRun = await PayrollRun.findOne({ _id: run._id, organizationId });
    calculatedRun.calculationTotalsHash = hashPayrollTotals(getPayrollRunTotals(calculatedRun));
    await calculatedRun.save();
    result.run = calculatedRun;

    res.json({
      success: true,
      run: result.run,
      summary: result.summary,
      errors: result.errors
    });
  } catch (err) {
    console.error('Recalculate Run Error:', err);
    try {
      await markRunCalculationFailure(run, err);
    } catch (statusError) {
      console.error('Failed to mark recalculated payroll run for review:', statusError.message);
    }
    res.status(err?.statusCode || 500).json({ error: 'Failed to recalculate payroll run', details: err.message, code: err?.code });
  }
});

/**
 * PUT /api/payroll/runs/:id/work-inputs
 * Revise period work records and immediately recalculate draft payroll.
 */
router.put('/runs/:id/work-inputs', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId, userId: adminId, name: adminName, role } = getUserInfo(req);
    const run = await PayrollRun.findOne({ _id: req.params.id, organizationId });
    if (!run) return res.status(404).json({ error: 'Payroll run not found' });
    if (!['calculated', 'pending_review'].includes(run.status)) {
      return res.status(400).json({ error: `Work inputs cannot be changed while run is ${run.status}` });
    }

    const workInputs = Array.isArray(req.body?.workInputs) ? req.body.workInputs : [];
    run.workInputs = workInputs.map(input => ({
      userId: String(input?.userId || '').trim(),
      employeeName: String(input?.employeeName || '').trim(),
      regularHours: Math.max(0, toNumber(input?.regularHours)),
      daysWorked: Math.max(0, toNumber(input?.daysWorked)),
      notes: String(input?.notes || '').trim(),
      enteredBy: adminId,
      enteredAt: new Date(),
    })).filter(input => input.userId);
    run.calculationRevision = Number(run.calculationRevision || 1) + 1;
    run.submittedRevision = undefined;
    run.submittedTotalsHash = undefined;
    run.currentApprovalLevel = 0;
    run.addApproval('revised', adminId, adminName, role, req.body?.comments || 'Period work records revised');
    await run.save();

    const result = await payrollEngineService.calculateRun(run._id, organizationId);
    const calculatedRun = await PayrollRun.findOne({ _id: run._id, organizationId });
    calculatedRun.calculationTotalsHash = hashPayrollTotals(getPayrollRunTotals(calculatedRun));
    await calculatedRun.save();
    result.run = calculatedRun;
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Update Work Inputs Error:', err);
    res.status(500).json({ error: 'Failed to update period work records', details: err.message });
  }
});

/**
 * POST /api/payroll/runs/:id/submit-for-approval
 * Submit payroll run for approval
 */
router.post('/runs/:id/submit-for-approval', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId, userId: adminId, name: adminName, role } = getUserInfo(req);

    const run = await PayrollRun.findOne({
      _id: req.params.id,
      organizationId
    });

    if (!run) {
      return res.status(404).json({ error: 'Payroll run not found' });
    }

    if (run.status === 'pending_approval') {
      try { await queuePayrollReadyEvent(run, adminId); }
      catch (error) { console.error('Payroll is pending approval; Automation Hub outbox reconciliation will retry:', error.message); }
      return res.json({ success: true, run, idempotent: true });
    }

    if (run.status !== 'calculated') {
      return res.status(400).json({ error: `Cannot submit run with status: ${run.status}` });
    }

    assertRunHasNoBlockingIssues(run);

    const approvalPolicy = await payrollCycleService.getPolicy(organizationId, null, { userId: adminId, name: adminName });

    run.requiredApprovalLevels = Math.max(1, approvalPolicy.levels.length);
    run.addApproval('submitted', adminId, adminName, role, req.body.comments);
    run.status = 'pending_approval';
    run.calculationTotalsHash = run.calculationTotalsHash || hashPayrollTotals(getPayrollRunTotals(run));
    run.submittedRevision = run.calculationRevision;
    run.submittedTotalsHash = run.calculationTotalsHash;
    await run.save();

    // Update all payslips status
    await Payslip.updateMany(
      { payrollRunId: run._id },
      { status: 'pending_approval' }
    );

    try { await queuePayrollReadyEvent(run, adminId); }
    catch (error) { console.error('Payroll submitted; Automation Hub outbox reconciliation will retry:', error.message); }

    if (approvalPolicy.approvalRequired === false && approvalPolicy.automaticRelease !== false) {
      run.status = 'approved';
      await run.save();
      await Payslip.updateMany({ payrollRunId: run._id }, { status: 'approved' });
      const releasedRun = await finalizePayrollRun(run._id, organizationId, adminId, adminName, req.body.comments);
      return res.json({ success: true, run: releasedRun, released: true });
    }

    res.json({ success: true, run });
  } catch (err) {
    console.error('Submit Run Error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to submit payroll run', code: err.code });
  }
});

/**
 * POST /api/payroll/runs/:id/approve
 * Approve payroll run
 */
router.post('/runs/:id/approve', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId, userId: adminId, name: adminName, role } = getUserInfo(req);

    const run = await PayrollRun.findOne({
      _id: req.params.id,
      organizationId
    });

    if (!run) {
      return res.status(404).json({ error: 'Payroll run not found' });
    }

    if (['exported', 'paid'].includes(run.status)) {
      return res.json({ success: true, run, released: true, idempotent: true });
    }
    if (run.status === 'approved') {
      const releasedRun = await finalizePayrollRun(run._id, organizationId, adminId, adminName, req.body.comments);
      return res.json({ success: true, run: releasedRun, released: true, idempotent: true });
    }
    if (run.status !== 'pending_approval') {
      return res.status(400).json({ error: `Cannot approve run with status: ${run.status}` });
    }

    assertRunHasNoBlockingIssues(run);

    const approvalPolicy = await payrollCycleService.getPolicy(organizationId, null, { userId: adminId, name: adminName });
    const submitted = [...(run.approvals || [])].reverse().find(entry => entry.action === 'submitted');
    if (approvalPolicy.requireSeparationOfDuties && String(submitted?.actionBy || '') === String(adminId)) {
      return res.status(403).json({ error: 'The submitter cannot approve this payroll run.', code: 'PAYROLL_SEPARATION_OF_DUTIES' });
    }
    const approvalLevel = approvalPolicy.levels[Math.min(run.currentApprovalLevel, approvalPolicy.levels.length - 1)];
    if (approvalLevel?.roles?.length && !approvalLevel.roles.includes(role)) {
      return res.status(403).json({ error: 'Your role cannot approve this payroll level.', code: 'PAYROLL_APPROVER_ROLE_REQUIRED' });
    }

    const currentTotalsHash = hashPayrollTotals(getPayrollRunTotals(run));
    if (run.submittedRevision !== run.calculationRevision || run.submittedTotalsHash !== currentTotalsHash) {
      return res.status(409).json({ error: 'This payroll changed after submission. Recalculate and submit the current revision.', code: 'PAYROLL_RUN_REVISION_CHANGED' });
    }

    run.addApproval('approved', adminId, adminName, role, req.body.comments);
    await run.save();

    // Update payslips status if run is fully approved
    if (run.status === 'approved') {
      await Payslip.updateMany(
        { payrollRunId: run._id },
        { status: 'approved' }
      );
    }

    const releasedRun = run.status === 'approved'
      ? await finalizePayrollRun(run._id, organizationId, adminId, adminName, req.body.comments)
      : run;
    res.json({ success: true, run: releasedRun, released: releasedRun.status === 'exported' });
  } catch (err) {
    console.error('Approve Run Error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to approve payroll run', code: err.code });
  }
});

/**
 * GET /api/payroll/runs/:id/payslips
 * Get all payslips for a specific payroll run (HR Admin only)
 */
router.get('/runs/:id/payslips', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);

    const run = await PayrollRun.findOne({
      _id: req.params.id,
      organizationId
    });

    if (!run) {
      return res.status(404).json({ error: 'Payroll run not found' });
    }

    const payslips = await Payslip.find({
      payrollRunId: run._id,
      organizationId
    }).sort({ 'employeeSnapshot.name': 1 });

    res.json({ success: true, run, payslips });
  } catch (err) {
    console.error('Get Run Payslips Error:', err);
    res.status(500).json({ error: 'Failed to fetch run payslips' });
  }
});

/**
 * GET /api/payroll/runs/:id/export
 * Export a payroll run as CSV for accounting (HR Admin only)
 */
router.get('/runs/:id/export', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);

    const run = await PayrollRun.findOne({
      _id: req.params.id,
      organizationId
    }).lean();

    if (!run) {
      return res.status(404).json({ error: 'Payroll run not found' });
    }

    if (!['approved', 'exported', 'paid'].includes(run.status)) {
      return res.status(400).json({ error: `Cannot export a payroll run with status: ${run.status}` });
    }
    assertRunHasNoBlockingIssues(run);

    const payslips = await Payslip.find({
      payrollRunId: run._id,
      organizationId
    }).sort({ 'employeeSnapshot.name': 1 }).lean();

    const userIds = Array.from(new Set(
      payslips
        .map((payslip) => String(payslip?.userId || '').trim())
        .filter(Boolean)
    ));
    const profiles = userIds.length > 0
      ? await PayrollProfile.find({ organizationId, userId: { $in: userIds } })
        .select('userId currency employeeInfo bankAccounts')
        .lean()
      : [];

    const runById = new Map([[String(run._id), run]]);
    const profileByUserId = new Map(profiles.map((profile) => [String(profile.userId), profile]));
    const { csv } = buildPayrollRegisterCsv({ payslips, runById, profileByUserId });
    const filename = `payroll-register-${run.runNumber}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('Export Run Error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to export payroll run', code: err.code });
  }
});

async function retractPayrollRun(runId, organizationId, adminId, adminName, comments) {
  const result = await payrollRetractionService.retractRun({
    runId,
    organizationId,
    adminId,
    adminName,
    comments,
  });

  return result;
}

async function finalizePayrollRun(runId, organizationId, adminId, adminName, comments) {
  return payrollFinalizationService.finalizeRun({
    runId,
    organizationId,
    adminId,
    adminName,
    comments,
    assertRunReady: async (run) => {
      assertRunHasNoBlockingIssues(run);
      const employerContext = await employerEntityService.assertRunEntity(
        run.employerEntityId,
        organizationId,
        run.payPeriod?.paymentDate
      );
      if (!employerContext.readiness.payrollRunnable) {
        const error = new Error(`Payroll cannot be finalized: ${employerContext.readiness.blockingIssues.join(' ')}`);
        error.statusCode = 409;
        error.code = 'PAYROLL_EMPLOYER_NOT_RUNNABLE';
        throw error;
      }
    },
  });
}

/**
 * POST /api/payroll/runs/:id/finalize
 * Finalize/export payroll run (HR Admin only)
 */
router.post('/runs/:id/finalize', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId, userId: adminId, name: adminName } = getUserInfo(req);
    const run = await finalizePayrollRun(req.params.id, organizationId, adminId, adminName, req.body?.comments);
    res.json({ success: true, run });
  } catch (err) {
    console.error('Finalize Run Error:', err);
    res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to finalize payroll run',
      code: err.code,
      retryable: err.retryable === true,
    });
  }
});

/**
 * POST /api/payroll/runs/:id/process-payment
 * Legacy alias for finalize (no actual payout processing)
 */
router.post('/runs/:id/process-payment', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId, userId: adminId, name: adminName } = getUserInfo(req);
    const run = await finalizePayrollRun(req.params.id, organizationId, adminId, adminName, req.body?.comments);
    res.json({ success: true, run });
  } catch (err) {
    console.error('Process Payment (Legacy) Error:', err);
    res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to finalize payroll run',
      code: err.code,
      retryable: err.retryable === true,
    });
  }
});

/**
 * POST /api/payroll/runs/:id/retract
 * Retract a payroll run, remove generated payslips, and reopen processed requests
 *
 * Restricted to organization owner/admin only.
 */
router.post('/runs/:id/retract', requireOrganizationAdminOnly, async (req, res) => {
  try {
    const { organizationId, userId: adminId, name: adminName } = getUserInfo(req);
    const result = await retractPayrollRun(
      req.params.id,
      organizationId,
      adminId,
      adminName,
      req.body?.comments
    );

    res.json({
      success: true,
      run: result.run,
      deletedPayslips: result.deletedPayslips,
      resetCompensationRequests: result.resetCompensationRequests,
      resetTimeAttendanceImports: result.resetTimeAttendanceImports,
      warnings: [
        'Generated payslips for this run were removed.',
        'Compensation requests finalized by this run were reopened.',
        'Time and Attendance imports applied by this run were reopened.',
        'Use this only when you need to re-run payroll for the month.'
      ]
    });
  } catch (err) {
    console.error('Retract Run Error:', err);
    res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to retract payroll run',
      code: err.code,
      retryable: err.retryable === true,
    });
  }
});

// =====================================================
// ANALYTICS & REPORTING (HR Admin only)
// =====================================================

/**
 * GET /api/payroll/analytics/summary
 * Get payroll analytics summary
 */
router.get('/analytics/summary', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const { year = new Date().getFullYear() } = req.query;
    const selectedYear = parseInt(year);

    // Get all runs for the year
    const runs = await PayrollRun.find({
      organizationId,
      'payPeriod.year': selectedYear,
      status: { $in: ['calculated', 'approved', 'exported', 'paid'] }
    }).sort({ 'payPeriod.month': 1 });
    const runIds = runs.map((run) => run._id);
    const payslips = runIds.length > 0
      ? await Payslip.find({ organizationId, payrollRunId: { $in: runIds } })
      : [];
    const reporting = await payrollReportingService.preparePayslips(
      organizationId,
      payslips
    );

    const summary = {
      year: selectedYear,
      totalPayrollRuns: runs.length,
      totalEmployeesPaid: reporting.employeeCount,
      totalGrossPayroll: reporting.totals.grossPay,
      totalNetPayroll: reporting.totals.netPay,
      totalTaxWithheld: reporting.totals.totalTax,
      totalEmployerContributions: reporting.totals.totalEmployerContributions,
      totalEmployerCost: reporting.totals.totalEmployerCost,
      ...reportingMetadata(reporting),
      monthlyBreakdown: []
    };

    runs.forEach(run => {
      const runRows = reporting.rows.filter((row) => (
        String(row.payslip?.payrollRunId) === String(run._id)
      ));
      const runReporting = aggregatePreparedSubset(reporting, runRows);

      summary.monthlyBreakdown.push({
        month: run.payPeriod.month,
        year: run.payPeriod.year,
        grossPayroll: runReporting.totals.grossPay,
        netPayroll: runReporting.totals.netPay,
        tax: runReporting.totals.totalTax,
        employerContributions: runReporting.totals.totalEmployerContributions,
        employerCost: runReporting.totals.totalEmployerCost,
        employees: runReporting.employeeCount,
        status: run.status,
        ...reportingMetadata(runReporting),
      });
    });

    // Get active employee count
    const activeProfiles = await PayrollProfile.countDocuments({
      organizationId,
      isActive: true
    });

    summary.activeEmployees = activeProfiles;

    res.json(summary);
  } catch (err) {
    console.error('Analytics Summary Error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

/**
 * GET /api/payroll/analytics/comprehensive
 * Get comprehensive payroll analytics for admin dashboard
 */
router.get('/analytics/comprehensive', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const { year = new Date().getFullYear() } = req.query;
    const currentYear = parseInt(year);
    const previousYear = currentYear - 1;

    // Get all payslips for current and previous year
    const [currentYearPayslips, previousYearPayslips, allProfiles, currentYearRuns] = await Promise.all([
      Payslip.find({
        organizationId,
        'payPeriod.year': currentYear,
        status: { $in: ANALYTICS_PAYSLIP_STATUSES }
      }),
      Payslip.find({
        organizationId,
        'payPeriod.year': previousYear,
        status: { $in: ANALYTICS_PAYSLIP_STATUSES }
      }),
      PayrollProfile.find({ organizationId }),
      PayrollRun.find({
        organizationId,
        'payPeriod.year': currentYear,
        status: { $in: ['calculated', 'pending_review', 'pending_approval', 'approved', 'exported', 'paid'] }
      }).sort({ 'payPeriod.month': 1 })
    ]);

    const [currentReporting, previousReporting] = await Promise.all([
      payrollReportingService.preparePayslips(organizationId, currentYearPayslips),
      payrollReportingService.preparePayslips(organizationId, previousYearPayslips),
    ]);
    const currentYearGross = currentReporting.totals.grossPay;
    const currentYearNet = currentReporting.totals.netPay;
    const previousYearGross = previousReporting.totals.grossPay;
    const previousYearNet = previousReporting.totals.netPay;
    const yoyGrossGrowth = percentageGrowth(currentYearGross, previousYearGross);
    const yoyNetGrowth = percentageGrowth(currentYearNet, previousYearNet);

    // Monthly breakdown with comparison
    const monthlyData = [];
    for (let month = 1; month <= 12; month++) {
      const monthReporting = aggregatePreparedSubset(
        currentReporting,
        currentReporting.rows.filter((row) => row.payslip?.payPeriod?.month === month)
      );
      const previousMonthReporting = aggregatePreparedSubset(
        previousReporting,
        previousReporting.rows.filter((row) => row.payslip?.payPeriod?.month === month)
      );

      monthlyData.push({
        month,
        grossPayroll: monthReporting.totals.grossPay,
        netPayroll: monthReporting.totals.netPay,
        tax: monthReporting.totals.totalTax,
        employees: monthReporting.employeeCount,
        previousYearGross: previousMonthReporting.totals.grossPay,
        growth: percentageGrowth(
          monthReporting.totals.grossPay,
          previousMonthReporting.totals.grossPay
        ),
        ...reportingMetadata(monthReporting),
        previousYearReporting: reportingMetadata(previousMonthReporting),
      });
    }

    // Department breakdown
    const activeProfiles = allProfiles.filter(payrollAnalyticsService.isCurrentWorkforceProfile);
    const currentDepartmentByUser = payrollAnalyticsService.currentDepartmentByUser(allProfiles);
    const departmentRoster = payrollAnalyticsService.buildDepartmentRoster(allProfiles);
    const deptMap = new Map(
      Array.from(departmentRoster.entries()).map(([department, roster]) => [department, {
        rows: [],
        currentHeadcount: roster.userIds.size,
        activeHeadcount: roster.active,
        onNoticeHeadcount: roster.onNotice,
        onLeaveHeadcount: roster.onLeave,
      }])
    );
    currentReporting.rows.forEach((row) => {
      const userId = String(row.payslip?.userId || '');
      const department = currentDepartmentByUser.get(userId)
        || payrollAnalyticsService.normalizeDepartment(row.payslip?.employeeSnapshot?.department);
      const bucket = deptMap.get(department) || {
        rows: [], currentHeadcount: 0, activeHeadcount: 0, onNoticeHeadcount: 0, onLeaveHeadcount: 0,
      };
      bucket.rows.push(row);
      deptMap.set(department, bucket);
    });

    const departmentBreakdown = Array.from(deptMap.entries()).map(([department, bucket]) => {
      const departmentReporting = aggregatePreparedSubset(currentReporting, bucket.rows);
      return {
        department,
        totalGross: departmentReporting.totals.grossPay,
        totalNet: departmentReporting.totals.netPay,
        totalEmployerContributions: departmentReporting.totals.totalEmployerContributions,
        totalEmployerCost: departmentReporting.totals.totalEmployerCost,
        employeeCount: bucket.currentHeadcount,
        currentHeadcount: bucket.currentHeadcount,
        activeHeadcount: bucket.activeHeadcount,
        onNoticeHeadcount: bucket.onNoticeHeadcount,
        onLeaveHeadcount: bucket.onLeaveHeadcount,
        payrollEmployeeCount: departmentReporting.employeeCount,
        payslipCount: departmentReporting.payslipCount,
        avgPayPerPayslip: departmentReporting.totals.grossPay === null || departmentReporting.payslipCount === 0
          ? null
          : roundReportingAmount(
            departmentReporting.totals.grossPay / departmentReporting.payslipCount,
            currentReporting.reportingMinorUnits
          ),
        avgSalary: departmentReporting.totals.grossPay === null || departmentReporting.payslipCount === 0
          ? null
          : roundReportingAmount(
            departmentReporting.totals.grossPay / departmentReporting.payslipCount,
            currentReporting.reportingMinorUnits
          ),
        ...reportingMetadata(departmentReporting),
      };
    }).sort((a, b) => b.currentHeadcount - a.currentHeadcount || (b.totalGross ?? -Infinity) - (a.totalGross ?? -Infinity));

    // Salary distribution
    const salaryRanges = [
      { min: 0, max: 30000, label: `0-30K ${currentReporting.reportingCurrency}` },
      { min: 30000, max: 50000, label: `30K-50K ${currentReporting.reportingCurrency}` },
      { min: 50000, max: 75000, label: `50K-75K ${currentReporting.reportingCurrency}` },
      { min: 75000, max: 100000, label: `75K-100K ${currentReporting.reportingCurrency}` },
      { min: 100000, max: 150000, label: `100K-150K ${currentReporting.reportingCurrency}` },
      { min: 150000, max: Infinity, label: `150K+ ${currentReporting.reportingCurrency}` }
    ];
    const activeUserIds = new Set(activeProfiles.map((profile) => String(profile.userId)));
    const latestRowByUser = new Map();
    currentReporting.rows.forEach((row) => {
      const userId = String(row.payslip?.userId || '');
      if (!activeUserIds.has(userId)) return;
      const current = latestRowByUser.get(userId);
      if (!current || (row.paymentDate?.getTime() || 0) > (current.paymentDate?.getTime() || 0)) {
        latestRowByUser.set(userId, row);
      }
    });
    const salaryDistributionAvailable = latestRowByUser.size === activeProfiles.length
      && Array.from(latestRowByUser.values()).every((row) => Number.isFinite(row.reportingRate));
    const annualBasicSalaries = salaryDistributionAvailable
      ? Array.from(latestRowByUser.values()).map((row) => roundReportingAmount(
        Number(row.payslip?.earningsSummary?.basicSalary || 0) * 12 * row.reportingRate,
        currentReporting.reportingMinorUnits
      ))
      : [];
    const salaryDistribution = salaryDistributionAvailable
      ? salaryRanges.map((range) => ({
        label: range.label,
        count: annualBasicSalaries.filter((annual) => annual >= range.min && annual < range.max).length,
      }))
      : [];

    // Top earners (anonymized)
    const topEarnersByDept = {};
    deptMap.forEach((bucket, department) => {
      const userRows = new Map();
      bucket.rows.forEach((row) => {
        const userId = String(row.payslip?.userId || '');
        const rows = userRows.get(userId) || [];
        rows.push(row);
        userRows.set(userId, rows);
      });
      const totals = Array.from(userRows.values()).map((rows) => (
        aggregatePreparedSubset(currentReporting, rows).totals.grossPay
      ));
      topEarnersByDept[department] = totals.some((total) => total === null)
        ? null
        : (totals.sort((a, b) => b - a)[0] || 0);
    });

    // Payroll run status summary
    const runStatusSummary = {
      total: currentYearRuns.length,
      paid: currentYearRuns.filter(r => r.status === 'paid').length,
      approved: currentYearRuns.filter(r => r.status === 'approved').length,
      calculated: currentYearRuns.filter(r => r.status === 'calculated').length,
      pending: currentYearRuns.filter(r => ['pending_review', 'pending_approval'].includes(r.status)).length
    };

    const deductionBreakdown = payrollReportingService
      .aggregateLineItems(currentReporting.rows, 'deductions')
      .sort((a, b) => (b.total ?? -Infinity) - (a.total ?? -Infinity))
      .slice(0, 8);

    const earningBreakdown = payrollReportingService
      .aggregateLineItems(currentReporting.rows, 'earnings')
      .sort((a, b) => (b.total ?? -Infinity) - (a.total ?? -Infinity))
      .slice(0, 8);

    // Cost per employee metrics
    const currentYearEmployerCost = currentReporting.totals.totalEmployerCost;
    const avgCostPerEmployee = currentYearEmployerCost === null || activeProfiles.length === 0
      ? (activeProfiles.length === 0 ? 0 : null)
      : roundReportingAmount(
        currentYearEmployerCost / activeProfiles.length,
        currentReporting.reportingMinorUnits
      );

    const payrollMonths = new Set(currentReporting.rows.map((row) => row.payslip?.payPeriod?.month).filter(Boolean));
    const avgMonthlyPayroll = currentYearGross === null || payrollMonths.size === 0
      ? (payrollMonths.size === 0 ? 0 : null)
      : roundReportingAmount(
        currentYearGross / payrollMonths.size,
        currentReporting.reportingMinorUnits
      );

    res.set('Cache-Control', 'no-store');
    res.json({
      year: currentYear,
      ...reportingMetadata(currentReporting),
      previousYearReporting: {
        year: previousYear,
        ...reportingMetadata(previousReporting),
      },
      overview: {
        totalGrossPayroll: currentYearGross,
        totalNetPayroll: currentYearNet,
        totalTaxWithheld: currentReporting.totals.totalTax,
        totalDeductions: currentReporting.totals.totalDeductions,
        totalEmployerContributions: currentReporting.totals.totalEmployerContributions,
        totalEmployerCost: currentYearEmployerCost,
        totalEmployees: activeProfiles.length,
        totalPayslips: currentYearPayslips.length,
        avgCostPerEmployee,
        avgMonthlyPayroll,
        yoyGrossGrowth,
        yoyNetGrowth
      },
      monthlyTrend: monthlyData,
      departmentBreakdown,
      salaryDistribution,
      salaryDistributionAvailable,
      salaryDistributionEmployeeCount: latestRowByUser.size,
      runStatusSummary,
      deductionBreakdown,
      earningBreakdown,
      topEarnersByDept
    });
  } catch (err) {
    console.error('Comprehensive Analytics Error:', err);
    res.status(500).json({ error: 'Failed to fetch comprehensive analytics' });
  }
});

/**
 * GET /api/payroll/analytics/headcount
 * Get headcount and workforce analytics
 */
router.get('/analytics/headcount', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);

    const profiles = await PayrollProfile.find({ organizationId });

    res.set('Cache-Control', 'no-store');
    res.json(payrollAnalyticsService.buildHeadcountAnalytics(profiles));
  } catch (err) {
    console.error('Headcount Analytics Error:', err);
    res.status(500).json({ error: 'Failed to fetch headcount analytics' });
  }
});

/**
 * GET /api/payroll/analytics/ytd/:userId
 * Get year-to-date summary for a user
 */
router.get('/analytics/ytd/:userId', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const { year = new Date().getFullYear() } = req.query;

    const payslips = await Payslip.find({
      userId: req.params.userId,
      organizationId,
      'payPeriod.year': parseInt(year),
      status: { $in: ['approved', 'exported', 'paid'] }
    }).sort({ 'payPeriod.paymentDate': 1 });
    const reporting = await payrollReportingService.preparePayslips(
      organizationId,
      payslips
    );

    const ytd = {
      year: parseInt(year),
      userId: req.params.userId,
      totalPayslips: payslips.length,
      totalGrossEarnings: reporting.totals.grossPay,
      totalDeductions: reporting.totals.totalDeductions,
      totalTax: reporting.totals.totalTax,
      totalNetPay: reporting.totals.netPay,
      ...reportingMetadata(reporting),
      breakdown: reporting.rows.map((row) => ({
        month: row.payslip.payPeriod.month,
        paymentDate: row.paymentDate?.toISOString() || null,
        grossPay: row.convertedAmounts?.grossPay ?? null,
        deductions: row.convertedAmounts?.totalDeductions ?? null,
        tax: row.convertedAmounts?.totalTax ?? null,
        netPay: row.convertedAmounts?.netPay ?? null,
        currency: reporting.reportingCurrency,
        sourceCurrency: row.sourceCurrency,
        sourceGrossPay: row.sourceAmounts.grossPay,
        sourceDeductions: row.sourceAmounts.totalDeductions,
        sourceTax: row.sourceAmounts.totalTax,
        sourceNetPay: row.sourceAmounts.netPay,
        exchangeRate: row.reportingRate,
        exchangeRateMetadata: row.rateMetadata,
        conversionWarning: row.conversionWarning,
      }))
    };

    res.json(ytd);
  } catch (err) {
    console.error('YTD Analytics Error:', err);
    res.status(500).json({ error: 'Failed to fetch YTD data' });
  }
});

/**
 * GET /api/payroll/my-ytd
 * Get year-to-date summary for current user
 */
router.get('/my-ytd', requireAuth, async (req, res) => {
  try {
    const { userId, organizationId, role } = getUserInfo(req);
    const { year = new Date().getFullYear() } = req.query;
    const visibleStatuses = getVisiblePayslipStatusesForRole(role);

    const payslips = await Payslip.find({
      userId,
      organizationId,
      'payPeriod.year': parseInt(year),
      status: { $in: visibleStatuses }
    }).sort({ 'payPeriod.paymentDate': 1 });
    const reporting = await payrollReportingService.preparePayslips(
      organizationId,
      payslips
    );

    const ytd = {
      year: parseInt(year),
      totalPayslips: payslips.length,
      totalGrossEarnings: reporting.totals.grossPay,
      totalDeductions: reporting.totals.totalDeductions,
      totalTax: reporting.totals.totalTax,
      totalNetPay: reporting.totals.netPay,
      ...reportingMetadata(reporting),
      breakdown: reporting.rows.map((row) => ({
        month: row.payslip.payPeriod.month,
        periodDisplay: row.payslip.periodDisplay,
        paymentDate: row.paymentDate?.toISOString() || null,
        grossPay: row.convertedAmounts?.grossPay ?? null,
        deductions: row.convertedAmounts?.totalDeductions ?? null,
        tax: row.convertedAmounts?.totalTax ?? null,
        netPay: row.convertedAmounts?.netPay ?? null,
        currency: reporting.reportingCurrency,
        sourceCurrency: row.sourceCurrency,
        sourceGrossPay: row.sourceAmounts.grossPay,
        sourceDeductions: row.sourceAmounts.totalDeductions,
        sourceTax: row.sourceAmounts.totalTax,
        sourceNetPay: row.sourceAmounts.netPay,
        exchangeRate: row.reportingRate,
        exchangeRateMetadata: row.rateMetadata,
        conversionWarning: row.conversionWarning,
      }))
    };

    res.json(ytd);
  } catch (err) {
    console.error('My YTD Error:', err);
    res.status(500).json({ error: 'Failed to fetch YTD data' });
  }
});

module.exports = router;
