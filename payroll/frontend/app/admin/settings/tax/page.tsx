'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Loader2, LockKeyhole, Plus, RefreshCw, Save, ShieldCheck } from 'lucide-react';

import {
  TaxFieldDefinition,
  TaxCertificationReviewRole,
  TaxJurisdictionBacklogGroup,
  TaxJurisdictionDetail,
  TaxJurisdictionVersion,
  createTaxJurisdiction,
  createTaxJurisdictionVersion,
  getTaxJurisdiction,
  listTaxJurisdictionBacklog,
  listTaxJurisdictions,
  previewTaxJurisdiction,
  publishTaxJurisdictionVersion,
  describeTaxFieldCurrency,
  resolveTaxFieldCurrencyCode,
  submitTaxCertificationReview,
  authorizeTaxReviewer,
  revokeTaxReviewer,
  runTaxAutomatedTechnicalReview,
  updateTaxJurisdiction,
} from '@/lib/payrollTax';
import { formatPayrollMoney } from '@/lib/payrollMoney';
import api from '@/lib/api';
import { useUserContext } from '@/lib/hooks';
import {
  StructuredRuleEditor,
  incomeTaxDefaults,
  incomeTaxStrategyOptions,
  statutoryRuleDefaults,
  statutoryStrategyOptions,
} from '@/components/tax/StructuredRuleEditor';

type Draft = {
  label: string;
  effectiveFrom: string;
  effectiveTo: string;
  sourceDate: string;
  validationStatus: 'draft' | 'validated' | 'needs_review';
  calculationStatus: 'runnable' | 'preview_only' | 'blocked';
  calculationCurrency: string;
  coverageLevel: 'national' | 'federal' | 'subdivision' | 'local' | 'organization_override' | 'template';
  coverageModulesText: string;
  coverageExclusionsText: string;
  supportedSubdivisionsText: string;
  fields: TaxFieldDefinition[];
  sourceLinks: NonNullable<TaxJurisdictionVersion['sourceLinks']>;
  constants: Record<string, any>;
  incomeTax: Record<string, any>;
  statutoryRules: any[];
  notesText: string;
  testCases: any[];
  legalOpenIssuesText: string;
};

const types: TaxFieldDefinition['type'][] = ['currency', 'percent', 'integer', 'boolean', 'select', 'text', 'date'];

const dateValue = (value?: string | null) => value ? new Date(value).toISOString().slice(0, 10) : '';
const optionsText = (options?: { value: string; label: string }[]) => (options || []).map((option) => `${option.value}|${option.label}`).join('\n');
const parseOptions = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
  const [rawValue, rawLabel] = line.split('|');
  return { value: String(rawValue || '').trim(), label: String(rawLabel || rawValue || '').trim() };
}).filter((option) => option.value);
const lines = (values?: string[]) => (values || []).join('\n');
const parseLines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean);
const emptyField = (): TaxFieldDefinition => ({ key: '', label: '', type: 'text', required: false, defaultValue: '', options: [] });
const defaultReviewerExpiry = () => {
  const expiry = new Date();
  expiry.setFullYear(expiry.getFullYear() + 1);
  return expiry.toISOString().slice(0, 10);
};

type NewPackDraft = {
  backlogKey: string;
  countryCode: string;
  countryName: string;
  subdivisionCode: string;
  subdivisionName: string;
  localityCode: string;
  localityName: string;
  jurisdictionLevel: 'national' | 'federal' | 'subdivision' | 'local';
  displayName: string;
  description: string;
  calculationCurrency: string;
  effectiveFrom: string;
  coverageModulesText: string;
  coverageExclusionsText: string;
  provenanceReference: string;
};
const createDraft = (version?: TaxJurisdictionVersion | null): Draft => ({
  label: version?.label || 'Draft Version',
  effectiveFrom: dateValue(version?.effectiveFrom) || new Date().toISOString().slice(0, 10),
  effectiveTo: dateValue(version?.effectiveTo),
  sourceDate: dateValue(version?.sourceDate),
  validationStatus: version?.validationStatus || 'draft',
  calculationStatus: version?.calculationStatus || 'blocked',
  calculationCurrency: version?.calculationCurrency || '',
  coverageLevel: version?.coverage?.level || 'organization_override',
  coverageModulesText: lines(version?.coverage?.modules),
  coverageExclusionsText: lines(version?.coverage?.exclusions),
  supportedSubdivisionsText: lines(version?.coverage?.supportedSubdivisions),
  fields: Array.isArray(version?.fieldDefinitions) ? version.fieldDefinitions : [],
  sourceLinks: (version?.sourceLinks || []).map((source) => ({ ...source })),
  constants: { ...(version?.constants || {}) },
  incomeTax: { ...(version?.incomeTax || { strategy: 'none' }) },
  statutoryRules: (version?.statutoryRules || []).map((rule) => ({ ...rule })),
  notesText: (version?.notes || []).join('\n'),
  testCases: (version?.testCases || []).map((testCase) => ({ ...testCase })),
  legalOpenIssuesText: lines(version?.legalOpenIssues),
});

const createNewPackDraft = (): NewPackDraft => ({
  backlogKey: '',
  countryCode: '',
  countryName: '',
  subdivisionCode: '',
  subdivisionName: '',
  localityCode: '',
  localityName: '',
  jurisdictionLevel: 'national',
  displayName: '',
  description: '',
  calculationCurrency: '',
  effectiveFrom: new Date().toISOString().slice(0, 10),
  coverageModulesText: 'income_tax\nstatutory_contributions',
  coverageExclusionsText: 'uncertified_remaining_scope',
  provenanceReference: '',
});

const calculationStatusLabel = (status?: TaxJurisdictionVersion['calculationStatus']) => {
  if (status === 'runnable') return 'Payroll ready';
  if (status === 'preview_only') return 'Test only';
  return 'Needs setup';
};

const calculationStatusClasses = (status?: TaxJurisdictionVersion['calculationStatus']) => {
  if (status === 'runnable') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  if (status === 'preview_only') return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  return 'border-red-500/30 bg-red-500/10 text-red-200';
};

const publishedVersionFor = (jurisdiction: TaxJurisdictionDetail) => jurisdiction.publishedVersion
  || jurisdiction.versions?.find((version) => version._id === jurisdiction.publishedVersionId)
  || jurisdiction.versions?.find((version) => version.status === 'published')
  || null;

const reviewRoleLabel = (role: TaxCertificationReviewRole) => ({
  tax_law: 'Tax law',
  payroll_calculation: 'Payroll calculation',
  independent_qa: 'Independent QA',
}[role]);

export default function TaxSettingsPage() {
  const { user, organization: currentOrganization } = useUserContext();
  const [jurisdictions, setJurisdictions] = useState<TaxJurisdictionDetail[]>([]);
  const [selected, setSelected] = useState<TaxJurisdictionDetail | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [titleDraft, setTitleDraft] = useState({
    displayName: '',
    countryCode: '',
    countryName: '',
    subdivisionCode: '',
    subdivisionName: '',
    localityCode: '',
    localityName: '',
    jurisdictionLevel: 'national' as NonNullable<TaxJurisdictionDetail['jurisdictionLevel']>,
    description: '',
  });
  const [backlogGroups, setBacklogGroups] = useState<TaxJurisdictionBacklogGroup[]>([]);
  const [showNewPackForm, setShowNewPackForm] = useState(false);
  const [newPackDraft, setNewPackDraft] = useState<NewPackDraft>(createNewPackDraft());
  const [draft, setDraft] = useState<Draft>(createDraft());
  const [previewFields, setPreviewFields] = useState<Record<string, any>>({});
  const [previewBase, setPreviewBase] = useState({ basicSalary: 500000, grossPay: 500000, taxableIncome: 500000, payFrequency: 'monthly' });
  const [previewResult, setPreviewResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [reviewDraft, setReviewDraft] = useState<{
    role: TaxCertificationReviewRole;
    decision: 'approved' | 'changes_requested' | 'rejected';
    sourceReferencesText: string;
    fixtureRunReference: string;
    notes: string;
  }>({
    role: 'tax_law',
    decision: 'approved',
    sourceReferencesText: '',
    fixtureRunReference: '',
    notes: '',
  });
  const [organizationMembers, setOrganizationMembers] = useState<Array<{ userId: string; name: string; email: string }>>([]);
  const [reviewerDraft, setReviewerDraft] = useState({
    userId: '',
    roles: ['payroll_calculation'] as TaxCertificationReviewRole[],
    credentialType: 'internal_appointment' as 'professional_license' | 'professional_membership' | 'engagement' | 'internal_appointment',
    credentialReference: '',
    expiresAt: defaultReviewerExpiry(),
    notes: '',
  });

  const selectedVersion = selected?.versions?.find((version) => version._id === selectedVersionId)
    || selected?.versions?.find((version) => version._id === selected?.publishedVersionId)
    || selected?.versions?.[0]
    || null;
  const latestAutomatedReview = selectedVersion?.automatedTechnicalReviews?.[
    (selectedVersion.automatedTechnicalReviews?.length || 1) - 1
  ] || null;
  const platformRelease = selectedVersion?.certification?.platformRelease || selectedVersion?.platformRelease || null;
  const isPlatformRelease = selectedVersion?.certification?.certificationMode === 'platform_release' || !!platformRelease;
  const canManage = selected?.scope === 'organization';
  const canEdit = canManage && selectedVersion?.status !== 'published' && selectedVersion?.status !== 'archived';
  const currentUserId = String(user?.sub || user?.id || '').trim();
  const canManageReviewerRegistry = canManage && ['owner', 'admin'].includes(currentOrganization?.role || '');
  const currentReviewAuthorization = selected?.reviewTeam?.find((authorization) => (
    authorization.userId === currentUserId
    && authorization.status === 'active'
    && authorization.roles.includes(reviewDraft.role)
    && !!authorization.expiresAt
    && new Date(authorization.expiresAt).getTime() > Date.now()
  )) || null;
  const newPackNeedsSubdivision = ['subdivision', 'local'].includes(newPackDraft.jurisdictionLevel);
  const newPackNeedsLocality = newPackDraft.jurisdictionLevel === 'local';
  const canCreateNewPack = !!(
    newPackDraft.countryCode.trim().length === 2
    && newPackDraft.countryName.trim()
    && newPackDraft.displayName.trim()
    && newPackDraft.calculationCurrency.trim().length === 3
    && newPackDraft.effectiveFrom
    && parseLines(newPackDraft.coverageModulesText).length
    && parseLines(newPackDraft.coverageExclusionsText).length
    && (!newPackNeedsSubdivision || (newPackDraft.subdivisionCode.trim() && newPackDraft.subdivisionName.trim()))
    && (!newPackNeedsLocality || (newPackDraft.localityCode.trim() && newPackDraft.localityName.trim()))
  );

  const applySelection = (next: TaxJurisdictionDetail | null) => {
    setSelected(next);
    const version = next?.versions?.find((entry) => entry._id === next?.publishedVersionId) || next?.versions?.[0] || null;
    setSelectedVersionId(version?._id || '');
    setTitleDraft({
      displayName: next?.displayName || '',
      countryCode: next?.countryCode || '',
      countryName: next?.countryName || '',
      subdivisionCode: next?.subdivisionCode || '',
      subdivisionName: next?.subdivisionName || '',
      localityCode: next?.localityCode || '',
      localityName: next?.localityName || '',
      jurisdictionLevel: next?.jurisdictionLevel || 'national',
      description: next?.description || '',
    });
    setDraft(createDraft(version));
    const defaults: Record<string, any> = {};
    for (const field of version?.fieldDefinitions || []) defaults[field.key] = field.defaultValue ?? (field.type === 'boolean' ? false : '');
    setPreviewFields(defaults);
    setReviewDraft((current) => ({
      ...current,
      sourceReferencesText: (version?.sourceLinks || [])
        .filter((source) => source.isPrimary !== false && source.authorityType !== 'secondary')
        .map((source) => source.label)
        .join('\n'),
    }));
  };

  const loadData = useCallback(async (nextId?: string) => {
    setLoading(true);
    setError('');
    try {
      const [summaries, membersResponse, rolloutBacklog] = await Promise.all([
        listTaxJurisdictions(),
        api.get('/payroll/idp/members').catch(() => null),
        listTaxJurisdictionBacklog().catch(() => []),
      ]);
      const details = await Promise.all(summaries.map((summary) => getTaxJurisdiction(summary._id)));
      setJurisdictions(details);
      setBacklogGroups(Array.isArray(rolloutBacklog) ? rolloutBacklog : []);
      const members = Array.isArray(membersResponse?.data?.members) ? membersResponse.data.members : [];
      setOrganizationMembers(members.map((member: any) => ({
        userId: String(member?.sub || member?.id || '').trim(),
        name: String(member?.name || member?.displayName || [member?.given_name, member?.family_name].filter(Boolean).join(' ') || member?.email || '').trim(),
        email: String(member?.email || '').trim(),
      })).filter((member: { userId: string; name: string }) => member.userId && member.name));
      applySelection(details.find((item) => item._id === nextId) || details.find((item) => item._id === selected?._id) || details[0] || null);
    } catch (fetchError: any) {
      setError(fetchError?.response?.data?.error || 'Failed to load tax jurisdictions');
    } finally {
      setLoading(false);
    }
  }, [selected?._id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const setField = (index: number, patch: Partial<TaxFieldDefinition>) => setDraft((current) => ({
    ...current,
    fields: current.fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field),
  }));

  const backlogEntries = backlogGroups.flatMap((group) => group.entries.map((entry) => ({
    group,
    entry,
    key: `${group.id}:${entry.code}`,
  })));

  const selectBacklogEntry = (backlogKey: string) => {
    const selectedBacklog = backlogEntries.find((item) => item.key === backlogKey);
    if (!selectedBacklog) {
      setNewPackDraft((current) => ({ ...createNewPackDraft(), backlogKey: '' }));
      return;
    }
    const { entry, group } = selectedBacklog;
    const defaultCurrency = group.id === 'US_STATES_AND_DC'
      ? 'USD'
      : (group.id === 'CANADA_PROVINCES_AND_TERRITORIES' ? 'CAD' : '');
    setNewPackDraft((current) => ({
      ...current,
      backlogKey,
      countryCode: entry.countryCode,
      countryName: entry.countryName,
      subdivisionCode: entry.subdivisionCode || '',
      subdivisionName: entry.subdivisionName || '',
      localityCode: '',
      localityName: '',
      jurisdictionLevel: entry.jurisdictionLevel,
      displayName: entry.displayName || `${entry.name || entry.countryName} payroll`,
      calculationCurrency: defaultCurrency,
      provenanceReference: `${group.id}:${entry.code}`,
    }));
  };

  const createNewPack = async () => {
    setSaving(true); setError(''); setFeedback('');
    try {
      const selectedBacklog = backlogEntries.find((item) => item.key === newPackDraft.backlogKey);
      const created = await createTaxJurisdiction({
        ...(selectedBacklog ? {
          backlogReference: {
            groupId: selectedBacklog.group.id,
            entryCode: selectedBacklog.entry.code,
          },
        } : {
          countryCode: newPackDraft.countryCode,
          countryName: newPackDraft.countryName,
          subdivisionCode: newPackDraft.subdivisionCode,
          subdivisionName: newPackDraft.subdivisionName,
          localityCode: newPackDraft.localityCode,
          localityName: newPackDraft.localityName,
          jurisdictionLevel: newPackDraft.jurisdictionLevel,
        }),
        displayName: newPackDraft.displayName,
        description: newPackDraft.description,
        provenanceReference: newPackDraft.provenanceReference,
        version: {
          label: 'Research draft',
          effectiveFrom: newPackDraft.effectiveFrom,
          calculationCurrency: newPackDraft.calculationCurrency.trim().toUpperCase(),
          coverage: {
            level: newPackDraft.jurisdictionLevel,
            modules: parseLines(newPackDraft.coverageModulesText),
            exclusions: parseLines(newPackDraft.coverageExclusionsText),
            supportedSubdivisions: [],
          },
        },
      });
      await loadData(created._id);
      setNewPackDraft(createNewPackDraft());
      setShowNewPackForm(false);
      setFeedback('Created a blocked organization draft. It cannot run payroll until its legal and certification gates pass.');
    } catch (createError: any) {
      setError(createError?.response?.data?.error || 'Failed to create a tax rule');
    } finally { setSaving(false); }
  };

  const cloneSelected = async () => {
    if (!selected?._id) return;
    setSaving(true); setError(''); setFeedback('');
    try {
      const created = await createTaxJurisdiction({ cloneFromId: selected._id, displayName: `${selected.displayName} Override`, countryCode: selected.countryCode, countryName: selected.countryName });
      await loadData(created._id);
      setFeedback('Cloned the selected jurisdiction.');
    } catch (cloneError: any) {
      setError(cloneError?.response?.data?.error || 'Failed to clone the selected jurisdiction');
    } finally { setSaving(false); }
  };

  const saveChanges = async () => {
    if (!selected?._id || !canEdit) return;
    setSaving(true); setError(''); setFeedback('');
    try {
      await updateTaxJurisdiction(selected._id, {
        displayName: titleDraft.displayName,
        countryCode: titleDraft.countryCode,
        countryName: titleDraft.countryName,
        subdivisionCode: titleDraft.subdivisionCode,
        subdivisionName: titleDraft.subdivisionName,
        localityCode: titleDraft.localityCode,
        localityName: titleDraft.localityName,
        jurisdictionLevel: titleDraft.jurisdictionLevel,
        description: titleDraft.description,
        versionId: selectedVersionId,
        version: {
          label: draft.label,
          effectiveFrom: draft.effectiveFrom,
          effectiveTo: draft.effectiveTo || null,
          sourceDate: draft.sourceDate || null,
          validationStatus: draft.validationStatus,
          calculationStatus: draft.calculationStatus,
          calculationCurrency: draft.calculationCurrency.trim().toUpperCase(),
          coverage: {
            level: draft.coverageLevel,
            modules: parseLines(draft.coverageModulesText),
            exclusions: parseLines(draft.coverageExclusionsText),
            supportedSubdivisions: parseLines(draft.supportedSubdivisionsText),
          },
          fieldDefinitions: draft.fields,
          sourceLinks: draft.sourceLinks,
          constants: draft.constants,
          incomeTax: draft.incomeTax,
          statutoryRules: draft.statutoryRules,
          notes: draft.notesText.split('\n').map((line) => line.trim()).filter(Boolean),
          testCases: draft.testCases,
          legalOpenIssues: parseLines(draft.legalOpenIssuesText),
        },
      });
      await loadData(selected._id);
      setFeedback('Saved tax jurisdiction changes.');
    } catch (saveError: any) {
      setError(saveError?.response?.data?.error || saveError?.message || 'Failed to save tax jurisdiction');
    } finally { setSaving(false); }
  };

  const newDraftVersion = async () => {
    if (!selected?._id || !selectedVersion || !canManage) return;
    setSaving(true); setError(''); setFeedback('');
    try {
      const createdVersion = await createTaxJurisdictionVersion(selected._id, { ...selectedVersion, label: `${selectedVersion.label} Draft`, validationStatus: 'draft' });
      await loadData(selected._id);
      setSelectedVersionId(createdVersion._id);
      setFeedback('Created a new blocked draft version. Prior certification reviews were not copied.');
    } catch (versionError: any) {
      setError(versionError?.response?.data?.error || 'Failed to create a draft version');
    } finally { setSaving(false); }
  };

  const publishVersion = async () => {
    if (!selected?._id || !selectedVersionId || !canEdit) return;
    setSaving(true); setError(''); setFeedback('');
    try {
      await publishTaxJurisdictionVersion(selected._id, selectedVersionId);
      await loadData(selected._id);
      setFeedback('Published the selected version.');
    } catch (publishError: any) {
      const details = publishError?.response?.data?.details;
      setError([
        publishError?.response?.data?.error || 'Failed to publish the selected version',
        ...(Array.isArray(details) ? details : []),
      ].join(' '));
    } finally { setSaving(false); }
  };

  const runAutomatedTechnicalReview = async () => {
    if (!selected?._id || !selectedVersionId || !canEdit) return;
    setSaving(true); setError(''); setFeedback('');
    try {
      const result = await runTaxAutomatedTechnicalReview(selected._id, selectedVersionId, {
        summary: 'Deterministic technical gates requested from the tax rule editor.',
      });
      await loadData(selected._id);
      setFeedback(result.evidence.objectiveStatus === 'passed'
        ? 'Objective technical gates passed. Human legal, payroll, QA, and publisher approvals are still required.'
        : 'Technical review recorded failures. The pack remains blocked.');
    } catch (reviewError: any) {
      const details = reviewError?.response?.data?.details;
      setError([
        reviewError?.response?.data?.error || 'Failed to run automated technical gates',
        ...(Array.isArray(details) ? details : []),
      ].join(' '));
    } finally { setSaving(false); }
  };

  const submitReview = async () => {
    if (!selected?._id || !selectedVersionId || !canEdit) return;
    if (!currentReviewAuthorization) {
      setError(`You do not have an active reviewer authorization for ${reviewRoleLabel(reviewDraft.role)}.`);
      return;
    }
    setSaving(true); setError(''); setFeedback('');
    try {
      await submitTaxCertificationReview(selected._id, selectedVersionId, {
        role: reviewDraft.role,
        decision: reviewDraft.decision,
        sourceReferences: parseLines(reviewDraft.sourceReferencesText),
        fixtureRunReference: reviewDraft.fixtureRunReference,
        notes: reviewDraft.notes,
      });
      await loadData(selected._id);
      setReviewDraft((current) => ({
        ...current,
        fixtureRunReference: '',
        notes: '',
      }));
      setFeedback('Certification review recorded against the current rule content.');
    } catch (reviewError: any) {
      const details = reviewError?.response?.data?.details;
      setError([
        reviewError?.response?.data?.error || 'Failed to record certification review',
        ...(Array.isArray(details) ? details : []),
      ].join(' '));
    } finally { setSaving(false); }
  };

  const authorizeReviewer = async () => {
    if (!selected?._id || !reviewerDraft.userId || reviewerDraft.roles.length === 0) return;
    const member = organizationMembers.find((entry) => entry.userId === reviewerDraft.userId);
    if (!member) return;
    if (member.userId === currentUserId) {
      setError('You cannot verify your own tax reviewer authorization.');
      return;
    }
    if (!reviewerDraft.expiresAt || new Date(reviewerDraft.expiresAt).getTime() <= Date.now()) {
      setError('Reviewer authorization requires a future expiry date.');
      return;
    }
    if (reviewerDraft.roles.includes('tax_law') && reviewerDraft.credentialType === 'internal_appointment') {
      setError('Tax-law reviewers require a professional credential or external engagement.');
      return;
    }
    setSaving(true); setError(''); setFeedback('');
    try {
      await authorizeTaxReviewer(selected._id, {
        userId: member.userId,
        roles: reviewerDraft.roles,
        credentialType: reviewerDraft.credentialType,
        credentialReference: reviewerDraft.credentialReference,
        expiresAt: reviewerDraft.expiresAt || null,
        notes: reviewerDraft.notes,
      });
      await loadData(selected._id);
      setReviewerDraft((current) => ({
        ...current,
        userId: '',
        credentialReference: '',
        expiresAt: defaultReviewerExpiry(),
        notes: '',
      }));
      setFeedback('Reviewer authorization added for this jurisdiction.');
    } catch (authorizationError: any) {
      setError(authorizationError?.response?.data?.error || 'Failed to authorize reviewer');
    } finally { setSaving(false); }
  };

  const revokeReviewer = async (authorizationId: string) => {
    if (!selected?._id || !window.confirm('Revoke this reviewer authorization? Existing reviews will stop counting for publication.')) return;
    setSaving(true); setError(''); setFeedback('');
    try {
      await revokeTaxReviewer(selected._id, authorizationId);
      await loadData(selected._id);
      setFeedback('Reviewer authorization revoked.');
    } catch (revokeError: any) {
      setError(revokeError?.response?.data?.error || 'Failed to revoke reviewer authorization');
    } finally { setSaving(false); }
  };

  const runPreview = async () => {
    setPreviewing(true); setError('');
    try {
      const constants = draft.constants;
      const taxYearMode = typeof constants?.taxYearMode === 'string'
        ? constants.taxYearMode
        : (selectedVersion?.taxYear?.mode || 'calendar');
      setPreviewResult(await previewTaxJurisdiction({
        basicSalary: Number(previewBase.basicSalary || 0),
        grossPay: Number(previewBase.grossPay || 0),
        taxableIncome: Number(previewBase.taxableIncome || 0),
        payFrequency: previewBase.payFrequency,
        taxConfig: { jurisdictionConfigId: selected?._id, jurisdictionCode: titleDraft.countryCode, jurisdictionName: titleDraft.displayName, employeeTaxInputs: previewFields },
        versionDefinition: {
          label: draft.label,
          effectiveFrom: draft.effectiveFrom,
          effectiveTo: draft.effectiveTo || null,
          sourceDate: draft.sourceDate || null,
          validationStatus: draft.validationStatus,
          calculationStatus: draft.calculationStatus,
          calculationCurrency: draft.calculationCurrency.trim().toUpperCase(),
          coverage: {
            level: draft.coverageLevel,
            modules: parseLines(draft.coverageModulesText),
            exclusions: parseLines(draft.coverageExclusionsText),
            supportedSubdivisions: parseLines(draft.supportedSubdivisionsText),
          },
          fieldDefinitions: draft.fields,
          sourceLinks: draft.sourceLinks,
          constants,
          incomeTax: draft.incomeTax,
          statutoryRules: draft.statutoryRules,
          testCases: draft.testCases,
          legalOpenIssues: parseLines(draft.legalOpenIssuesText),
          taxYear: { mode: taxYearMode },
        } as any,
      }));
    } catch (previewError: any) {
      setError(previewError?.response?.data?.error || previewError?.message || 'Failed to preview the tax rule');
    } finally { setPreviewing(false); }
  };

  if (loading) return <div className="min-h-[60vh] flex items-center justify-center text-zinc-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading tax jurisdictions...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-semibold text-zinc-100">Tax Rules</h1><p className="text-sm text-zinc-400 mt-1">Review payroll readiness, legal coverage, sources, and effective-dated calculation packs.</p></div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => loadData(selected?._id)} className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-200 text-sm flex items-center gap-2"><RefreshCw className="w-4 h-4" />Refresh</button>
          <button onClick={() => setShowNewPackForm((current) => !current)} disabled={saving} className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-200 text-sm flex items-center gap-2"><Plus className="w-4 h-4" />New jurisdiction</button>
          <button onClick={cloneSelected} disabled={!selected?._id || saving} className="px-3 py-2 rounded-lg bg-amber-600 text-white text-sm flex items-center gap-2"><Copy className="w-4 h-4" />{selected?.scope === 'global' ? 'Customize copy' : 'Clone selected'}</button>
        </div>
      </div>
      {feedback ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{feedback}</div> : null}
      {error ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}
      {showNewPackForm ? (
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-5" aria-labelledby="new-tax-jurisdiction">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800 pb-4">
            <div>
              <h2 id="new-tax-jurisdiction" className="text-base font-semibold text-zinc-100">Create jurisdiction draft</h2>
              <p className="mt-1 text-sm text-zinc-400">Choose a documented rollout item or enter an ISO country, subdivision, or local authority. Every new pack starts blocked.</p>
            </div>
            <button type="button" onClick={() => { setShowNewPackForm(false); setNewPackDraft(createNewPackDraft()); }} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300">Cancel</button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm text-zinc-400 md:col-span-2 lg:col-span-4">Rollout backlog item
              <select value={newPackDraft.backlogKey} onChange={(event) => selectBacklogEntry(event.target.value)} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100">
                <option value="">Manual ISO jurisdiction</option>
                {backlogGroups.map((group) => (
                  <optgroup key={group.id} label={group.label}>
                    {group.entries.map((entry) => (
                      <option key={`${group.id}:${entry.code}`} value={`${group.id}:${entry.code}`} disabled={!!entry.existingDraft}>
                        {entry.code} - {entry.name}{entry.existingDraft ? ' (draft exists)' : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="text-sm text-zinc-400">Coverage level
              <select value={newPackDraft.jurisdictionLevel} disabled={!!newPackDraft.backlogKey} onChange={(event) => setNewPackDraft({ ...newPackDraft, jurisdictionLevel: event.target.value as NewPackDraft['jurisdictionLevel'] })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100 disabled:text-zinc-500">
                <option value="national">National</option><option value="federal">Federal</option><option value="subdivision">Subdivision</option><option value="local">Local</option>
              </select>
            </label>
            <label className="text-sm text-zinc-400">Country code
              <input value={newPackDraft.countryCode} disabled={!!newPackDraft.backlogKey} onChange={(event) => setNewPackDraft({ ...newPackDraft, countryCode: event.target.value.toUpperCase() })} maxLength={2} placeholder="ISO alpha-2" className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100 disabled:text-zinc-500" />
            </label>
            <label className="text-sm text-zinc-400 md:col-span-2">Country name
              <input value={newPackDraft.countryName} disabled={!!newPackDraft.backlogKey} onChange={(event) => setNewPackDraft({ ...newPackDraft, countryName: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100 disabled:text-zinc-500" />
            </label>
            {newPackNeedsSubdivision ? (
              <>
                <label className="text-sm text-zinc-400">Subdivision code
                  <input value={newPackDraft.subdivisionCode} disabled={!!newPackDraft.backlogKey} onChange={(event) => setNewPackDraft({ ...newPackDraft, subdivisionCode: event.target.value.toUpperCase() })} placeholder={`${newPackDraft.countryCode || 'XX'}-...`} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100 disabled:text-zinc-500" />
                </label>
                <label className="text-sm text-zinc-400">Subdivision name
                  <input value={newPackDraft.subdivisionName} disabled={!!newPackDraft.backlogKey} onChange={(event) => setNewPackDraft({ ...newPackDraft, subdivisionName: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100 disabled:text-zinc-500" />
                </label>
              </>
            ) : null}
            {newPackNeedsLocality ? (
              <>
                <label className="text-sm text-zinc-400">Local authority code
                  <input value={newPackDraft.localityCode} onChange={(event) => setNewPackDraft({ ...newPackDraft, localityCode: event.target.value.toUpperCase() })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" />
                </label>
                <label className="text-sm text-zinc-400">Locality name
                  <input value={newPackDraft.localityName} onChange={(event) => setNewPackDraft({ ...newPackDraft, localityName: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" />
                </label>
              </>
            ) : null}
            <label className="text-sm text-zinc-400 md:col-span-2">Display name
              <input value={newPackDraft.displayName} onChange={(event) => setNewPackDraft({ ...newPackDraft, displayName: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" />
            </label>
            <label className="text-sm text-zinc-400">Calculation currency
              <input value={newPackDraft.calculationCurrency} onChange={(event) => setNewPackDraft({ ...newPackDraft, calculationCurrency: event.target.value.toUpperCase() })} maxLength={3} placeholder="ISO 4217" className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" />
            </label>
            <label className="text-sm text-zinc-400">Effective from
              <input type="date" value={newPackDraft.effectiveFrom} onChange={(event) => setNewPackDraft({ ...newPackDraft, effectiveFrom: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" />
            </label>
            <label className="text-sm text-zinc-400 md:col-span-2">Included modules (one per line)
              <textarea rows={3} value={newPackDraft.coverageModulesText} onChange={(event) => setNewPackDraft({ ...newPackDraft, coverageModulesText: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" />
            </label>
            <label className="text-sm text-zinc-400 md:col-span-2">Known exclusions (one per line)
              <textarea rows={3} value={newPackDraft.coverageExclusionsText} onChange={(event) => setNewPackDraft({ ...newPackDraft, coverageExclusionsText: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" />
            </label>
            <label className="text-sm text-zinc-400 md:col-span-2">Work item or evidence reference
              <input value={newPackDraft.provenanceReference} onChange={(event) => setNewPackDraft({ ...newPackDraft, provenanceReference: event.target.value })} placeholder="Ticket, engagement, or research reference" className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" />
            </label>
            <label className="text-sm text-zinc-400 md:col-span-2">Description
              <input value={newPackDraft.description} onChange={(event) => setNewPackDraft({ ...newPackDraft, description: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-zinc-800 pt-4">
            <button type="button" onClick={createNewPack} disabled={saving || !canCreateNewPack} className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50">Create blocked draft</button>
            <p className="text-xs text-zinc-500">Official source snapshots, formulas, liabilities, fixtures, three independent reviews, and a separate publisher remain mandatory before payroll use.</p>
          </div>
        </section>
      ) : null}
      <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-6">
        <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
          {jurisdictions.map((item) => {
            const calculationStatus = publishedVersionFor(item)?.calculationStatus || 'blocked';
            return (
              <button
                key={item._id}
                onClick={() => applySelection(item)}
                className={`w-full rounded-lg border px-3 py-3 text-left ${selected?._id === item._id ? 'border-amber-500/50 bg-amber-500/10' : 'border-zinc-800 bg-zinc-950/50 hover:bg-zinc-900'}`}
              >
                <span className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block text-sm font-semibold text-zinc-100">{item.displayName}</span>
                    <span className="mt-1 block text-xs text-zinc-500">{item.countryCode} · {item.scope}</span>
                  </span>
                  <span className={`rounded-md border px-2 py-1 text-[11px] font-medium ${calculationStatusClasses(calculationStatus)}`}>
                    {calculationStatusLabel(calculationStatus)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="space-y-6">
          {selected ? (
            <>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div><h2 className="text-lg font-semibold text-zinc-100">{selected.displayName}</h2><p className="text-sm text-zinc-500 mt-1">{selected.scope === 'global' ? 'Published platform packs are protected. Create an editable organization copy to customize fields, formulas, and advanced rules.' : 'Organization-owned rule. Owners and administrators publish reviewed versions.'}</p></div>
                  {canManage ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={newDraftVersion} disabled={saving} className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-200 text-sm disabled:opacity-50">New Draft Version</button>
                      <button onClick={saveChanges} disabled={!canEdit || saving} className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-200 text-sm flex items-center gap-2"><Save className="w-4 h-4" />Save</button>
                      <button onClick={publishVersion} disabled={!canEdit || saving || !selectedVersionId} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />Publish</button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                        <CheckCircle2 className="h-4 w-4" />Published platform pack
                      </span>
                      <button type="button" onClick={cloneSelected} disabled={saving} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-500/50 px-3 text-sm font-medium text-amber-200 hover:bg-amber-500/10 disabled:opacity-50">
                        <Copy className="h-4 w-4" />Customize editable copy
                      </button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input value={titleDraft.displayName} disabled={!canEdit} onChange={(e) => setTitleDraft({ ...titleDraft, displayName: e.target.value })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="Display name" />
                  <input value={titleDraft.countryName} disabled={!canEdit} onChange={(e) => setTitleDraft({ ...titleDraft, countryName: e.target.value })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="Country name" />
                  <input value={titleDraft.countryCode} disabled={!canEdit} onChange={(e) => setTitleDraft({ ...titleDraft, countryCode: e.target.value.toUpperCase() })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="Country code" />
                  <select value={titleDraft.jurisdictionLevel} disabled={!canEdit} onChange={(e) => setTitleDraft({ ...titleDraft, jurisdictionLevel: e.target.value as typeof titleDraft.jurisdictionLevel })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100"><option value="national">National</option><option value="federal">Federal</option><option value="subdivision">Subdivision</option><option value="local">Local</option><option value="organization_override">Organization override</option><option value="template">Template</option></select>
                  {['subdivision', 'local'].includes(titleDraft.jurisdictionLevel) ? <input value={titleDraft.subdivisionCode} disabled={!canEdit} onChange={(e) => setTitleDraft({ ...titleDraft, subdivisionCode: e.target.value.toUpperCase() })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="ISO subdivision code" /> : null}
                  {['subdivision', 'local'].includes(titleDraft.jurisdictionLevel) ? <input value={titleDraft.subdivisionName} disabled={!canEdit} onChange={(e) => setTitleDraft({ ...titleDraft, subdivisionName: e.target.value })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="Subdivision name" /> : null}
                  {titleDraft.jurisdictionLevel === 'local' ? <input value={titleDraft.localityCode} disabled={!canEdit} onChange={(e) => setTitleDraft({ ...titleDraft, localityCode: e.target.value.toUpperCase() })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="Local authority code" /> : null}
                  {titleDraft.jurisdictionLevel === 'local' ? <input value={titleDraft.localityName} disabled={!canEdit} onChange={(e) => setTitleDraft({ ...titleDraft, localityName: e.target.value })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="Locality name" /> : null}
                  <select value={selectedVersionId} onChange={(e) => { setSelectedVersionId(e.target.value); setDraft(createDraft(selected.versions.find((version) => version._id === e.target.value) || null)); }} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100">{selected.versions.map((version) => <option key={version._id} value={version._id}>V{version.versionNumber} · {version.label}</option>)}</select>
                  <input value={draft.label} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, label: e.target.value })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" placeholder="Version label" />
                  <select value={draft.validationStatus} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, validationStatus: e.target.value as Draft['validationStatus'] })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100"><option value="draft">Draft</option><option value="validated">Validated</option><option value="needs_review">Needs review</option></select>
                  <input value={titleDraft.description} disabled={!canEdit} onChange={(e) => setTitleDraft({ ...titleDraft, description: e.target.value })} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100 md:col-span-2" placeholder="Jurisdiction description" />
                </div>
                {selected.creationProvenance ? (
                  <p className="border-t border-zinc-800 pt-3 text-xs text-zinc-500">
                    Created from {selected.creationProvenance.kind.replaceAll('_', ' ')}
                    {selected.creationProvenance.backlogEntryCode ? ` Â· ${selected.creationProvenance.backlogEntryCode}` : ''}
                    {selected.creationProvenance.reference ? ` Â· ${selected.creationProvenance.reference}` : ''}
                  </p>
                ) : null}
              </div>
              {selectedVersion ? (
                <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5" aria-labelledby="tax-pack-readiness">
                  <div className="flex flex-col gap-3 border-b border-zinc-800 pb-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3">
                      {selectedVersion.calculationStatus === 'runnable'
                        ? <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-400" />
                        : selectedVersion.calculationStatus === 'preview_only'
                          ? <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-400" />
                          : <LockKeyhole className="mt-0.5 h-5 w-5 text-red-400" />}
                      <div>
                        <h3 id="tax-pack-readiness" className="text-base font-semibold text-zinc-100">Payroll readiness</h3>
                        <p className="mt-1 text-sm text-zinc-400">
                          {selectedVersion.calculationStatus === 'runnable'
                            ? 'This published calculation pack may be used in payroll runs for its stated coverage.'
                            : selectedVersion.calculationStatus === 'preview_only'
                              ? 'Calculations are available for review, but payroll runs are blocked until the pack is certified.'
                              : 'This pack is not allowed to calculate payroll.'}
                        </p>
                      </div>
                    </div>
                    <span className={`self-start rounded-md border px-2.5 py-1 text-xs font-medium ${calculationStatusClasses(selectedVersion.calculationStatus)}`}>
                      {calculationStatusLabel(selectedVersion.calculationStatus)}
                    </span>
                  </div>

                  {selectedVersion.status === 'published' ? (
                    <div className="mt-4 flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2.5 text-xs text-zinc-400">
                      <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Published versions are immutable. Create a new draft version to change dates, coverage, sources, or formulas.
                    </div>
                  ) : null}

                  <div className="mt-4 border-y border-zinc-800 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-medium text-zinc-200">Automated technical gates</h4>
                        <p className="mt-1 text-xs text-zinc-500">Machine evidence checks sources, formula safety, fixture execution, liabilities, tenant scope, and immutability. Organization-authored packs still require independent human certification.</p>
                      </div>
                      {canEdit ? <button type="button" onClick={runAutomatedTechnicalReview} disabled={saving} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 disabled:opacity-50">Run technical gates</button> : null}
                    </div>
                    {latestAutomatedReview ? (
                      <div className="mt-3 text-sm text-zinc-400">
                        <p>
                          {latestAutomatedReview.objectiveStatus === 'passed' ? 'Objective gates passed' : 'Objective gates failed'}
                          {' / '}{latestAutomatedReview.generatedByAI ? 'AI-assisted evidence' : 'Deterministic evidence'}
                          {' / '}{isPlatformRelease ? 'production release approved' : 'human certification still required'}
                        </p>
                        {latestAutomatedReview.unresolvedLegalContradictions?.length ? (
                          <ul className="mt-2 border-l-2 border-red-500/60 pl-3 text-sm text-red-200">
                            {latestAutomatedReview.unresolvedLegalContradictions.map((issue) => <li key={issue}>{issue}</li>)}
                          </ul>
                        ) : null}
                        {latestAutomatedReview.checks.some((check) => check.status === 'failed') ? (
                          <ul className="mt-2 space-y-1 text-xs text-amber-200/80">
                            {latestAutomatedReview.checks.filter((check) => check.status === 'failed').map((check) => (
                              <li key={check.code}>{check.code.replaceAll('_', ' ')}: {(check.details || []).join(' ')}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : <p className="mt-3 text-xs text-zinc-600">No automated technical evidence has been recorded for this version.</p>}
                  </div>

                  <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                    <div><dt className="text-zinc-500">Version</dt><dd className="mt-0.5 text-zinc-200">V{selectedVersion.versionNumber} · {selectedVersion.status || 'draft'}</dd></div>
                    <div><dt className="text-zinc-500">Validation</dt><dd className="mt-0.5 text-zinc-200">{selectedVersion.validationStatus?.replace('_', ' ') || 'draft'}</dd></div>
                    <div><dt className="text-zinc-500">Calculation currency</dt><dd className="mt-0.5 text-zinc-200">{selectedVersion.calculationCurrency || 'Not configured'}</dd></div>
                    <div><dt className="text-zinc-500">Effective from</dt><dd className="mt-0.5 text-zinc-200">{new Date(selectedVersion.effectiveFrom).toLocaleDateString()}</dd></div>
                    <div><dt className="text-zinc-500">Effective to</dt><dd className="mt-0.5 text-zinc-200">{selectedVersion.effectiveTo ? new Date(selectedVersion.effectiveTo).toLocaleDateString() : 'Open ended'}</dd></div>
                    <div><dt className="text-zinc-500">Coverage level</dt><dd className="mt-0.5 text-zinc-200">{selectedVersion.coverage?.level?.replace('_', ' ') || 'Not declared'}</dd></div>
                  </dl>

                  <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
                    <div>
                      <h4 className="text-sm font-medium text-zinc-200">Included modules</h4>
                      {selectedVersion.coverage?.modules?.length ? (
                        <ul className="mt-2 space-y-1 text-sm text-zinc-400">
                          {selectedVersion.coverage.modules.map((module) => <li key={module}>• {module}</li>)}
                        </ul>
                      ) : <p className="mt-2 text-sm text-zinc-500">No coverage modules declared.</p>}
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-zinc-200">Known exclusions</h4>
                      {selectedVersion.coverage?.exclusions?.length ? (
                        <ul className="mt-2 space-y-1 text-sm text-amber-200/80">
                          {selectedVersion.coverage.exclusions.map((exclusion) => <li key={exclusion}>• {exclusion}</li>)}
                        </ul>
                      ) : <p className="mt-2 text-sm text-zinc-500">No exclusions declared.</p>}
                    </div>
                  </div>

                  {selectedVersion.coverage?.supportedSubdivisions?.length ? (
                    <div className="mt-5">
                      <h4 className="text-sm font-medium text-zinc-200">Supported subdivisions</h4>
                      <p className="mt-2 text-sm text-zinc-400">{selectedVersion.coverage.supportedSubdivisions.join(', ')}</p>
                    </div>
                  ) : null}

                  <div className="mt-5 border-t border-zinc-800 pt-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h4 className="text-sm font-medium text-zinc-200">Official sources</h4>
                        {selectedVersion.sourceLinks?.length ? (
                          <ul className="mt-2 space-y-1.5">
                            {selectedVersion.sourceLinks.map((source) => (
                              <li key={`${source.label}-${source.url}`} className="border-l border-zinc-800 pl-3">
                                <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-amber-300 hover:text-amber-200">
                                  {source.label}<ExternalLink className="h-3.5 w-3.5" />
                                </a>
                                <p className="mt-0.5 text-[11px] text-zinc-500">
                                  {source.isPrimary === false ? 'Secondary material' : 'Primary material'}
                                  {source.authorityType ? ` · ${source.authorityType.replaceAll('_', ' ')}` : ''}
                                  {source.checkedAt ? ` · checked ${new Date(source.checkedAt).toLocaleDateString()}` : ' · legal check missing'}
                                </p>
                                <p className="mt-0.5 font-mono text-[10px] text-zinc-600">
                                  {source.contentDigestSha256
                                    ? `SHA-256 ${source.contentDigestSha256.slice(0, 16)}…`
                                    : 'Reviewed-content digest missing'}
                                  {source.retrievedAt ? ` · retrieved ${new Date(source.retrievedAt).toLocaleDateString()}` : ''}
                                </p>
                              </li>
                            ))}
                          </ul>
                        ) : <p className="mt-2 text-sm text-red-300">No source has been attached.</p>}
                      </div>
                      <dl className="text-xs text-zinc-500 lg:text-right">
                        <div><dt className="inline">Source date: </dt><dd className="inline text-zinc-300">{selectedVersion.sourceDate ? new Date(selectedVersion.sourceDate).toLocaleDateString() : 'Not recorded'}</dd></div>
                        <div className="mt-1"><dt className="inline">Content hash: </dt><dd className="inline font-mono text-zinc-300">{selectedVersion.contentHash ? selectedVersion.contentHash.slice(0, 12) : 'Not generated'}</dd></div>
                      </dl>
                    </div>
                  </div>

                  {canEdit ? (
                    <div className="mt-5 border-t border-zinc-800 pt-5">
                      <h4 className="text-sm font-semibold text-zinc-200">Draft compliance settings</h4>
                      <p className="mt-1 text-xs text-zinc-500">A pack cannot be published as payroll-ready without validation, currency, dates, and official sources.</p>
                      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                        <label className="text-sm text-zinc-400">Calculation status
                          <select value={draft.calculationStatus} onChange={(event) => setDraft({ ...draft, calculationStatus: event.target.value as Draft['calculationStatus'] })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100">
                            <option value="blocked">Needs setup</option><option value="preview_only">Test only</option><option value="runnable">Payroll ready</option>
                          </select>
                        </label>
                        <label className="text-sm text-zinc-400">Calculation currency
                          <input value={draft.calculationCurrency} onChange={(event) => setDraft({ ...draft, calculationCurrency: event.target.value.toUpperCase() })} maxLength={3} placeholder="e.g. KES" className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" />
                        </label>
                        <label className="text-sm text-zinc-400">Effective from
                          <input type="date" value={draft.effectiveFrom} onChange={(event) => setDraft({ ...draft, effectiveFrom: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" />
                        </label>
                        <label className="text-sm text-zinc-400">Effective to
                          <input type="date" value={draft.effectiveTo} onChange={(event) => setDraft({ ...draft, effectiveTo: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" />
                        </label>
                        <label className="text-sm text-zinc-400">Source date
                          <input type="date" value={draft.sourceDate} onChange={(event) => setDraft({ ...draft, sourceDate: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" />
                        </label>
                        <label className="text-sm text-zinc-400">Coverage level
                          <select value={draft.coverageLevel} onChange={(event) => setDraft({ ...draft, coverageLevel: event.target.value as Draft['coverageLevel'] })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100">
                            <option value="national">National</option><option value="federal">Federal</option><option value="subdivision">Subdivision</option><option value="local">Local</option><option value="organization_override">Organization override</option><option value="template">Template</option>
                          </select>
                        </label>
                        <label className="text-sm text-zinc-400 md:col-span-2">Included modules (one per line)
                          <textarea rows={3} value={draft.coverageModulesText} onChange={(event) => setDraft({ ...draft, coverageModulesText: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" />
                        </label>
                        <label className="text-sm text-zinc-400 md:col-span-2">Known exclusions (one per line)
                          <textarea rows={3} value={draft.coverageExclusionsText} onChange={(event) => setDraft({ ...draft, coverageExclusionsText: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" />
                        </label>
                        <label className="text-sm text-zinc-400 md:col-span-2">Unresolved legal contradictions (one per line)
                          <textarea rows={3} value={draft.legalOpenIssuesText} onChange={(event) => setDraft({ ...draft, legalOpenIssuesText: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" />
                        </label>
                        <label className="text-sm text-zinc-400 md:col-span-2">Supported subdivisions (one per line)
                          <textarea rows={3} value={draft.supportedSubdivisionsText} onChange={(event) => setDraft({ ...draft, supportedSubdivisionsText: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" />
                        </label>
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}
              {selectedVersion && !isPlatformRelease ? (
                <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5" aria-labelledby="tax-review-team">
                  <div className="border-b border-zinc-800 pb-4">
                    <h3 id="tax-review-team" className="text-base font-semibold text-zinc-100">Jurisdiction review team</h3>
                    <p className="mt-1 text-sm text-zinc-400">An owner or administrator verifies who may review this jurisdiction. Authorizations are time-limited, cannot be self-verified, and are checked again when a pack is published.</p>
                    <p className="mt-2 text-xs text-zinc-500">Reviews inherit the credential stored here. Expiry or revocation makes the linked review ineligible; tax-law authorization requires a professional credential or external engagement.</p>
                  </div>
                  {selected.reviewTeam?.length ? (
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                        <thead><tr className="border-b border-zinc-800 text-zinc-500"><th className="px-2 py-2 font-medium">Reviewer</th><th className="px-2 py-2 font-medium">Responsibilities</th><th className="px-2 py-2 font-medium">Credential</th><th className="px-2 py-2 font-medium">Expiry</th><th className="px-2 py-2 font-medium">Status</th><th className="px-2 py-2 font-medium"></th></tr></thead>
                        <tbody>
                          {selected.reviewTeam.map((authorization) => (
                            <tr key={authorization._id} className="border-b border-zinc-800/70 last:border-0">
                              <td className="px-2 py-3"><span className="block text-zinc-200">{authorization.name}</span><span className="block text-xs text-zinc-500">Verified by {authorization.verifiedBy?.name || '—'}</span></td>
                              <td className="px-2 py-3 text-zinc-400">{authorization.roles.map(reviewRoleLabel).join(', ')}</td>
                              <td className="px-2 py-3 text-zinc-400"><span className="block">{authorization.credentialReference}</span><span className="block text-xs text-zinc-500">{authorization.credentialType.replace(/_/g, ' ')}</span></td>
                              <td className="px-2 py-3 text-zinc-500">{authorization.expiresAt ? new Date(authorization.expiresAt).toLocaleDateString() : 'Missing expiry'}</td>
                              <td className="px-2 py-3 text-zinc-400">{authorization.status === 'revoked' ? 'Revoked' : (!authorization.expiresAt || new Date(authorization.expiresAt).getTime() <= Date.now() ? 'Expired' : 'Active')}</td>
                              <td className="px-2 py-3 text-right">{canManageReviewerRegistry && authorization.status === 'active' ? <button onClick={() => revokeReviewer(authorization._id)} disabled={saving} className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-red-500/50 hover:text-red-200">Revoke</button> : null}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <p className="mt-4 text-sm text-zinc-500">No reviewer has been authorized for this jurisdiction.</p>}

                  {canManageReviewerRegistry ? (
                    <div className="mt-5 border-t border-zinc-800 pt-5">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <label className="text-sm text-zinc-400">Organization member
                          <select value={reviewerDraft.userId} onChange={(event) => setReviewerDraft({ ...reviewerDraft, userId: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100">
                            <option value="">Select a member</option>
                            {organizationMembers.filter((member) => member.userId !== currentUserId).map((member) => <option key={member.userId} value={member.userId}>{member.name}{member.email ? ` · ${member.email}` : ''}</option>)}
                          </select>
                        </label>
                        <label className="text-sm text-zinc-400">Credential type
                          <select value={reviewerDraft.credentialType} onChange={(event) => {
                            const credentialType = event.target.value as typeof reviewerDraft.credentialType;
                            setReviewerDraft({
                              ...reviewerDraft,
                              credentialType,
                              roles: credentialType === 'internal_appointment'
                                ? reviewerDraft.roles.filter((role) => role !== 'tax_law')
                                : reviewerDraft.roles,
                            });
                          }} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100">
                            <option value="professional_license">Professional licence</option><option value="professional_membership">Professional membership</option><option value="engagement">External engagement</option><option value="internal_appointment" disabled={reviewerDraft.roles.includes('tax_law')}>Internal appointment</option>
                          </select>
                        </label>
                        <fieldset className="md:col-span-2">
                          <legend className="text-sm text-zinc-400">Authorized responsibilities</legend>
                          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                            {(['tax_law', 'payroll_calculation', 'independent_qa'] as TaxCertificationReviewRole[]).map((role) => (
                              <label key={role} className="inline-flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" disabled={role === 'tax_law' && reviewerDraft.credentialType === 'internal_appointment'} checked={reviewerDraft.roles.includes(role)} onChange={(event) => setReviewerDraft({ ...reviewerDraft, roles: event.target.checked ? [...reviewerDraft.roles, role] : reviewerDraft.roles.filter((entry) => entry !== role) })} className="h-4 w-4 rounded border-zinc-700 bg-zinc-950" />{reviewRoleLabel(role)}</label>
                            ))}
                          </div>
                        </fieldset>
                        <label className="text-sm text-zinc-400">Credential or appointment reference
                          <input value={reviewerDraft.credentialReference} onChange={(event) => setReviewerDraft({ ...reviewerDraft, credentialReference: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" />
                        </label>
                        <label className="text-sm text-zinc-400">Authorization expiry
                          <input type="date" value={reviewerDraft.expiresAt} onChange={(event) => setReviewerDraft({ ...reviewerDraft, expiresAt: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" />
                        </label>
                        <label className="text-sm text-zinc-400 md:col-span-2">Authorization notes
                          <textarea rows={2} value={reviewerDraft.notes} onChange={(event) => setReviewerDraft({ ...reviewerDraft, notes: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" />
                        </label>
                      </div>
                      <button onClick={authorizeReviewer} disabled={saving || !reviewerDraft.userId || !reviewerDraft.credentialReference || !reviewerDraft.expiresAt || reviewerDraft.roles.length === 0} className="mt-4 rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50">Authorize reviewer</button>
                    </div>
                  ) : null}
                </section>
              ) : null}
              {selectedVersion ? (
                <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5" aria-labelledby="tax-certification-review">
                  <div className="flex flex-col gap-3 border-b border-zinc-800 pb-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 id="tax-certification-review" className="text-base font-semibold text-zinc-100">{isPlatformRelease ? 'Platform release certification' : 'Certification reviews'}</h3>
                      <p className="mt-1 text-sm text-zinc-400">{isPlatformRelease ? 'This built-in pack is certified by its immutable production release evidence and deterministic fixture suite.' : 'Runnable packs require separate law, calculation, and QA approvals for the exact content hash. The publisher must be a fourth person.'}</p>
                    </div>
                    <span className={`self-start rounded-md border px-2.5 py-1 text-xs font-medium ${selectedVersion.certification?.ready ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-zinc-700 bg-zinc-950 text-zinc-300'}`}>
                      {selectedVersion.certification?.ready ? (isPlatformRelease ? 'Published and certified' : 'Review complete') : 'Review incomplete'}
                    </span>
                  </div>

                  {isPlatformRelease ? (
                    <dl className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                      <div><dt className="text-zinc-500">Release ID</dt><dd className="mt-1 font-mono text-xs text-zinc-200">{platformRelease?.releaseId || 'Recorded with pack'}</dd></div>
                      <div><dt className="text-zinc-500">Released</dt><dd className="mt-1 text-zinc-200">{platformRelease?.releasedAt ? new Date(platformRelease.releasedAt).toLocaleString() : 'Recorded with pack'}</dd></div>
                      <div><dt className="text-zinc-500">Evidence</dt><dd className="mt-1 text-zinc-200">{platformRelease?.evidenceReference || 'Immutable platform release'}</dd></div>
                      <div><dt className="text-zinc-500">Fixture suite</dt><dd className="mt-1 text-zinc-200">{platformRelease?.fixtureSuite || 'Deterministic payroll fixtures passed'}</dd></div>
                    </dl>
                  ) : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b border-zinc-800 text-zinc-500">
                          <th className="px-2 py-2 font-medium">Review</th>
                          <th className="px-2 py-2 font-medium">Decision</th>
                          <th className="px-2 py-2 font-medium">Reviewer</th>
                          <th className="px-2 py-2 font-medium">Recorded</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(['tax_law', 'payroll_calculation', 'independent_qa'] as TaxCertificationReviewRole[]).map((role) => {
                          const review = selectedVersion.certification?.reviews?.find((entry) => entry.role === role);
                          return (
                            <tr key={role} className="border-b border-zinc-800/70 last:border-0">
                              <td className="px-2 py-3 text-zinc-200">{reviewRoleLabel(role)}</td>
                              <td className="px-2 py-3 text-zinc-400">{review?.decision?.replace('_', ' ') || 'Not submitted'}</td>
                              <td className="px-2 py-3 text-zinc-400">{review?.reviewer?.name || '—'}</td>
                              <td className="px-2 py-3 text-zinc-500">{review?.reviewedAt ? new Date(review.reviewedAt).toLocaleString() : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  )}

                  {selectedVersion.certification?.problems?.length ? (
                    <ul className="mt-4 space-y-1 border-l-2 border-amber-500/60 pl-3 text-sm text-amber-100/80">
                      {selectedVersion.certification.problems.map((problem) => <li key={problem}>{problem}</li>)}
                    </ul>
                  ) : null}
                  {selectedVersion.certification?.staleReviewCount ? (
                    <p className="mt-3 text-xs text-zinc-500">{selectedVersion.certification.staleReviewCount} earlier review{selectedVersion.certification.staleReviewCount === 1 ? '' : 's'} no longer matches this rule content.</p>
                  ) : null}

                  {canEdit ? (
                    <div className="mt-5 border-t border-zinc-800 pt-5">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <label className="text-sm text-zinc-400">Review responsibility
                          <select value={reviewDraft.role} onChange={(event) => setReviewDraft({ ...reviewDraft, role: event.target.value as TaxCertificationReviewRole })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100">
                            <option value="tax_law">Tax law</option>
                            <option value="payroll_calculation">Payroll calculation</option>
                            <option value="independent_qa">Independent QA</option>
                          </select>
                        </label>
                        <label className="text-sm text-zinc-400">Decision
                          <select value={reviewDraft.decision} onChange={(event) => setReviewDraft({ ...reviewDraft, decision: event.target.value as typeof reviewDraft.decision })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100">
                            <option value="approved">Approved</option>
                            <option value="changes_requested">Changes requested</option>
                            <option value="rejected">Rejected</option>
                          </select>
                        </label>
                        <label className="text-sm text-zinc-400 md:col-span-2">Credential inherited from reviewer registry
                          <input
                            value={currentReviewAuthorization ? `${currentReviewAuthorization.credentialReference} (${currentReviewAuthorization.credentialType.replace(/_/g, ' ')})` : 'No active authorization for this responsibility'}
                            readOnly
                            aria-readonly="true"
                            className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-zinc-400"
                          />
                          {currentReviewAuthorization?.expiresAt ? <span className="mt-1.5 block text-xs text-zinc-500">Authorization expires {new Date(currentReviewAuthorization.expiresAt).toLocaleDateString()} and will be checked again at publication.</span> : null}
                        </label>
                        {reviewDraft.role === 'tax_law' ? (
                          <label className="text-sm text-zinc-400 md:col-span-2">Registered source labels (one per line)
                            <textarea rows={3} value={reviewDraft.sourceReferencesText} onChange={(event) => setReviewDraft({ ...reviewDraft, sourceReferencesText: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" />
                          </label>
                        ) : null}
                        {reviewDraft.role === 'independent_qa' ? (
                          <label className="text-sm text-zinc-400 md:col-span-2">Certified fixture-run reference
                            <input value={reviewDraft.fixtureRunReference} onChange={(event) => setReviewDraft({ ...reviewDraft, fixtureRunReference: event.target.value })} placeholder="CI run, signed report, or test artifact ID" className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" />
                          </label>
                        ) : null}
                        <label className="text-sm text-zinc-400 md:col-span-2">Review notes
                          <textarea rows={3} value={reviewDraft.notes} onChange={(event) => setReviewDraft({ ...reviewDraft, notes: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" />
                        </label>
                      </div>
                      {!currentReviewAuthorization ? <p className="mt-4 text-sm text-amber-200">An owner or administrator must add an active authorization for this responsibility before you can submit a review.</p> : null}
                      <button onClick={submitReview} disabled={saving || !currentReviewAuthorization} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50">
                        <ShieldCheck className="h-4 w-4" />Record review
                      </button>
                    </div>
                  ) : null}
                </section>
              ) : null}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
                <div className="flex items-center justify-between"><h3 className="text-base font-semibold text-zinc-100">Dynamic Employee Fields</h3><button onClick={() => setDraft({ ...draft, fields: [...draft.fields, emptyField()] })} disabled={!canEdit} className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-200 text-sm">Add Field</button></div>
                {draft.fields.map((field, index) => (
                  <div key={`${field.key || 'field'}-${index}`} className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                      <input value={field.key} disabled={!canEdit} onChange={(event) => setField(index, { key: event.target.value })} className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" placeholder="key" />
                      <input value={field.label} disabled={!canEdit} onChange={(event) => setField(index, { label: event.target.value })} className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" placeholder="Label" />
                      <select
                        value={field.type}
                        disabled={!canEdit}
                        onChange={(event) => {
                          const type = event.target.value as TaxFieldDefinition['type'];
                          setField(index, {
                            type,
                            ...(type === 'currency' && !field.currencyScope ? { currencyScope: 'calculation_currency' } : {}),
                          });
                        }}
                        className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100"
                      >
                        {types.map((type) => <option key={type} value={type}>{type}</option>)}
                      </select>
                      <input value={String(field.defaultValue ?? '')} disabled={!canEdit} onChange={(event) => setField(index, { defaultValue: event.target.value })} className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" placeholder="Default" />
                    </div>

                    {field.type === 'currency' ? (
                      <div className="grid grid-cols-1 gap-3 border-t border-zinc-800 pt-3 md:grid-cols-2">
                        <label className="text-xs text-zinc-500">Currency source
                          <select
                            value={field.currencyScope || 'calculation_currency'}
                            disabled={!canEdit}
                            onChange={(event) => setField(index, { currencyScope: event.target.value as TaxFieldDefinition['currencyScope'] })}
                            className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100"
                          >
                            <option value="calculation_currency">Tax pack calculation currency ({draft.calculationCurrency || 'not set'})</option>
                            <option value="payroll_currency">Employee payroll currency</option>
                          </select>
                        </label>
                        <label className="text-xs text-zinc-500">Fixed currency override (optional)
                          <input
                            value={field.currencyCode || ''}
                            disabled={!canEdit}
                            maxLength={3}
                            onChange={(event) => setField(index, { currencyCode: event.target.value.toUpperCase() })}
                            placeholder="e.g. KES"
                            className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100"
                          />
                        </label>
                        <p className="text-xs text-zinc-500 md:col-span-2">
                          Calculation currency is the safe default. Set payroll currency only when the formula expects the employee payment currency; a fixed code overrides both.
                        </p>
                      </div>
                    ) : null}

                    <textarea value={optionsText(field.options)} disabled={!canEdit || field.type !== 'select'} onChange={(event) => setField(index, { options: parseOptions(event.target.value) })} className="w-full min-h-[72px] rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" placeholder="value|Label per line for select fields" />
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-sm text-zinc-400"><input type="checkbox" checked={!!field.required} disabled={!canEdit} onChange={(event) => setField(index, { required: event.target.checked })} />Required</label>
                      <button onClick={() => setDraft({ ...draft, fields: draft.fields.filter((_, fieldIndex) => fieldIndex !== index) })} disabled={!canEdit} className="text-sm text-red-300">Remove</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <details className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
                  <summary className="cursor-pointer text-sm font-semibold text-zinc-200">Advanced rule definition</summary>
                  <p className="mt-2 text-xs text-zinc-500">Configure sources, formulas, bands, contributions, and test fixtures without editing JSON.</p>
                  <div className="mt-5 space-y-6">
                    <section className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div><h4 className="text-sm font-medium text-zinc-200">Official sources</h4><p className="mt-1 text-xs text-zinc-500">Production rules require checked, traceable primary authority material.</p></div>
                        <button type="button" disabled={!canEdit} onClick={() => setDraft({ ...draft, sourceLinks: [...draft.sourceLinks, { label: '', url: '', authorityType: 'official_guidance', isPrimary: true }] })} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-300 disabled:opacity-40"><Plus className="h-3.5 w-3.5" />Add source</button>
                      </div>
                      {draft.sourceLinks.map((source, index) => {
                        const setSource = (changes: Partial<(typeof draft.sourceLinks)[number]>) => setDraft({ ...draft, sourceLinks: draft.sourceLinks.map((entry, sourceIndex) => sourceIndex === index ? { ...entry, ...changes } : entry) });
                        return (
                          <div key={`${source.url || 'source'}-${index}`} className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                              <label className="text-xs text-zinc-500">Source label<input value={source.label || ''} disabled={!canEdit} onChange={(event) => setSource({ label: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-100" /></label>
                              <label className="text-xs text-zinc-500">Authority type<select value={source.authorityType || 'official_guidance'} disabled={!canEdit} onChange={(event) => setSource({ authorityType: event.target.value as NonNullable<typeof source.authorityType> })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-100"><option value="legislation">Legislation</option><option value="tax_authority">Tax authority</option><option value="social_security_authority">Social security authority</option><option value="official_guidance">Official guidance</option><option value="court_or_ruling">Court or ruling</option><option value="secondary">Secondary source</option></select></label>
                              <label className="text-xs text-zinc-500 md:col-span-2">Official URL<input type="url" value={source.url || ''} disabled={!canEdit} onChange={(event) => setSource({ url: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-100" /></label>
                              <label className="text-xs text-zinc-500">Checked on<input type="date" value={dateValue(source.checkedAt)} disabled={!canEdit} onChange={(event) => setSource({ checkedAt: event.target.value || null })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-100" /></label>
                              <label className="text-xs text-zinc-500">Retrieved on<input type="date" value={dateValue(source.retrievedAt)} disabled={!canEdit} onChange={(event) => setSource({ retrievedAt: event.target.value || null })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-100" /></label>
                              <label className="text-xs text-zinc-500">Effective from<input type="date" value={dateValue(source.effectiveFrom)} disabled={!canEdit} onChange={(event) => setSource({ effectiveFrom: event.target.value || null })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-100" /></label>
                              <label className="text-xs text-zinc-500">Effective to<input type="date" value={dateValue(source.effectiveTo)} disabled={!canEdit} onChange={(event) => setSource({ effectiveTo: event.target.value || null })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-100" /></label>
                              <label className="text-xs text-zinc-500 md:col-span-2">SHA-256 content digest<input value={source.contentDigestSha256 || ''} disabled={!canEdit} onChange={(event) => setSource({ contentDigestSha256: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100" /></label>
                              <label className="text-xs text-zinc-500 md:col-span-2">Archive reference<input value={source.archiveReference || ''} disabled={!canEdit} onChange={(event) => setSource({ archiveReference: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-100" /></label>
                            </div>
                            <div className="flex items-center justify-between"><label className="flex items-center gap-2 text-xs text-zinc-400"><input type="checkbox" checked={source.isPrimary !== false} disabled={!canEdit} onChange={(event) => setSource({ isPrimary: event.target.checked })} />Primary authority</label><button type="button" disabled={!canEdit} onClick={() => setDraft({ ...draft, sourceLinks: draft.sourceLinks.filter((_, sourceIndex) => sourceIndex !== index) })} className="text-xs text-red-300 disabled:opacity-40">Remove source</button></div>
                          </div>
                        );
                      })}
                    </section>

                    <section className="space-y-3 border-t border-zinc-800 pt-5"><div><h4 className="text-sm font-medium text-zinc-200">Calculation constants</h4><p className="mt-1 text-xs text-zinc-500">Add named rates, thresholds, allowances, tables, or formula inputs.</p></div><StructuredRuleEditor value={draft.constants} disabled={!canEdit} onChange={(constants) => setDraft({ ...draft, constants })} /></section>

                    <section className="space-y-3 border-t border-zinc-800 pt-5">
                      <div><h4 className="text-sm font-medium text-zinc-200">Income tax</h4><p className="mt-1 text-xs text-zinc-500">Choose a supported calculation model, then configure its formulas, bands, tables, and conditions.</p></div>
                      <label className="block text-xs text-zinc-500">Rule type<select value={String(draft.incomeTax.strategy || 'none')} disabled={!canEdit} onChange={(event) => setDraft({ ...draft, incomeTax: incomeTaxDefaults(event.target.value) })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-100">{incomeTaxStrategyOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                      <StructuredRuleEditor value={Object.fromEntries(Object.entries(draft.incomeTax).filter(([key]) => key !== 'strategy'))} disabled={!canEdit} onChange={(settings) => setDraft({ ...draft, incomeTax: { strategy: draft.incomeTax.strategy || 'none', ...settings } })} />
                    </section>

                    <section className="space-y-3 border-t border-zinc-800 pt-5">
                      <div className="flex items-center justify-between gap-3"><div><h4 className="text-sm font-medium text-zinc-200">Statutory contributions</h4><p className="mt-1 text-xs text-zinc-500">Configure employee and employer liabilities independently.</p></div><button type="button" disabled={!canEdit} onClick={() => setDraft({ ...draft, statutoryRules: [...draft.statutoryRules, statutoryRuleDefaults()] })} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-300 disabled:opacity-40"><Plus className="h-3.5 w-3.5" />Add rule</button></div>
                      {draft.statutoryRules.map((rule, index) => (
                        <div key={`${rule.name || 'rule'}-${index}`} className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                          <label className="block text-xs text-zinc-500">Rule type<select value={String(rule.strategy || 'flat_percent')} disabled={!canEdit} onChange={(event) => setDraft({ ...draft, statutoryRules: draft.statutoryRules.map((entry, ruleIndex) => ruleIndex === index ? statutoryRuleDefaults(event.target.value) : entry) })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-100">{statutoryStrategyOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                          <StructuredRuleEditor value={Object.fromEntries(Object.entries(rule).filter(([key]) => key !== 'strategy'))} disabled={!canEdit} onChange={(settings) => setDraft({ ...draft, statutoryRules: draft.statutoryRules.map((entry, ruleIndex) => ruleIndex === index ? { strategy: rule.strategy || 'flat_percent', ...settings } : entry) })} />
                          <button type="button" disabled={!canEdit} onClick={() => setDraft({ ...draft, statutoryRules: draft.statutoryRules.filter((_, ruleIndex) => ruleIndex !== index) })} className="text-xs text-red-300 disabled:opacity-40">Remove rule</button>
                        </div>
                      ))}
                    </section>

                    <label className="block text-xs text-zinc-500">Notes (one per line)
                      <textarea value={draft.notesText} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, notesText: e.target.value })} className="mt-1.5 w-full min-h-[72px] bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100" />
                    </label>
                    <section className="space-y-3 border-t border-zinc-800 pt-5"><div><h4 className="text-sm font-medium text-zinc-200">Certification test cases</h4><p className="mt-1 text-xs text-zinc-500">Maintain inputs and expected results used by the deterministic release gates.</p></div><StructuredRuleEditor value={draft.testCases} disabled={!canEdit} onChange={(testCases) => setDraft({ ...draft, testCases })} /></section>
                  </div>
                </details>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
                  <div className="flex items-center justify-between"><div><h3 className="text-base font-semibold text-zinc-100">Calculation tester</h3><p className="mt-1 text-xs text-zinc-500">Validate draft and published calculations before payroll.</p></div><button onClick={runPreview} disabled={previewing} className="px-3 py-2 rounded-lg bg-amber-600 text-white text-sm">{previewing ? 'Calculating...' : 'Calculate'}</button></div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <label className="text-xs text-zinc-500">Basic salary ({draft.calculationCurrency || 'calculation currency'})<input type="number" value={previewBase.basicSalary} onChange={(event) => setPreviewBase({ ...previewBase, basicSalary: Number(event.target.value) })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" /></label>
                    <label className="text-xs text-zinc-500">Gross pay ({draft.calculationCurrency || 'calculation currency'})<input type="number" value={previewBase.grossPay} onChange={(event) => setPreviewBase({ ...previewBase, grossPay: Number(event.target.value) })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" /></label>
                    <label className="text-xs text-zinc-500">Taxable income ({draft.calculationCurrency || 'calculation currency'})<input type="number" value={previewBase.taxableIncome} onChange={(event) => setPreviewBase({ ...previewBase, taxableIncome: Number(event.target.value) })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100" /></label>
                    <label className="text-xs text-zinc-500">Pay frequency<select value={previewBase.payFrequency} onChange={(event) => setPreviewBase({ ...previewBase, payFrequency: event.target.value })} className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100"><option value="monthly">Monthly</option><option value="semi-monthly">Semi-monthly</option><option value="bi-weekly">Bi-weekly</option><option value="weekly">Weekly</option></select></label>
                  </div>
                  {draft.fields.map((field) => {
                    const currencyCode = resolveTaxFieldCurrencyCode(field, {
                      calculationCurrency: draft.calculationCurrency,
                    });
                    const currencyHelp = describeTaxFieldCurrency(field, {
                      calculationCurrency: draft.calculationCurrency,
                    });
                    const numericField = ['currency', 'percent', 'integer'].includes(field.type);
                    return (
                      <div key={`preview-${field.key}`}>
                        <label className="mb-1.5 block text-sm font-medium text-zinc-400">
                          {field.label}
                          {field.type === 'currency'
                            ? currencyCode
                              ? ` (${currencyCode})`
                              : field.currencyScope === 'payroll_currency'
                                ? ' (employee payroll currency)'
                                : ' (tax pack currency not set)'
                            : ''}
                        </label>
                        {field.type === 'select' ? (
                          <select value={previewFields[field.key] ?? ''} onChange={(event) => setPreviewFields({ ...previewFields, [field.key]: event.target.value })} className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100">
                            <option value="">Select</option>
                            {(field.options || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                        ) : field.type === 'boolean' ? (
                          <label className="flex items-center gap-2 text-sm text-zinc-200"><input type="checkbox" checked={!!previewFields[field.key]} onChange={(event) => setPreviewFields({ ...previewFields, [field.key]: event.target.checked })} />Enabled</label>
                        ) : (
                          <input
                            type={field.type === 'date' ? 'date' : numericField ? 'number' : 'text'}
                            step={field.type === 'integer' ? '1' : numericField ? '0.01' : undefined}
                            value={previewFields[field.key] ?? ''}
                            onChange={(event) => setPreviewFields({
                              ...previewFields,
                              [field.key]: numericField ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value,
                            })}
                            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-zinc-100"
                          />
                        )}
                        {field.type === 'currency' ? <p className="mt-1.5 text-xs text-amber-200/80">{currencyHelp}</p> : null}
                      </div>
                    );
                  })}
                  {previewResult ? (
                    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
                      <div className={`rounded-lg border px-3 py-2 text-sm ${previewResult.payrollRunnable ? calculationStatusClasses('runnable') : calculationStatusClasses(previewResult.compliance?.calculationStatus || 'blocked')}`}>
                        {previewResult.payrollRunnable ? 'This preview is eligible for payroll.' : 'Preview result only. Payroll remains blocked for this pack.'}
                      </div>
                      {Array.isArray(previewResult.validationErrors) && previewResult.validationErrors.length > 0 ? <div className="text-sm text-amber-300">{previewResult.validationErrors.join(' ')}</div> : null}
                      {Array.isArray(previewResult.blockingErrors) && previewResult.blockingErrors.length > 0 ? (
                        <ul className="space-y-1 text-sm text-red-300">{previewResult.blockingErrors.map((message: string) => <li key={message}>• {message}</li>)}</ul>
                      ) : null}
                      <dl className="grid grid-cols-1 gap-3 border-t border-zinc-800 pt-3 sm:grid-cols-2">
                        <div><dt className="text-xs text-zinc-500">Income tax</dt><dd className="mt-1 font-semibold text-amber-300">{formatPayrollMoney(previewResult?.incomeTax?.taxAmount || 0, previewResult?.compliance?.calculationCurrency || draft.calculationCurrency || 'USD')}</dd></div>
                        <div><dt className="text-xs text-zinc-500">Employee statutory</dt><dd className="mt-1 font-semibold text-zinc-100">{formatPayrollMoney(previewResult?.statutoryContributions?.totalEmployeeAmount ?? previewResult?.statutoryContributions?.totalAmount ?? 0, previewResult?.compliance?.calculationCurrency || draft.calculationCurrency || 'USD')}</dd></div>
                        <div><dt className="text-xs text-zinc-500">Employer statutory</dt><dd className="mt-1 font-semibold text-zinc-100">{formatPayrollMoney(previewResult?.statutoryContributions?.totalEmployerAmount || 0, previewResult?.compliance?.calculationCurrency || draft.calculationCurrency || 'USD')}</dd></div>
                        <div><dt className="text-xs text-zinc-500">Method</dt><dd className="mt-1 text-sm font-medium text-zinc-100">{previewResult?.incomeTax?.method || 'n/a'}</dd></div>
                      </dl>
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          ) : <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-zinc-400">No jurisdiction selected.</div>}
        </div>
      </div>
    </div>
  );
}
