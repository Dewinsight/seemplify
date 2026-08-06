import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cardKindLabels, laneCardKinds, laneLabels } from '@/lib/journeyMaps';
import type {
  JourneyTemplateCard, JourneyTemplateContent, JourneyTemplateLane, JourneyTemplateStage
} from '@/lib/journeyTemplates';

const experienceTypes: Array<{ value: JourneyTemplateContent['experienceType']; label: string }> = [
  { value: 'customer', label: 'Customer' },
  { value: 'employee', label: 'Employee' },
  { value: 'citizen', label: 'Citizen' },
  { value: 'patient', label: 'Patient' },
  { value: 'partner', label: 'Partner' },
  { value: 'custom', label: 'Custom' }
];

const mapTypes: Array<{ value: JourneyTemplateContent['mapType']; label: string }> = [
  { value: 'current_state', label: 'Current state' },
  { value: 'future_state', label: 'Future state' },
  { value: 'ideal_state', label: 'Ideal state' },
  { value: 'service_blueprint', label: 'Service blueprint' }
];

const laneTypes = Object.keys(laneLabels);
const selectClassName = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';
const customLanePattern = /^custom_[a-z0-9](?:[a-z0-9_-]{0,54}[a-z0-9])?$/u;

function customLaneKey() {
  return `custom_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

function slug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80);
}

function reindex(lanes: JourneyTemplateLane[]) {
  return lanes.map((lane, ordinal) => ({ ...lane, ordinal }));
}

function move<T>(items: T[], from: number, to: number) {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function journeyTemplateContentIssues(content: JourneyTemplateContent) {
  const issues: string[] = [];
  if (!content.name.trim()) issues.push('Name is required.');
  if (!content.lanes.length) issues.push('Add at least one lane.');
  if (new Set(content.lanes.map((lane) => lane.laneType)).size !== content.lanes.length) {
    issues.push('Every lane must use a different lane type.');
  }
  if (content.lanes.some((lane) => !laneTypes.includes(lane.laneType) && !customLanePattern.test(lane.laneType))) {
    issues.push('Custom lane keys are invalid.');
  }
  if (!content.stages.length) issues.push('Add at least one stage.');
  const stageKeys = content.stages.map((stage) => stage.key);
  if (new Set(stageKeys).size !== stageKeys.length || stageKeys.some((key) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(key))) {
    issues.push('Stage keys must be unique lower-kebab-case values.');
  }
  for (const stage of content.stages) {
    if (!stage.name.trim() || !stage.goal.trim()) issues.push('Every stage needs a name and goal.');
    if (stage.cards.some((card) => !card.title.trim())) issues.push('Every template card needs a title.');
    if (stage.cards.some((card) => !content.lanes.some((lane) => lane.laneType === card.laneType))) {
      issues.push('Every card must belong to an available lane.');
    }
    if (stage.cards.some((card) => customLanePattern.test(card.laneType) && card.kind !== 'note')) {
      issues.push('Custom lanes accept note cards only.');
    }
  }
  return [...new Set(issues)];
}

export function JourneyTemplateContentEditor({ value, onChange, disabled = false, idPrefix }: {
  value: JourneyTemplateContent;
  onChange: (next: JourneyTemplateContent) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const changeLane = (index: number, patch: Partial<JourneyTemplateLane>) => {
    const lanes = value.lanes.map((lane, position) => position === index ? { ...lane, ...patch } : lane);
    const previousType = value.lanes[index]?.laneType;
    let stages = value.stages;
    if (patch.laneType && previousType && patch.laneType !== previousType) {
      stages = value.stages.map((stage) => ({
        ...stage,
        cards: stage.cards.map((card) => card.laneType === previousType
          ? { ...card, laneType: patch.laneType!, kind: laneCardKinds[patch.laneType!]?.[0] || 'note' }
          : card)
      }));
    }
    onChange({ ...value, lanes: reindex(lanes), stages });
  };
  const changeStage = (index: number, patch: Partial<JourneyTemplateStage>) => {
    onChange({ ...value, stages: value.stages.map((stage, position) => position === index ? { ...stage, ...patch } : stage) });
  };
  const changeCard = (stageIndex: number, cardIndex: number, patch: Partial<JourneyTemplateCard>) => {
    const stage = value.stages[stageIndex];
    const cards = stage.cards.map((card, position) => position === cardIndex ? { ...card, ...patch } : card);
    changeStage(stageIndex, { cards });
  };

  return <div className="space-y-6" data-testid="journey-template-content-editor">
    <section className="space-y-4" aria-labelledby={`${idPrefix}-details-heading`}>
      <div>
        <h3 id={`${idPrefix}-details-heading`} className="text-sm font-semibold">Template details</h3>
        <p className="mt-1 text-xs text-muted-foreground">These fields are shown in the template gallery and copied into new maps.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor={`${idPrefix}-name`}>Name</Label>
          <Input id={`${idPrefix}-name`} value={value.name} disabled={disabled} maxLength={160}
            onChange={(event) => onChange({ ...value, name: event.target.value })} />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-industry`}>Industry</Label>
          <Input id={`${idPrefix}-industry`} value={value.industry || ''} disabled={disabled} maxLength={160}
            onChange={(event) => onChange({ ...value, industry: event.target.value })} />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-use-case`}>Use case</Label>
          <Input id={`${idPrefix}-use-case`} value={value.useCase || ''} disabled={disabled} maxLength={160}
            onChange={(event) => onChange({ ...value, useCase: event.target.value })} />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-experience-type`}>Experience type</Label>
          <select id={`${idPrefix}-experience-type`} className={selectClassName} value={value.experienceType}
            disabled={disabled} onChange={(event) => onChange({
              ...value, experienceType: event.target.value as JourneyTemplateContent['experienceType']
            })}>
            {experienceTypes.map((type) => <option value={type.value} key={type.value}>{type.label}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-map-type`}>Map type</Label>
          <select id={`${idPrefix}-map-type`} className={selectClassName} value={value.mapType}
            disabled={disabled} onChange={(event) => onChange({
              ...value, mapType: event.target.value as JourneyTemplateContent['mapType']
            })}>
            {mapTypes.map((type) => <option value={type.value} key={type.value}>{type.label}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`${idPrefix}-description`}>Description</Label>
          <Textarea id={`${idPrefix}-description`} value={value.description || ''} disabled={disabled} rows={3}
            maxLength={8000} onChange={(event) => onChange({ ...value, description: event.target.value })} />
        </div>
      </div>
    </section>

    <section className="space-y-3 border-t pt-5" aria-labelledby={`${idPrefix}-lanes-heading`}>
      <div className="flex items-start justify-between gap-3">
        <div><h3 id={`${idPrefix}-lanes-heading`} className="text-sm font-semibold">Lanes</h3>
          <p className="mt-1 text-xs text-muted-foreground">Each lane type may appear once.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline"
            disabled={disabled || value.lanes.length >= 24 || laneTypes.every((type) => value.lanes.some((lane) => lane.laneType === type))}
            onClick={() => {
              const laneType = laneTypes.find((type) => !value.lanes.some((lane) => lane.laneType === type));
              if (!laneType) return;
              onChange({ ...value, lanes: [...value.lanes, {
                laneType, title: laneLabels[laneType] || laneType, description: '', ordinal: value.lanes.length,
                blueprintOnly: ['frontstage', 'backstage', 'supporting_systems', 'policies', 'handoffs'].includes(laneType)
              }] });
            }}><Plus />Add standard lane</Button>
          <Button type="button" size="sm" variant="outline" data-testid={`${idPrefix}-add-custom-lane`}
            disabled={disabled || value.lanes.length >= 24}
            onClick={() => onChange({ ...value, lanes: [...value.lanes, {
              laneType: customLaneKey(), title: 'Custom lane', description: '', ordinal: value.lanes.length,
              blueprintOnly: false
            }] })}><Plus />Add custom lane</Button>
        </div>
      </div>
      <div className="divide-y border">
        {value.lanes.map((lane, index) => {
          const custom = customLanePattern.test(lane.laneType);
          return <div className="grid gap-3 p-3 lg:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)_auto]" key={`${lane.laneType}-${index}`}>
          <div><Label htmlFor={`${idPrefix}-lane-type-${index}`}>{custom ? 'Stable key' : 'Type'}</Label>{custom
            ? <Input id={`${idPrefix}-lane-type-${index}`} value={lane.laneType} disabled aria-readonly="true" />
            : <select id={`${idPrefix}-lane-type-${index}`} className={selectClassName} value={lane.laneType} disabled={disabled}
              onChange={(event) => changeLane(index, {
                laneType: event.target.value,
                title: lane.title === (laneLabels[lane.laneType] || lane.laneType)
                  ? laneLabels[event.target.value] || event.target.value : lane.title
              })}>
              {laneTypes.map((type) => <option value={type} key={type}
                disabled={value.lanes.some((item, position) => position !== index && item.laneType === type)}>
                {laneLabels[type] || type}
              </option>)}
            </select>}</div>
          <div><Label htmlFor={`${idPrefix}-lane-title-${index}`}>Title</Label><Input
            id={`${idPrefix}-lane-title-${index}`} value={lane.title} disabled={disabled} maxLength={160}
            onChange={(event) => changeLane(index, { title: event.target.value })} /></div>
          <div><Label htmlFor={`${idPrefix}-lane-description-${index}`}>Description</Label><Input
            id={`${idPrefix}-lane-description-${index}`} value={lane.description} disabled={disabled} maxLength={8000}
            onChange={(event) => changeLane(index, { description: event.target.value })} /></div>
          <div className="flex items-end gap-1">
            <Button type="button" size="icon" variant="ghost" aria-label={`Move ${lane.title} up`}
              disabled={disabled || index === 0} onClick={() => onChange({ ...value, lanes: reindex(move(value.lanes, index, index - 1)) })}>
              <ArrowUp />
            </Button>
            <Button type="button" size="icon" variant="ghost" aria-label={`Move ${lane.title} down`}
              disabled={disabled || index === value.lanes.length - 1}
              onClick={() => onChange({ ...value, lanes: reindex(move(value.lanes, index, index + 1)) })}>
              <ArrowDown />
            </Button>
            <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${lane.title}`}
              disabled={disabled || value.lanes.length === 1} onClick={() => {
                const lanes = reindex(value.lanes.filter((_, position) => position !== index));
                const fallbackLane = lanes[0]?.laneType;
                onChange({ ...value, lanes, stages: value.stages.map((stage) => ({
                  ...stage,
                  cards: fallbackLane ? stage.cards.map((card) => card.laneType === lane.laneType
                    ? { ...card, laneType: fallbackLane, kind: laneCardKinds[fallbackLane]?.[0] || 'note' } : card) : []
                })) });
              }}><Trash2 /></Button>
          </div>
          <label className="flex items-center gap-2 text-xs lg:col-span-4">
            <input type="checkbox" checked={lane.blueprintOnly} disabled={disabled}
              onChange={(event) => changeLane(index, { blueprintOnly: event.target.checked })} />
            Service-blueprint lane only
          </label>
        </div>;})}
      </div>
    </section>

    <section className="space-y-3 border-t pt-5" aria-labelledby={`${idPrefix}-stages-heading`}>
      <div className="flex items-start justify-between gap-3">
        <div><h3 id={`${idPrefix}-stages-heading`} className="text-sm font-semibold">Stages and cards</h3>
          <p className="mt-1 text-xs text-muted-foreground">Stages become map columns. Cards begin as template hypotheses.</p></div>
        <Button type="button" size="sm" variant="outline" disabled={disabled || value.stages.length >= 24}
          onClick={() => {
            const base = `stage-${value.stages.length + 1}`;
            let key = base; let suffix = 2;
            while (value.stages.some((stage) => stage.key === key)) { key = `${base}-${suffix}`; suffix += 1; }
            onChange({ ...value, stages: [...value.stages, { key, name: `Stage ${value.stages.length + 1}`, goal: '', cards: [] }] });
          }}><Plus />Add stage</Button>
      </div>
      <div className="space-y-3">
        {value.stages.map((stage, stageIndex) => <details className="border"
          key={`${stage.key}-${stageIndex}`}>
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            {stage.name || `Stage ${stageIndex + 1}`} <span className="ml-2 text-xs font-normal text-muted-foreground">{stage.cards.length} cards</span>
          </summary>
          <div className="space-y-4 border-t p-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)_auto]">
              <div><Label htmlFor={`${idPrefix}-stage-name-${stageIndex}`}>Stage name</Label><Input
                id={`${idPrefix}-stage-name-${stageIndex}`} value={stage.name} disabled={disabled} maxLength={160}
                onChange={(event) => {
                  const nextName = event.target.value;
                  changeStage(stageIndex, { name: nextName, key: stage.key.startsWith('stage-') ? slug(nextName) || stage.key : stage.key });
                }} /></div>
              <div><Label htmlFor={`${idPrefix}-stage-key-${stageIndex}`}>Stable key</Label><Input
                id={`${idPrefix}-stage-key-${stageIndex}`} value={stage.key} disabled={disabled} maxLength={80}
                onChange={(event) => changeStage(stageIndex, { key: slug(event.target.value) })} /></div>
              <div><Label htmlFor={`${idPrefix}-stage-goal-${stageIndex}`}>Participant goal</Label><Input
                id={`${idPrefix}-stage-goal-${stageIndex}`} value={stage.goal} disabled={disabled} maxLength={160}
                onChange={(event) => changeStage(stageIndex, { goal: event.target.value })} /></div>
              <div className="flex items-end gap-1">
                <Button type="button" size="icon" variant="ghost" aria-label={`Move ${stage.name} earlier`}
                  disabled={disabled || stageIndex === 0}
                  onClick={() => onChange({ ...value, stages: move(value.stages, stageIndex, stageIndex - 1) })}><ArrowUp /></Button>
                <Button type="button" size="icon" variant="ghost" aria-label={`Move ${stage.name} later`}
                  disabled={disabled || stageIndex === value.stages.length - 1}
                  onClick={() => onChange({ ...value, stages: move(value.stages, stageIndex, stageIndex + 1) })}><ArrowDown /></Button>
                <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${stage.name}`}
                  disabled={disabled || value.stages.length === 1}
                  onClick={() => onChange({ ...value, stages: value.stages.filter((_, position) => position !== stageIndex) })}>
                  <Trash2 />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {stage.cards.map((card, cardIndex) => {
                const supportedKinds = laneCardKinds[card.laneType] || ['note'];
                return <div className="grid gap-2 border p-3 lg:grid-cols-[180px_180px_minmax(0,1fr)_minmax(0,1fr)_auto]"
                  key={`${card.laneType}-${cardIndex}`}>
                  <div><Label htmlFor={`${idPrefix}-card-lane-${stageIndex}-${cardIndex}`}>Lane</Label><select
                    id={`${idPrefix}-card-lane-${stageIndex}-${cardIndex}`} className={selectClassName}
                    value={card.laneType} disabled={disabled} onChange={(event) => {
                      const laneType = event.target.value;
                      changeCard(stageIndex, cardIndex, { laneType, kind: laneCardKinds[laneType]?.[0] || 'note' });
                    }}>
                    {value.lanes.map((lane) => <option value={lane.laneType} key={lane.laneType}>{lane.title}</option>)}
                  </select></div>
                  <div><Label htmlFor={`${idPrefix}-card-kind-${stageIndex}-${cardIndex}`}>Card type</Label><select
                    id={`${idPrefix}-card-kind-${stageIndex}-${cardIndex}`} className={selectClassName}
                    value={card.kind} disabled={disabled}
                    onChange={(event) => changeCard(stageIndex, cardIndex, { kind: event.target.value })}>
                    {supportedKinds.map((kind) => <option value={kind} key={kind}>{cardKindLabels[kind] || kind}</option>)}
                  </select></div>
                  <div><Label htmlFor={`${idPrefix}-card-title-${stageIndex}-${cardIndex}`}>Title</Label><Input
                    id={`${idPrefix}-card-title-${stageIndex}-${cardIndex}`} value={card.title} disabled={disabled}
                    maxLength={160} onChange={(event) => changeCard(stageIndex, cardIndex, { title: event.target.value })} /></div>
                  <div><Label htmlFor={`${idPrefix}-card-content-${stageIndex}-${cardIndex}`}>Content</Label><Input
                    id={`${idPrefix}-card-content-${stageIndex}-${cardIndex}`} value={card.content || ''} disabled={disabled}
                    maxLength={8000} onChange={(event) => changeCard(stageIndex, cardIndex, { content: event.target.value })} /></div>
                  <div className="flex items-end"><Button type="button" size="icon" variant="ghost"
                    aria-label={`Remove ${card.title || 'card'}`} disabled={disabled}
                    onClick={() => changeStage(stageIndex, { cards: stage.cards.filter((_, position) => position !== cardIndex) })}>
                    <Trash2 />
                  </Button></div>
                </div>;
              })}
              <Button type="button" size="sm" variant="outline" disabled={disabled || !value.lanes.length}
                onClick={() => {
                  const laneType = value.lanes[0].laneType;
                  changeStage(stageIndex, { cards: [...stage.cards, {
                    laneType, kind: laneCardKinds[laneType]?.[0] || 'note', title: '', content: ''
                  }] });
                }}><Plus />Add card</Button>
            </div>
          </div>
        </details>)}
      </div>
    </section>
  </div>;
}
