'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

import {
  TaxCertificationReviewContext,
  TaxCertificationReviewRole,
  getTaxCertificationReviewContext,
  submitTaxCertificationReview,
} from '@/lib/payrollTax';
import { StructuredRuleEditor } from '@/components/tax/StructuredRuleEditor';

const roleLabel: Record<TaxCertificationReviewRole, string> = {
  tax_law: 'Tax law',
  payroll_calculation: 'Payroll calculation',
  independent_qa: 'Independent QA',
};

const decisionLabel = {
  approved: 'Approve this exact version',
  changes_requested: 'Request changes',
  rejected: 'Reject this version',
} as const;

function dateLabel(value?: string | null) {
  if (!value) return 'Open-ended';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(value));
}
function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100" role="alert">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </div>
    </div>
  );
}

export default function TaxCertificationReviewPage() {
  const params = useParams<{ jurisdictionId: string; versionId: string }>();
  const jurisdictionId = String(params?.jurisdictionId || '');
  const versionId = String(params?.versionId || '');
  const [context, setContext] = useState<TaxCertificationReviewContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [role, setRole] = useState<TaxCertificationReviewRole>('tax_law');
  const [decision, setDecision] = useState<'approved' | 'changes_requested' | 'rejected'>('changes_requested');
  const [sourceReferences, setSourceReferences] = useState<string[]>([]);
  const [fixtureRunReference, setFixtureRunReference] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    if (!jurisdictionId || !versionId) return;
    setLoading(true);
    setError('');
    try {
      const next = await getTaxCertificationReviewContext(jurisdictionId, versionId);
      setContext(next);
      const firstRole = next.authorizations.flatMap((entry) => entry.roles)[0];
      if (firstRole) setRole(firstRole);
      setSourceReferences(
        (next.version.sourceLinks || [])
          .filter((source) => source.isPrimary !== false && source.authorityType !== 'secondary')
          .map((source) => source.label)
          .filter(Boolean)
      );
    } catch (caught: any) {
      setError(caught?.response?.data?.error || caught?.message || 'Unable to load this review assignment.');
    } finally {
      setLoading(false);
    }
  }, [jurisdictionId, versionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const authorizedRoles = useMemo(() => (
    Array.from(new Set((context?.authorizations || []).flatMap((entry) => entry.roles)))
  ), [context]);

  const activeAuthorization = context?.authorizations.find((entry) => entry.roles.includes(role));

  const submit = async () => {
    setError('');
    setFeedback('');
    if (decision === 'approved' && role === 'tax_law' && sourceReferences.length === 0) {
      setError('A tax-law approval must identify at least one registered primary source.');
      return;
    }
    if (decision === 'approved' && role === 'independent_qa' && !fixtureRunReference.trim()) {
      setError('An independent-QA approval must identify the certified fixture run.');
      return;
    }
    setSubmitting(true);
    try {
      await submitTaxCertificationReview(jurisdictionId, versionId, {
        role,
        decision,
        sourceReferences,
        fixtureRunReference: fixtureRunReference.trim(),
        notes: notes.trim(),
      });
      setFeedback('Your decision was recorded against this exact content hash.');
      await load();
    } catch (caught: any) {
      setError(caught?.response?.data?.error || caught?.message || 'The review could not be recorded.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto flex min-h-[55vh] max-w-6xl items-center justify-center px-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading review assignment
        </div>
      </main>
    );
  }

  if (!context) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <ErrorPanel message={error || 'This review assignment is unavailable.'} />
      </main>
    );
  }

  const { jurisdiction, version, certification } = context;
  const contentHash = certification.contentHash || version.contentHash || '';

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="border-b border-border pb-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Statutory certification assignment
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {jurisdiction.displayName}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Review {version.label} as an independent control. Your decision is bound to the content hash below; any rule edit makes it stale.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-9 items-center gap-2 border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </button>
        </div>
        <div className="mt-5 grid gap-px overflow-hidden border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-card p-4"><span className="text-xs text-muted-foreground">Jurisdiction</span><strong className="mt-1 block">{jurisdiction.countryCode} · {jurisdiction.countryName}</strong></div>
          <div className="bg-card p-4"><span className="text-xs text-muted-foreground">Effective period</span><strong className="mt-1 block">{dateLabel(version.effectiveFrom)} – {dateLabel(version.effectiveTo)}</strong></div>
          <div className="bg-card p-4"><span className="text-xs text-muted-foreground">Calculation currency</span><strong className="mt-1 block">{version.calculationCurrency || 'Not declared'}</strong></div>
          <div className="bg-card p-4"><span className="text-xs text-muted-foreground">Current certification</span><strong className="mt-1 block">{certification.approvedRoles.length}/{certification.requiredRoles.length} roles approved</strong></div>
        </div>
        <div className="mt-3 flex min-w-0 items-center gap-2 border border-border bg-muted/40 px-3 py-2 font-mono text-[11px] text-muted-foreground">
          <span className="shrink-0 font-sans font-medium text-foreground">SHA-256</span>
          <span className="truncate" title={contentHash}>{contentHash || 'Hash unavailable'}</span>
        </div>
      </header>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <section className="border border-border bg-card">
            <div className="border-b border-border px-5 py-4">
              <h2 className="font-semibold text-foreground">Scope and known exclusions</h2>
              <p className="mt-1 text-sm text-muted-foreground">Confirm that the implementation does not claim coverage beyond the law and test evidence.</p>
            </div>
            <div className="grid gap-6 p-5 md:grid-cols-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Modules</h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {(version.coverage?.modules || []).map((item) => <li key={item} className="border-l-2 border-primary/50 pl-3">{item}</li>)}
                  {(version.coverage?.modules || []).length === 0 && <li className="text-muted-foreground">No modules declared.</li>}
                </ul>
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Exclusions</h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {(version.coverage?.exclusions || []).map((item) => <li key={item} className="border-l-2 border-amber-500/60 pl-3">{item}</li>)}
                  {(version.coverage?.exclusions || []).length === 0 && <li className="text-muted-foreground">No exclusions declared.</li>}
                </ul>
              </div>
            </div>
          </section>

          <section className="border border-border bg-card">
            <div className="border-b border-border px-5 py-4">
              <h2 className="font-semibold text-foreground">Registered sources</h2>
              <p className="mt-1 text-sm text-muted-foreground">Approval should cite the exact primary material you checked.</p>
            </div>
            <div className="divide-y divide-border">
              {(version.sourceLinks || []).map((source) => {
                const selected = sourceReferences.includes(source.label);
                return (
                  <label key={`${source.label}-${source.url}`} className="flex cursor-pointer items-start gap-3 px-5 py-4 hover:bg-muted/30">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => setSourceReferences((current) => (
                        selected ? current.filter((item) => item !== source.label) : [...current, source.label]
                      ))}
                      className="mt-1 h-4 w-4"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm text-foreground">{source.label}</strong>
                        <span className="border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {source.isPrimary === false ? 'secondary' : 'primary'}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        Checked {dateLabel(source.checkedAt)} · retrieved {dateLabel(source.retrievedAt)}
                      </span>
                      {source.contentDigestSha256 && <code className="mt-1 block truncate text-[10px] text-muted-foreground">{source.contentDigestSha256}</code>}
                    </span>
                    <a href={source.url} target="_blank" rel="noreferrer" className="mt-0.5 text-primary" aria-label={`Open ${source.label}`} onClick={(event) => event.stopPropagation()}>
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                  </label>
                );
              })}
              {(version.sourceLinks || []).length === 0 && <p className="px-5 py-4 text-sm text-muted-foreground">No source register is attached.</p>}
            </div>
          </section>

          <section className="border border-border bg-card">
            <div className="border-b border-border px-5 py-4">
              <h2 className="font-semibold text-foreground">Executable evidence</h2>
              <p className="mt-1 text-sm text-muted-foreground">Fixture categories must be semantically distinct and tied to registered sources.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-5 py-3 font-medium">Case</th><th className="px-5 py-3 font-medium">Category</th><th className="px-5 py-3 font-medium">Sources</th><th className="px-5 py-3 font-medium">Expected fields</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {(version.testCases || []).map((testCase: any, index) => (
                    <tr key={`${testCase.name || 'case'}-${index}`}>
                      <td className="px-5 py-3 font-medium text-foreground">{testCase.name || `Case ${index + 1}`}</td>
                      <td className="px-5 py-3 text-muted-foreground">{testCase.category || 'Uncategorised'}</td>
                      <td className="px-5 py-3 text-muted-foreground">{(testCase.sourceReferences || []).join(', ') || 'None'}</td>
                      <td className="px-5 py-3 text-muted-foreground">{Object.keys(testCase.expected || {}).join(', ') || 'None'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(version.testCases || []).length === 0 && <p className="px-5 py-4 text-sm text-muted-foreground">No executable fixtures are attached.</p>}
            </div>
          </section>

          <details className="border border-border bg-card">
            <summary className="cursor-pointer px-5 py-4 font-semibold text-foreground">Inspect calculation definition</summary>
            <div className="grid gap-4 border-t border-border p-5">
              {[
                ['Constants', version.constants],
                ['Income tax', version.incomeTax],
                ['Statutory rules', version.statutoryRules],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{String(label)}</h3>
                  <div className="max-h-[32rem] overflow-auto border border-border bg-muted/30 p-3"><StructuredRuleEditor value={value ?? {}} onChange={() => undefined} disabled /></div>
                </div>
              ))}
            </div>
          </details>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-5 xl:self-start">
          <section className="border border-border bg-card p-5">
            <div className="flex items-start gap-3">
              <FileCheck2 className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
              <div><h2 className="font-semibold text-foreground">Record your decision</h2><p className="mt-1 text-sm text-muted-foreground">Only roles covered by your active authorization are available.</p></div>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block text-sm font-medium text-foreground">
                Responsibility
                <select value={role} onChange={(event) => setRole(event.target.value as TaxCertificationReviewRole)} className="mt-1.5 h-10 w-full border border-border bg-background px-3 text-sm">
                  {authorizedRoles.map((entry) => <option key={entry} value={entry}>{roleLabel[entry]}</option>)}
                </select>
              </label>
              {activeAuthorization && (
                <div className="border border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
                  <strong className="block text-foreground">{activeAuthorization.credentialType.replaceAll('_', ' ')}</strong>
                  <span>{activeAuthorization.credentialReference}</span>
                  <span className="mt-1 block">Expires {dateLabel(activeAuthorization.expiresAt)}</span>
                </div>
              )}
              <label className="block text-sm font-medium text-foreground">
                Decision
                <select value={decision} onChange={(event) => setDecision(event.target.value as typeof decision)} className="mt-1.5 h-10 w-full border border-border bg-background px-3 text-sm">
                  {Object.entries(decisionLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-foreground">
                Certified fixture run reference
                <input value={fixtureRunReference} onChange={(event) => setFixtureRunReference(event.target.value)} placeholder="Required for independent-QA approval" className="mt-1.5 h-10 w-full border border-border bg-background px-3 text-sm" />
              </label>
              <label className="block text-sm font-medium text-foreground">
                Review notes
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={6} placeholder="State what you checked, variances, and any conditions." className="mt-1.5 w-full resize-y border border-border bg-background px-3 py-2 text-sm" />
              </label>
            </div>

            <div className="mt-4 space-y-3">
              {error && <ErrorPanel message={error} />}
              {feedback && (
                <div className="flex items-start gap-2 border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-100" role="status">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{feedback}</span>
                </div>
              )}
              <button type="button" onClick={() => void submit()} disabled={submitting || authorizedRoles.length === 0} className="inline-flex h-10 w-full items-center justify-center gap-2 bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Record decision
              </button>
              <p className="text-xs leading-5 text-muted-foreground">Submitting does not publish or run payroll. A separate owner/admin publisher and every required approval are still required.</p>
            </div>
          </section>

          <section className="border border-border bg-card p-5">
            <h2 className="font-semibold text-foreground">Certification blockers</h2>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {certification.problems.map((problem) => <li key={problem} className="border-l-2 border-amber-500/60 pl-3">{problem}</li>)}
              {certification.problems.length === 0 && <li className="flex items-center gap-2 text-emerald-400"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />All reviewer gates are currently satisfied.</li>}
            </ul>
          </section>
        </aside>
      </div>
    </main>
  );
}
