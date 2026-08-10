import { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getPublicJourneyShare, type PublicJourneyShare } from '@/lib/journeyCollaboration';
import { useParams } from '@/lib/router';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function rows(value: unknown) { return Array.isArray(value) ? value.map(record) : []; }
function value(value: unknown, fallback = '—') {
  return value === null || value === undefined || value === '' ? fallback : String(value);
}
function date(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function PublicJourneySharePage() {
  const { token = '' } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicJourneyShare | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setError(''); setData(null);
    void getPublicJourneyShare(token).then((result) => { if (active) setData(result); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'This Journey share is unavailable.'); });
    return () => { active = false; };
  }, [token]);

  if (error) return <main className="mx-auto max-w-3xl p-6 sm:p-10"><h1 className="text-2xl font-semibold">Journey share unavailable</h1><p role="alert" className="mt-4 border p-4 text-sm text-muted-foreground">{error}</p></main>;
  if (!data) return <main className="grid min-h-screen place-items-center" aria-label="Loading Journey share"><Loader2 className="animate-spin" /></main>;
  return <main className="mx-auto max-w-7xl p-4 sm:p-8" data-testid="public-journey-share">
    <header className="flex flex-col justify-between gap-4 border-b pb-5 sm:flex-row sm:items-end">
      <div><p className="text-sm text-muted-foreground">Read-only Journey snapshot</p><h1 className="mt-1 text-2xl font-semibold">{data.snapshot.title}</h1><p className="mt-2 text-sm text-muted-foreground">Captured {date(data.snapshot.capturedAt)} · target revision {data.snapshot.targetRevision} · expires {date(data.share.expiresAt)}</p></div>
      {data.share.allowDownload && <Button asChild variant="outline"><a href={`/api/public/journey-shares/${encodeURIComponent(token)}?action=download`}><Download />Download JSON</a></Button>}
    </header>
    <SnapshotContent content={data.snapshot.content} />
    <footer className="mt-8 border-t pt-4 text-xs text-muted-foreground">This bearer link is read-only. It stops working immediately when revoked and automatically at expiry.</footer>
  </main>;
}

function SnapshotContent({ content }: { content: Record<string, unknown> }) {
  const kind = String(content.kind || '');
  if (kind === 'journey_map') return <JourneyMapSnapshot content={content} />;
  if (kind === 'persona') return <PersonaSnapshot content={content} />;
  if (kind === 'portfolio') return <PortfolioSnapshot content={content} />;
  if (kind === 'collaboration_view') {
    const resource = record(content.resource);
    return <section className="mt-6 space-y-5"><div className="border p-4"><h2 className="font-medium">Saved view</h2><p className="mt-1 text-sm text-muted-foreground">Audience: {value(content.audience)} · revision {value(content.revision)}</p></div><SnapshotContent content={resource} /></section>;
  }
  return <p className="mt-6 border p-4 text-sm text-muted-foreground">This snapshot type cannot be displayed.</p>;
}

function JourneyMapSnapshot({ content }: { content: Record<string, unknown> }) {
  const definition = record(content.definition); const version = record(content.version);
  const stages = rows(content.stages); const cards = rows(content.cards);
  return <section className="mt-6 space-y-5">
    <div className="border p-4"><h2 className="font-medium">Map details</h2><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-muted-foreground">Mode</dt><dd>{value(definition.mode)}</dd></div><div><dt className="text-muted-foreground">Status</dt><dd>{value(definition.status)}</dd></div><div><dt className="text-muted-foreground">Map type</dt><dd>{value(version.mapType)}</dd></div><div><dt className="text-muted-foreground">Version</dt><dd>{value(version.versionNumber)}</dd></div></dl>{version.objective ? <p className="mt-3 text-sm"><span className="font-medium">Objective:</span> {value(version.objective)}</p> : null}</div>
    <div className="overflow-x-auto border"><table className="w-full min-w-[52rem] text-left text-sm"><caption className="border-b px-4 py-3 text-left font-medium">Stages and journey content</caption><thead><tr className="border-b"><th className="px-4 py-2">Stage</th><th>Goal</th><th>Journey content</th></tr></thead><tbody>{stages.map((stage, stageIndex) => { const stageCards = cards.filter((card) => card.stageKey === stage.stageKey); return <tr key={`${value(stage.stageKey)}-${stageIndex}`} className="border-b align-top last:border-0"><td className="px-4 py-3 font-medium">{value(stage.name)}</td><td className="max-w-72 pr-4">{value(stage.goal)}</td><td className="pr-4">{stageCards.length ? <ul className="space-y-2">{stageCards.map((card, cardIndex) => <li key={`${value(card.stageKey)}-${value(card.ordinal)}-${cardIndex}`}><span className="font-medium">{value(card.title)}</span><span className="ml-2 text-xs text-muted-foreground">{value(card.laneType)} · {value(card.kind)}</span>{card.content ? <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{value(card.content)}</p> : null}</li>)}</ul> : <span className="text-muted-foreground">No content in this stage.</span>}</td></tr>; })}</tbody></table></div>
  </section>;
}

function PersonaSnapshot({ content }: { content: Record<string, unknown> }) {
  const groups = [['Goals', content.goals], ['Behaviours', content.behaviours], ['Needs', content.needs], ['Barriers', content.barriers]] as const;
  const claims = rows(content.claims);
  return <section className="mt-6 space-y-5"><div className="border p-4"><h2 className="font-medium">Persona</h2><p className="mt-2 whitespace-pre-wrap text-sm">{value(content.summary)}</p><dl className="mt-3 text-sm"><dt className="text-muted-foreground">Lifecycle</dt><dd>{value(content.lifecycleState)}</dd></dl></div><div className="grid gap-4 md:grid-cols-2">{groups.map(([label, items]) => <section key={label} className="border p-4"><h2 className="font-medium">{label}</h2>{Array.isArray(items) && items.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{items.map((item, index) => <li key={`${label}-${index}`}>{value(item)}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">None recorded.</p>}</section>)}</div>{claims.length > 0 && <div className="overflow-x-auto border"><table className="w-full min-w-[42rem] text-left text-sm"><caption className="border-b px-4 py-3 text-left font-medium">Evidence-backed claims</caption><thead><tr className="border-b"><th className="px-4 py-2">Type</th><th>Claim</th><th>Accessible evidence</th></tr></thead><tbody>{claims.map((claim, index) => <tr key={`${value(claim.type)}-${value(claim.ordinal)}-${index}`} className="border-b last:border-0"><td className="px-4 py-3">{value(claim.type)}</td><td>{value(claim.label)}: {value(claim.value)}</td><td>{value(claim.evidenceCount, '0')}</td></tr>)}</tbody></table></div>}</section>;
}

function PortfolioSnapshot({ content }: { content: Record<string, unknown> }) {
  const items = rows(content.items);
  return <section className="mt-6"><div className="overflow-x-auto border"><table className="w-full min-w-[60rem] text-left text-sm"><caption className="border-b px-4 py-3 text-left font-medium">Journey portfolio</caption><thead><tr className="border-b"><th className="px-4 py-2">Item</th><th>Kind</th><th>Lifecycle</th><th>Priority</th><th>Progress</th><th>Evidence</th></tr></thead><tbody>{items.map((item, index) => <tr key={`${value(item.kind)}-${value(item.title)}-${index}`} className="border-b align-top last:border-0"><td className="px-4 py-3"><span className="font-medium">{value(item.title)}</span>{item.description ? <p className="mt-1 max-w-xl text-muted-foreground">{value(item.description)}</p> : null}</td><td>{value(item.kind)}</td><td>{value(item.lifecycle)}</td><td>{value(item.priority)}</td><td>{item.progressPercent === null || item.progressPercent === undefined ? '—' : `${value(item.progressPercent)}%`}</td><td>{value(item.evidenceCount, '0')}</td></tr>)}</tbody></table></div></section>;
}
