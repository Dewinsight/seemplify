import { useState } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { readActualPathComparison, type JourneyActualPathComparison } from '@/lib/journeyActualPathComparison';

export function JourneyActualPathComparisonPanel({ journeyDefinitionId, currentFrom, currentTo, subjectScope,
  stageName }: { journeyDefinitionId: string; currentFrom?: string; currentTo?: string;
  subjectScope: 'anonymous_only' | 'known_profiles'; stageName: (id: string) => string }) {
  const [comparison, setComparison] = useState<JourneyActualPathComparison | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const validWindow = Boolean(currentFrom && currentTo && Date.parse(currentTo) > Date.parse(currentFrom));
  const duration = validWindow ? Date.parse(currentTo!) - Date.parse(currentFrom!) : 0;
  const baselineTo = currentFrom || ''; const baselineFrom = validWindow ? new Date(Date.parse(currentFrom!) - duration).toISOString() : '';
  async function load() { if (!validWindow) { setError('Select a valid reporting window before comparing periods.'); return; }
    setLoading(true); setError(''); try { setComparison(await readActualPathComparison({ journeyDefinitionId,
    subjectScope, baselineFrom, baselineTo, currentFrom: currentFrom!, currentTo: currentTo! })); } catch (value) { setError(value instanceof Error ? value.message : 'Comparison failed.'); }
    finally { setLoading(false); } }
  return <section className="border" aria-labelledby="actual-path-comparison-heading" data-testid="actual-path-comparison">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
      <div><h3 id="actual-path-comparison-heading" className="text-sm font-semibold">Previous-period path comparison</h3>
        <p className="mt-1 text-sm text-muted-foreground">Compares the selected window with the immediately preceding equal-length window.</p></div>
      <Button type="button" variant="outline" onClick={() => void load()} disabled={loading || !validWindow}>
        {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />} Compare periods
      </Button>
    </div>
    {error && <p role="alert" className="border-b px-4 py-3 text-sm text-destructive">{error}</p>}
    {!comparison && !error && <p className="px-4 py-5 text-sm text-muted-foreground">Run the comparison to inspect corrected, version-matched stage changes.</p>}
    {comparison && <div className="space-y-4 p-4">
      {comparison.status === 'abstained' && <div role="status" className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        The comparison abstained because one or both windows are suppressed or below the minimum sample. Unknown values are not zero.
      </div>}
      <section aria-labelledby="actual-path-flow-heading">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h4 id="actual-path-flow-heading" className="text-sm font-semibold">Observed path changes</h4>
          <p className="text-xs text-muted-foreground">Visible, version-matched paths only</p>
        </div>
        <div className="overflow-x-auto border" data-testid="actual-path-flow-table">
          <table className="w-full min-w-[680px] border-collapse text-sm">
            <caption className="sr-only">Observed journey path counts in the previous and current reporting windows</caption>
            <thead><tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="px-3 py-2">Observed path</th>
              <th scope="col" className="px-3 py-2 text-right">Previous</th>
              <th scope="col" className="px-3 py-2 text-right">Current</th>
              <th scope="col" className="px-3 py-2 text-right">Change</th>
            </tr></thead>
            <tbody>{comparison.comparisons.paths.map((path) => <tr key={path.signatureSha256} className="border-b last:border-0">
              <th scope="row" className="px-3 py-3 text-left font-medium">
                <ol className="flex min-w-max items-center gap-2" aria-label={path.stageIds.map(stageName).join(' then ')}>
                  {path.stageIds.map((stageId, index) => <li key={`${stageId}-${index}`} className="flex items-center gap-2">
                    {index > 0 && <span aria-hidden="true" className="text-muted-foreground">→</span>}
                    <span>{stageName(stageId)}</span>
                  </li>)}
                </ol>
              </th>
              <td className="px-3 py-3 text-right tabular-nums">{path.baseline.value}</td>
              <td className="px-3 py-3 text-right tabular-nums">{path.current.value}</td>
              <td className="px-3 py-3 text-right tabular-nums">{path.delta > 0 ? '+' : ''}{path.delta}</td>
            </tr>)}{!comparison.comparisons.paths.length && <tr><td colSpan={4} className="px-3 py-5 text-center text-muted-foreground">
              No path-level changes are visible for these windows. Suppressed paths are not listed.
            </td></tr>}</tbody>
          </table>
        </div>
      </section>
      <div className="overflow-x-auto"><table className="w-full min-w-[640px] border-collapse text-sm">
        <caption className="sr-only">Stage drop-off comparison between the previous and current reporting windows</caption>
        <thead><tr className="border-b text-left text-xs text-muted-foreground"><th scope="col" className="py-2 pr-4">Stage</th><th scope="col" className="px-4 py-2">Previous drop-off</th><th scope="col" className="px-4 py-2">Current drop-off</th><th scope="col" className="pl-4 py-2">Change</th></tr></thead>
        <tbody>{comparison.comparisons.stages.map((row) => <tr key={row.stageId} className="border-b last:border-0"><th scope="row" className="py-3 pr-4 text-left font-medium">{stageName(row.stageId)}</th>
          <td className="px-4 py-3">{row.baselineDropOffPercentage === null ? 'Unknown / suppressed' : `${row.baselineDropOffPercentage}%`}</td>
          <td className="px-4 py-3">{row.currentDropOffPercentage === null ? 'Unknown / suppressed' : `${row.currentDropOffPercentage}%`}</td>
          <td className="pl-4 py-3">{row.percentagePointDelta === null ? 'Unknown' : `${row.percentagePointDelta > 0 ? '+' : ''}${row.percentagePointDelta} pp`}</td></tr>)}</tbody>
      </table></div>
      <dl className="grid gap-2 border px-3 py-3 text-xs sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Previous processing versions</dt><dd className="mt-1 font-mono">
          {comparison.provenance.baselineRuleSetVersion} · {comparison.provenance.baselineProjectionVersion}
        </dd></div>
        <div><dt className="text-muted-foreground">Current processing versions</dt><dd className="mt-1 font-mono">
          {comparison.provenance.currentRuleSetVersion} · {comparison.provenance.currentProjectionVersion}
        </dd></div>
        {comparison.provenance.sourceCitations.map((citation) => <div key={citation.window}><dt className="text-muted-foreground">{citation.window === 'baseline' ? 'Previous' : 'Current'} source proof</dt>
          <dd className="mt-1 break-all font-mono">{citation.analyticsContentSha256.slice(0, 16)}… · {citation.correction.projectionFreshness.replaceAll('_', ' ')}</dd></div>)}
      </dl>
      {comparison.comparisons.bounds.suppressedPathCells && <p className="text-xs text-muted-foreground">Small path cells and one complementary cell were omitted to prevent reconstruction.</p>}
      {comparison.comparisons.bounds.suppressedStageCells && <p className="text-xs text-muted-foreground">Small stage cells and one complementary stage cell are shown as unknown to prevent reconstruction.</p>}
      <p className="text-xs text-muted-foreground">{comparison.interpretation.statement}</p>
    </div>}
  </section>;
}
