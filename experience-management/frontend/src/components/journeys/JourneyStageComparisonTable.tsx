import { useMemo, useState } from 'react';
import type { JourneyStageComparisonDimension, JourneyStageComparisonRow } from '../../lib/journeyStageIntelligence';

const dimensions: JourneyStageComparisonDimension[] = ['persona', 'segment', 'cohort', 'channel'];
const labels: Record<JourneyStageComparisonDimension, string> = {
  persona: 'Persona', segment: 'Segment', cohort: 'Cohort', channel: 'Channel'
};

function displayed(value: number | null, suppressed: boolean, suffix = '') {
  if (suppressed) return 'Suppressed';
  return value === null ? 'Unknown' : `${value}${suffix}`;
}

function dominantEmotion(row: JourneyStageComparisonRow) {
  if (row.suppression.suppressed) return 'Suppressed';
  const ranked = Object.entries(row.emotions).filter(([, value]) => value !== null)
    .sort((left, right) => Number(right[1]) - Number(left[1]) || left[0].localeCompare(right[0]));
  if (!ranked.length || Number(ranked[0][1]) === 0) return 'Unknown';
  return `${ranked[0][0]} ${ranked[0][1]}%`;
}

/** Plain table alternative for the stage comparison surface. The component
 * accepts only the server-suppressed projection and never raw subjects. */
export function JourneyStageComparisonTable({ rows }: { rows: JourneyStageComparisonRow[] }) {
  const [dimension, setDimension] = useState<JourneyStageComparisonDimension>('persona');
  const visible = useMemo(() => rows.filter((row) => row.dimension === dimension), [rows, dimension]);
  return <section className="border bg-card" aria-labelledby="journey-stage-comparison-heading"
    data-testid="journey-stage-comparison-table">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b px-4 py-3">
      <div><h2 id="journey-stage-comparison-heading" className="text-sm font-semibold">Stage comparisons</h2>
        <p className="mt-1 text-sm text-muted-foreground">Authorised aggregates by persona, segment, cohort, or channel.</p></div>
      <label className="grid gap-1 text-sm" htmlFor="journey-stage-comparison-dimension">Compare by
        <select id="journey-stage-comparison-dimension" className="h-9 border bg-background px-3 text-sm"
          value={dimension} onChange={(event) => setDimension(event.target.value as JourneyStageComparisonDimension)}>
          {dimensions.map((item) => <option key={item} value={item}>{labels[item]}</option>)}
        </select>
      </label>
    </div>
    <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[980px] border-collapse text-left text-sm">
      <caption className="sr-only">Journey-stage measures, sentiment, emotions, suppression, and exact version lineage.</caption>
      <thead className="border-b bg-muted/40"><tr><th className="px-3 py-2">Stage</th><th className="px-3 py-2">{labels[dimension]}</th>
        <th className="px-3 py-2">Measure</th><th className="px-3 py-2">Value</th><th className="px-3 py-2">Sample</th>
        <th className="px-3 py-2">Sentiment</th><th className="px-3 py-2">Emotion</th><th className="px-3 py-2">Lineage</th></tr></thead>
      <tbody>{visible.map((row) => <tr className="border-b last:border-0" key={`${row.stageId}-${row.dimensionId}-${row.metricDefinitionVersionId}`}>
        <th scope="row" className="px-3 py-3 font-medium">{row.stageId}</th><td className="px-3 py-3">{row.dimensionId}</td>
        <td className="px-3 py-3">{row.metricName}</td><td className="px-3 py-3">{displayed(row.value, row.suppression.suppressed, row.value === null ? '' : ` ${row.metricUnit}`)}</td>
        <td className="px-3 py-3">{displayed(row.sampleSize, row.suppression.suppressed)}</td>
        <td className="px-3 py-3">{row.suppression.suppressed ? 'Suppressed'
          : `Positive ${displayed(row.sentiment.positive, false, '%')} · Negative ${displayed(row.sentiment.negative, false, '%')}`}</td>
        <td className="px-3 py-3">{dominantEmotion(row)}</td>
        <td className="px-3 py-3 font-mono text-xs"><span className="block">{row.metricDefinitionVersionId}</span>
          <span className="block text-muted-foreground">{row.metricDefinitionVersionSha256.slice(0, 12)} · {row.calculationVersion}</span></td>
      </tr>)}{!visible.length && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
        No authorised {labels[dimension].toLowerCase()} comparison is available for this window.</td></tr>}</tbody>
    </table></div>
    {visible.some((row) => row.suppression.suppressed) && <p className="border-t px-4 py-3 text-xs text-muted-foreground" role="status">
      Primary and complementary suppression hide values, samples, sentiment, and emotions where disclosure risk exists.
    </p>}
  </section>;
}
