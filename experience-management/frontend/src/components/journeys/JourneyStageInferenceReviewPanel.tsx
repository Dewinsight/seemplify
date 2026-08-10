import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  createGovernedStageInferenceRun, listGovernedStageInferenceRecommendations,
  reviewGovernedStageInferenceRecommendation, type GovernedStageInferenceRecommendation,
  type StageInferencePermissions, type StageInferenceReviewAction
} from '@/lib/journeyStageInferenceGovernance';

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const shortProof = (value: string | null) => value ? `${value.slice(0, 12)}…` : 'No correction in window';
const displayState = (value: string) => value.replaceAll('_', ' ');

export function JourneyStageInferenceReviewPanel({ journeyDefinitionId, currentFrom, currentTo, subjectScope, stageName }:
  { journeyDefinitionId: string; currentFrom?: string; currentTo?: string; subjectScope: 'anonymous_only' | 'known_profiles';
    stageName: (id: string) => string }) {
  const [recommendations, setRecommendations] = useState<GovernedStageInferenceRecommendation[]>([]);
  const [permissions, setPermissions] = useState<StageInferencePermissions>({ canRequestReview: false, canReview: false });
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false); const [working, setWorking] = useState<string | null>(null); const [error, setError] = useState('');
  const validWindow = Boolean(currentFrom && currentTo && Date.parse(currentTo) > Date.parse(currentFrom));
  const load = useCallback(async () => { if (!journeyDefinitionId) return;
    setLoading(true); setError(''); try { const result = await listGovernedStageInferenceRecommendations(journeyDefinitionId);
      setRecommendations(result.recommendations); setPermissions(result.permissions); }
    catch (value) { setError(value instanceof Error ? value.message : 'Could not load stage-inference recommendations.'); }
    finally { setLoading(false); }
  }, [journeyDefinitionId]);
  useEffect(() => { void load(); }, [load]);

  async function generate() {
    if (!validWindow || !currentFrom || !currentTo) { setError('Select a valid reporting window before generating review candidates.'); return; }
    const duration = Date.parse(currentTo) - Date.parse(currentFrom); const baselineFrom = new Date(Date.parse(currentFrom) - duration).toISOString();
    setWorking('generate'); setError('');
    try { const result = await createGovernedStageInferenceRun({ journeyDefinitionId, subjectScope, baselineFrom,
        baselineTo: currentFrom, currentFrom, currentTo });
      await load(); toast.success(result.replayed ? 'Existing review candidates loaded.' : 'Review candidates generated.'); }
    catch (value) { setError(value instanceof Error ? value.message : 'Could not generate review candidates.'); }
    finally { setWorking(null); }
  }

  async function review(item: GovernedStageInferenceRecommendation, action: StageInferenceReviewAction) {
    const reason = reasons[item.id]?.trim() || ''; if (reason.length < 3) return;
    setWorking(item.id); setError(''); try { await reviewGovernedStageInferenceRecommendation(item.id, item.revision, action, reason);
      setReasons((current) => ({ ...current, [item.id]: '' })); await load(); toast.success('Review decision recorded.'); }
    catch (value) { setError(value instanceof Error ? value.message : 'Could not record the review decision.'); }
    finally { setWorking(null); }
  }

  return <section className="border" aria-labelledby="governed-stage-inference-heading" data-testid="governed-stage-inference-review">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
      <div><h3 id="governed-stage-inference-heading" className="text-sm font-semibold">Evidence-backed stage-inference review</h3>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Deterministic candidates use measured recurrence and coverage. Approval records a recommendation only; it never applies or changes a stage rule.</p></div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>{loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />} Refresh</Button>
        {permissions.canRequestReview && <Button type="button" onClick={() => void generate()} disabled={!validWindow || working === 'generate'}>
          {working === 'generate' ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />} Generate review candidates</Button>}
      </div>
    </div>
    {error && <p className="border-b px-4 py-3 text-sm text-destructive" role="alert">{error}</p>}
    <ul className="divide-y" data-testid="governed-stage-inference-list">
      {recommendations.map((item) => {
        const eligibility = item.reviewEligibility; const canSubmit = permissions.canReview && Boolean(eligibility?.canSubmit);
        const canDecide = permissions.canReview && Boolean(eligibility?.canDecide); const reason = reasons[item.id] || '';
        return <li key={item.id} className="px-4 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="text-sm font-medium">Proposed stage: {stageName(item.content.proposedStageId)}</p>
            <p className="text-xs text-muted-foreground">{displayState(item.state)} · revision {item.revision}</p></div>
          <p className="mt-1 text-sm">{item.content.explanation}</p>
          <dl className="mt-3 grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-muted-foreground">Recurrence</dt><dd>{item.content.evidence.occurrenceCount} observations across {item.content.evidence.supportingInstanceCount} journeys</dd></div>
            <div><dt className="text-muted-foreground">Coverage</dt><dd>{percent(item.content.evidence.coverage)} · margin {percent(item.content.evidence.winningMargin)}</dd></div>
            <div><dt className="text-muted-foreground">Versions</dt><dd className="break-all font-mono">{item.content.lineage.designVersionId} · {item.content.lineage.ruleSetVersion}</dd></div>
            <div><dt className="text-muted-foreground">Evidence proof</dt><dd className="font-mono">{shortProof(item.content.evidence.evidenceContentSha256)}</dd></div>
            <div><dt className="text-muted-foreground">Previous window</dt><dd>{item.content.lineage.baseline.start.slice(0, 10)} to {item.content.lineage.baseline.end.slice(0, 10)}</dd></div>
            <div><dt className="text-muted-foreground">Current window</dt><dd>{item.content.lineage.current.start.slice(0, 10)} to {item.content.lineage.current.end.slice(0, 10)}</dd></div>
            <div><dt className="text-muted-foreground">Previous correction proof</dt><dd className="font-mono">{shortProof(item.content.lineage.baseline.correction.correctionRunContentSha256)}</dd></div>
            <div><dt className="text-muted-foreground">Current correction proof</dt><dd className="font-mono">{shortProof(item.content.lineage.current.correction.correctionRunContentSha256)}</dd></div>
          </dl>
          {permissions.canReview && eligibility?.isProposer && item.state !== 'retired' && <p className="mt-3 text-xs text-muted-foreground" data-testid="stage-inference-proposer-note">The proposer cannot act as either independent reviewer.</p>}
          {permissions.canReview && eligibility?.isFirstReviewer && item.state === 'in_review' && <p className="mt-3 text-xs text-muted-foreground" data-testid="stage-inference-first-reviewer-note">A distinct second reviewer must approve or reject this recommendation.</p>}
          {(canSubmit || canDecide) && <div className="mt-3 border-t pt-3">
            <Label htmlFor={`governed-stage-inference-reason-${item.id}`}>Review reason</Label>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row"><Input id={`governed-stage-inference-reason-${item.id}`} minLength={3} maxLength={2000}
              value={reason} onChange={(event) => setReasons((current) => ({ ...current, [item.id]: event.target.value }))} />
              {canSubmit && <Button type="button" variant="outline" disabled={reason.trim().length < 3 || working === item.id}
                onClick={() => void review(item, 'submit_for_review')}>Submit for independent review</Button>}
              {canDecide && <><Button type="button" disabled={reason.trim().length < 3 || working === item.id}
                onClick={() => void review(item, 'approve')}>Approve</Button><Button type="button" variant="outline"
                disabled={reason.trim().length < 3 || working === item.id} onClick={() => void review(item, 'reject')}>Reject</Button></>}
            </div>
          </div>}
        </li>;
      })}
      {!loading && !recommendations.length && <li className="px-4 py-6 text-sm text-muted-foreground">No review candidates are available. Generation abstains when evidence is suppressed, insufficient, ambiguous, overlapping, corrected after the as-of time, or version-drifted.</li>}
    </ul>
  </section>;
}
