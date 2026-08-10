import { useMemo, useState } from 'react';
import type {
  JourneyStageComparisonDimension, JourneyStageComparisonRow, JourneyStageTrendResult
} from '../../lib/journeyStageIntelligence';

const labels: Record<JourneyStageComparisonDimension, string> = {
  persona: 'Persona', segment: 'Segment', cohort: 'Cohort', channel: 'Channel'
};

function value(row: JourneyStageComparisonRow, field: number | null, suffix = '') {
  if (row.suppression.suppressed) return 'Suppressed';
  return field === null ? 'Unknown' : `${field}${suffix}`;
}

function dominantEmotion(row: JourneyStageComparisonRow) {
  if (row.suppression.suppressed) return 'Suppressed';
  const ranked = Object.entries(row.emotions).filter(([, share]) => share !== null)
    .sort((left, right) => Number(right[1]) - Number(left[1]) || left[0].localeCompare(right[0]));
  return !ranked.length || Number(ranked[0][1]) === 0 ? 'Unknown' : `${ranked[0][0]} ${ranked[0][1]}%`;
}

/** Accessible time-series alternative. Every row is already independently
 * suppressed by the server for its own period. */
export function JourneyStageTrendTable({ result }: { result: JourneyStageTrendResult }) {
  const available = useMemo(() => [...new Set(result.buckets.flatMap((bucket) =>
    bucket.rows.map((row) => row.dimension)))], [result]);
  const [dimension, setDimension] = useState<JourneyStageComparisonDimension>(available[0] || 'persona');
  const rows = useMemo(() => result.buckets.flatMap((bucket) => bucket.rows
    .filter((row) => row.dimension === dimension).map((row) => ({ bucket, row }))), [result, dimension]);
  return <section className="border bg-card" aria-labelledby="journey-stage-trends-heading"
    data-testid="journey-stage-trend-table">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b px-4 py-3">
      <div><h2 id="journey-stage-trends-heading" className="text-sm font-semibold">Sentiment and emotion trends</h2>
        <p className="mt-1 text-sm text-muted-foreground">Each period is evaluated and suppressed independently.</p></div>
      <label className="grid gap-1 text-sm" htmlFor="journey-stage-trend-dimension">Group by
        <select id="journey-stage-trend-dimension" className="h-9 border bg-background px-3 text-sm"
          value={dimension} onChange={(event) => setDimension(event.target.value as JourneyStageComparisonDimension)}>
          {available.map((item) => <option key={item} value={item}>{labels[item]}</option>)}
        </select>
      </label>
    </div>
    <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[1060px] border-collapse text-left text-sm">
      <caption className="sr-only">Stage measure, sentiment, and emotion shares by independently protected time period.</caption>
      <thead className="border-b bg-muted/40"><tr><th className="px-3 py-2">Period</th><th className="px-3 py-2">Stage</th>
        <th className="px-3 py-2">{labels[dimension]}</th><th className="px-3 py-2">Measure</th>
        <th className="px-3 py-2">Value</th><th className="px-3 py-2">Sample</th><th className="px-3 py-2">Positive</th>
        <th className="px-3 py-2">Negative</th><th className="px-3 py-2">Dominant emotion</th></tr></thead>
      <tbody>{rows.map(({ bucket, row }) => <tr className="border-b last:border-0"
        key={`${bucket.from}-${row.stageId}-${row.dimension}-${row.dimensionId}-${row.metricDefinitionVersionId}`}>
        <td className="whitespace-nowrap px-3 py-3">{new Date(bucket.from).toLocaleDateString()}–{new Date(bucket.to).toLocaleDateString()}</td>
        <th scope="row" className="px-3 py-3 font-medium">{row.stageId}</th><td className="px-3 py-3">{row.dimensionId}</td>
        <td className="px-3 py-3">{row.metricName}</td><td className="px-3 py-3">{value(row, row.value, row.value === null ? '' : ` ${row.metricUnit}`)}</td>
        <td className="px-3 py-3">{value(row, row.sampleSize)}</td><td className="px-3 py-3">{value(row, row.sentiment.positive, '%')}</td>
        <td className="px-3 py-3">{value(row, row.sentiment.negative, '%')}</td><td className="px-3 py-3">{dominantEmotion(row)}</td>
      </tr>)}{!rows.length && <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
        No authorised {labels[dimension].toLowerCase()} trend is available for this window.</td></tr>}</tbody>
    </table></div>
    {result.buckets.some((bucket) => bucket.rows.some((row) => row.suppression.suppressed))
      && <p className="border-t px-4 py-3 text-xs text-muted-foreground" role="status">
        Suppressed periods disclose no samples, values, sentiment, emotions, or source lineage.
      </p>}
  </section>;
}
