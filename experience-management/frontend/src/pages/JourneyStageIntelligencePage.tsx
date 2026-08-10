import { useEffect, useMemo, useState } from 'react';
import { JourneyStageComparisonTable } from '../components/journeys/JourneyStageComparisonTable';
import { JourneyStageTrendTable } from '../components/journeys/JourneyStageTrendTable';
import { JourneyEventMappingPanel } from '../components/journeys/JourneyEventMappingPanel';
import { useAuthSession } from '../lib/authSessionContext';
import { listJourneyMaps, type JourneyDefinitionSummary } from '../lib/journeyMaps';
import {
  downloadJourneyStageComparisons, journeyStageComparisonDimensions, journeyStagePurposes,
  readJourneyStageComparisons, readJourneyStagePolicy, readJourneyStageTrends, updateJourneyStagePolicy,
  type JourneyStageComparisonDimension, type JourneyStageComparisonResult, type JourneyStageIntelligencePolicy,
  type JourneyStagePurpose, type JourneyStageTrendResult
} from '../lib/journeyStageIntelligence';

function dateInput(date: Date) { return date.toISOString().slice(0, 10); }
function timestamp(date: string, end = false) { return new Date(`${date}T${end ? '23:59:59.999' : '00:00:00.000'}Z`).toISOString(); }
function message(error: unknown) { return error instanceof Error ? error.message : 'Journey stage intelligence could not be loaded.'; }

export function JourneyStageIntelligencePage({ journeyDefinitionId: fixedJourneyDefinitionId,
  canManage: fixedCanManage }: { journeyDefinitionId?: string; canManage?: boolean } = {}) {
  const session = useAuthSession();
  const [journeys, setJourneys] = useState<JourneyDefinitionSummary[]>([]);
  const [selectedJourneyId, setSelectedJourneyId] = useState(fixedJourneyDefinitionId || '');
  const journeyDefinitionId = fixedJourneyDefinitionId || selectedJourneyId;
  const canManage = fixedCanManage ?? Boolean(session?.activeSpace && session.activeSpace.role !== 'member');
  const today = useMemo(() => new Date(), []); const monthAgo = useMemo(() => new Date(today.getTime() - 30 * 86_400_000), [today]);
  const [from, setFrom] = useState(dateInput(monthAgo)); const [to, setTo] = useState(dateInput(today));
  const [purpose, setPurpose] = useState<JourneyStagePurpose>('analytics');
  const [dimensions, setDimensions] = useState<JourneyStageComparisonDimension[]>([...journeyStageComparisonDimensions]);
  const [result, setResult] = useState<JourneyStageComparisonResult | null>(null);
  const [trend, setTrend] = useState<JourneyStageTrendResult | null>(null);
  const [bucketDays, setBucketDays] = useState(7);
  const [policy, setPolicy] = useState<JourneyStageIntelligencePolicy | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const query = useMemo(() => ({ journeyDefinitionId, purpose, from: timestamp(from), to: timestamp(to, true),
    asOf: new Date().toISOString(), dimensions }), [journeyDefinitionId, purpose, from, to, dimensions]);

  async function load() {
    if (!journeyDefinitionId) return;
    setLoading(true); setError('');
    try { const [comparison, nextTrend, serverPolicy] = await Promise.all([
      readJourneyStageComparisons(query), readJourneyStageTrends({ ...query, bucketDays }), readJourneyStagePolicy()]);
      setResult(comparison); setTrend(nextTrend); setPolicy(serverPolicy); }
    catch (reason) { setError(message(reason)); } finally { setLoading(false); }
  }
  useEffect(() => {
    if (fixedJourneyDefinitionId) return;
    let active = true;
    listJourneyMaps().then((index) => {
      if (!active) return;
      setJourneys(index.journeyMaps);
      setSelectedJourneyId((current) => index.journeyMaps.some((item) => item.id === current)
        ? current : index.journeyMaps[0]?.id || '');
    }).catch((reason) => { if (active) setError(message(reason)); });
    return () => { active = false; };
  }, [fixedJourneyDefinitionId]);
  useEffect(() => { void load(); }, [journeyDefinitionId]); // Filters apply explicitly, avoiding request churn while editing.

  async function savePolicy() {
    if (!policy || !canManage) return; setSaving(true); setError('');
    try { const updated = await updateJourneyStagePolicy(policy); setPolicy(updated);
      setDimensions((current) => current.filter((dimension) => updated.dimensions.includes(dimension))); await load(); }
    catch (reason) { setError(message(reason)); } finally { setSaving(false); }
  }
  async function download(format: 'csv' | 'json') {
    try {
      const artifact = await downloadJourneyStageComparisons(query, format); const url = URL.createObjectURL(artifact.blob);
      const link = document.createElement('a'); link.href = url; link.download = `journey-stage-comparisons.${format}`;
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (reason) { setError(message(reason)); }
  }

  return <div className="space-y-4" data-testid="journey-stage-intelligence-page">
    <div><h1 className="page-title">Journey stage intelligence</h1>
      <p className="page-description">Compare authorised stage measures, sentiment, and emotions without exposing small groups.</p></div>
    {error && <p className="border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">{error}</p>}
    {!fixedJourneyDefinitionId && <label className="grid max-w-xl gap-1 text-sm">Journey map
      <select className="h-9 border bg-background px-3" value={selectedJourneyId}
        onChange={(event) => setSelectedJourneyId(event.target.value)}>
        {!journeys.length && <option value="">No journey maps available</option>}
        {journeys.map((journey) => <option key={journey.id} value={journey.id}>{journey.name}</option>)}
      </select>
    </label>}
    <form className="grid gap-3 border bg-card p-4 md:grid-cols-2 xl:grid-cols-5" onSubmit={(event) => { event.preventDefault(); void load(); }}>
      <label className="grid gap-1 text-sm">From<input type="date" className="h-9 border bg-background px-3" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label className="grid gap-1 text-sm">To<input type="date" className="h-9 border bg-background px-3" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <label className="grid gap-1 text-sm">Purpose<select className="h-9 border bg-background px-3" value={purpose}
        onChange={(event) => setPurpose(event.target.value as JourneyStagePurpose)}>{journeyStagePurposes.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Trend interval<select className="h-9 border bg-background px-3" value={bucketDays}
        onChange={(event) => setBucketDays(Number(event.target.value))}><option value={1}>Daily</option><option value={7}>Weekly</option>
        <option value={14}>Every 14 days</option><option value={30}>Every 30 days</option></select></label>
      <fieldset className="md:col-span-2"><legend className="text-sm">Dimensions</legend><div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
        {(policy?.dimensions || journeyStageComparisonDimensions).map((dimension) => <label key={dimension} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={dimensions.includes(dimension)} onChange={(event) => setDimensions((current) => event.target.checked
            ? [...new Set([...current, dimension])] : current.filter((item) => item !== dimension))} />{dimension}</label>)}</div></fieldset>
      <div className="flex flex-wrap gap-2 md:col-span-2 xl:col-span-5"><button className="h-9 border bg-foreground px-4 text-sm text-background" type="submit" disabled={loading || !dimensions.length || !journeyDefinitionId}>{loading ? 'Loading…' : 'Apply comparison'}</button>
        <button className="h-9 border px-4 text-sm" type="button" disabled={!result?.rows.length} onClick={() => void download('csv')}>Export CSV</button>
        <button className="h-9 border px-4 text-sm" type="button" disabled={!result?.rows.length} onClick={() => void download('json')}>Export JSON</button></div>
    </form>
    {result && <><p className="text-xs text-muted-foreground">Window {new Date(result.window.from).toLocaleDateString()}–{new Date(result.window.to).toLocaleDateString()} · minimum sample {result.minimumSampleSize} · calculation fingerprint {result.fingerprint.slice(0, 12)}</p>
      <JourneyStageComparisonTable rows={result.rows} /></>}
    {trend && <JourneyStageTrendTable result={trend} />}
    {canManage && policy && <section className="border bg-card p-4" aria-labelledby="stage-policy-heading"><h2 id="stage-policy-heading" className="text-sm font-semibold">Privacy policy</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm">Minimum sample size<input type="number" min={3} max={1000} className="h-9 border bg-background px-3" value={policy.minimumSampleSize}
        onChange={(event) => setPolicy({ ...policy, minimumSampleSize: Number(event.target.value) })} /></label>
        <label className="grid gap-1 text-sm">Maximum rows<input type="number" min={1} max={5000} className="h-9 border bg-background px-3" value={policy.maximumRows}
          onChange={(event) => setPolicy({ ...policy, maximumRows: Number(event.target.value) })} /></label></div>
      <button className="mt-3 h-9 border px-4 text-sm" disabled={saving} onClick={() => void savePolicy()}>{saving ? 'Saving…' : 'Save privacy policy'}</button></section>}
    <JourneyEventMappingPanel canManage={canManage} />
  </div>;
}
