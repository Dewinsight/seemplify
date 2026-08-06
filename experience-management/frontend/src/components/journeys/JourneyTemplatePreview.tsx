import { Badge } from '@/components/ui/badge';
import { laneLabels } from '@/lib/journeyMaps';
import type { JourneyTemplateVersion } from '@/lib/journeyTemplates';

const mapTypeLabels: Record<JourneyTemplateVersion['mapType'], string> = {
  current_state: 'Current state',
  future_state: 'Future state',
  ideal_state: 'Ideal state',
  service_blueprint: 'Service blueprint'
};

export const journeyTemplateStateLabels: Record<JourneyTemplateVersion['state'], string> = {
  draft: 'Draft',
  in_review: 'In review',
  published: 'Published',
  retired: 'Retired'
};

export function JourneyTemplateState({ state }: { state: JourneyTemplateVersion['state'] }) {
  const variant = state === 'published' ? 'success' : state === 'in_review' ? 'warning'
    : state === 'retired' ? 'outline' : 'secondary';
  return <Badge variant={variant}>{journeyTemplateStateLabels[state]}</Badge>;
}

export function JourneyTemplatePreview({ version, compact = false }: {
  version: JourneyTemplateVersion;
  compact?: boolean;
}) {
  const visibleLanes = version.lanes.filter((lane) => !lane.blueprintOnly || version.mapType === 'service_blueprint');
  return <div className="space-y-4" data-testid="journey-template-preview">
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <JourneyTemplateState state={version.state} />
      <Badge variant="outline">Version {version.versionNumber}</Badge>
      <Badge variant="outline">{mapTypeLabels[version.mapType]}</Badge>
      <span className="capitalize text-muted-foreground">{version.experienceType} experience</span>
    </div>
    {!compact && version.description && <p className="max-w-3xl whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
      {version.description}
    </p>}
    <div className="overflow-x-auto border">
      <table className="w-full min-w-[640px] border-collapse text-xs">
        <caption className="sr-only">Template preview with stages as columns and lanes as rows.</caption>
        <thead><tr>
          <th scope="col" className="w-40 border-b border-r bg-muted/40 p-2 text-left font-semibold">Lane</th>
          {version.stages.map((stage) => <th scope="col" className="min-w-44 border-b border-r bg-muted/40 p-2 text-left align-top"
            key={stage.key}>
            <span className="block font-semibold">{stage.name}</span>
            <span className="mt-1 block font-normal text-muted-foreground">{stage.goal}</span>
          </th>)}
        </tr></thead>
        <tbody>{visibleLanes.map((lane) => <tr key={lane.laneType}>
          <th scope="row" className="border-b border-r bg-muted/20 p-2 text-left align-top font-medium">
            {lane.title || laneLabels[lane.laneType] || lane.laneType}
          </th>
          {version.stages.map((stage) => {
            const cards = stage.cards.filter((card) => card.laneType === lane.laneType);
            return <td className="border-b border-r p-2 align-top" key={`${stage.key}-${lane.laneType}`}>
              {cards.length ? <ul className="space-y-1.5">{cards.map((card, index) => <li className="border bg-card p-2"
                key={`${card.kind}-${index}`}>
                <span className="font-medium">{card.title}</span>
                {!compact && card.content && <span className="mt-1 block leading-5 text-muted-foreground">{card.content}</span>}
              </li>)}</ul> : <span className="text-muted-foreground">No cards</span>}
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
