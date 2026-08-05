import type { JourneyRichMapSnapshot } from '@/lib/journeyRichCards';

type CurvePoint = JourneyRichMapSnapshot['emotionalCurve'][number];

function coordinate(index: number, count: number, value: number) {
  const x = count <= 1 ? 50 : 6 + (index / (count - 1)) * 88;
  const y = 50 - value * 8;
  return { x, y };
}

export function JourneyEmotionalCurve({ points, compact = false }: { points: CurvePoint[]; compact?: boolean }) {
  if (!points.length) {
    return <div className="border border-dashed px-4 py-7 text-center text-sm text-muted-foreground"
      data-testid="journey-emotional-curve-empty">
      No emotion cards have exact curve values yet.
    </div>;
  }
  const line = points.map((point, index) => {
    const { x, y } = coordinate(index, points.length, point.valence);
    return `${x},${y}`;
  }).join(' ');
  return <div className="space-y-3" data-testid="journey-emotional-curve">
    <div className="overflow-x-auto border bg-background px-2 py-3">
      <svg viewBox="0 0 100 108" className={compact ? 'h-36 min-w-[420px] w-full' : 'h-52 min-w-[560px] w-full'}
        role="img" aria-labelledby="journey-curve-title journey-curve-description">
        <title id="journey-curve-title">Emotional curve across journey cards</title>
        <desc id="journey-curve-description">Exact valence values from minus five to plus five. Intensity is shown by point size.</desc>
        {[5, 0, -5].map((value) => <g key={value}>
          <line x1="5" x2="95" y1={50 - value * 8} y2={50 - value * 8}
            stroke="currentColor" opacity={value === 0 ? 0.3 : 0.12} strokeDasharray={value === 0 ? undefined : '2 2'} />
          <text x="1" y={51.5 - value * 8} fontSize="3.4" fill="currentColor" opacity="0.65">{value > 0 ? `+${value}` : value}</text>
        </g>)}
        <polyline points={line} fill="none" stroke="currentColor" strokeWidth="0.75" vectorEffect="non-scaling-stroke" />
        {points.map((point, index) => {
          const { x, y } = coordinate(index, points.length, point.valence);
          return <g key={point.cardId}>
            <circle cx={x} cy={y} r={1.3 + point.intensity * 0.22} fill="currentColor">
              <title>{`${point.stageName}: ${point.label || 'Unlabelled'}, valence ${point.valence}, intensity ${point.intensity}`}</title>
            </circle>
            <line x1={x} x2={x} y1={92} y2={95} stroke="currentColor" opacity="0.35" />
            <text x={x} y="100" fontSize="3.2" textAnchor="middle" fill="currentColor" opacity="0.8">
              {point.stageName.slice(0, 18)}
            </text>
            <text x={x} y="104.5" fontSize="2.8" textAnchor="middle" fill="currentColor" opacity="0.6">
              {point.label.slice(0, 20)}
            </text>
          </g>;
        })}
      </svg>
    </div>
    {!compact && <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-xs">
        <caption className="sr-only">Exact emotional curve values by journey stage and card</caption>
        <thead><tr className="border-b text-left text-muted-foreground">
          <th scope="col" className="px-2 py-2 font-medium">Stage</th>
          <th scope="col" className="px-2 py-2 font-medium">Label</th>
          <th scope="col" className="px-2 py-2 font-medium">Valence</th>
          <th scope="col" className="px-2 py-2 font-medium">Intensity</th>
        </tr></thead>
        <tbody>{points.map((point) => <tr key={point.cardId} className="border-b last:border-b-0">
          <th scope="row" className="px-2 py-2 text-left font-medium">{point.stageName}</th>
          <td className="px-2 py-2">{point.label || 'Unlabelled'}</td>
          <td className="px-2 py-2 tabular-nums">{point.valence > 0 ? `+${point.valence}` : point.valence}</td>
          <td className="px-2 py-2 tabular-nums">{point.intensity}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </div>;
}
