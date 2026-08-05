import {
  memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent,
  type ReactNode, type SyntheticEvent
} from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext, DragOverlay, PointerSensor, useDraggable, useSensor, useSensors,
  type DragEndEvent, type DragMoveEvent, type DragStartEvent
} from '@dnd-kit/core';
import { ArrowLeft, ArrowRight, Eye, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  planJourneyCardDrop, type JourneyCardDropLocation
} from '@/lib/journeyMapEditorSession';
import {
  cardKindLabels, evidenceStateLabels, laneLabels,
  type JourneyMapCard, type JourneyMapLane, type JourneyMapReadModel, type JourneyMapStage
} from '@/lib/journeyMaps';
import { cn } from '@/lib/utils';

type MoveResult = {
  status: 'saved' | 'conflict' | 'failed';
  message?: string;
  authoritativeRevision?: number;
  authoritativeMap?: JourneyMapReadModel;
};
type ArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
type Cell = { stageKey: string; laneType: string };
type DragData = { kind: 'card'; cardId: string; stageKey: string; laneType: string };

export interface JourneyCardSurfaceActions {
  setActiveCell: (cell: Cell) => void;
  focusAdjacentCell: (stageKey: string, laneType: string, key: ArrowKey) => void;
  openCardDraft: (stageKey: string, laneType: string) => void;
  pasteCards: (cell: Cell) => Promise<void>;
  copyCard: (cardId: string) => void;
  toggleCardSelection: (cardId: string, selected?: boolean) => void;
  inspectCard: (card: JourneyMapCard) => void;
  editCard: (card: JourneyMapCard) => void;
  openEvidence: (card: JourneyMapCard) => void;
  deleteCard: (card: JourneyMapCard) => Promise<void>;
  moveCardByKeyboard: (card: JourneyMapCard, key: ArrowKey) => Promise<void>;
  moveCard: (
    card: JourneyMapCard,
    target: { stageKey: string; laneType: string; ordinal: number }
  ) => Promise<MoveResult>;
  moveStage: (stage: JourneyMapStage, toOrdinal: number) => Promise<void>;
  deleteStage: (stage: JourneyMapStage) => Promise<void>;
}

interface SharedProps {
  map: JourneyMapReadModel;
  visibleLanes: JourneyMapLane[];
  editable: boolean;
  mutationLocked: boolean;
  selectedCardIds: ReadonlySet<string>;
  activeCell: Cell | null;
  personasEnabled: boolean;
  evidenceEnabled: boolean;
  cardsPerCell: number;
  renderEvidence?: (card: JourneyMapCard) => ReactNode;
  actions: JourneyCardSurfaceActions;
}

function orderedCards(cards: readonly JourneyMapCard[]) {
  return [...cards].sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id));
}

function cardsByCell(map: JourneyMapReadModel) {
  const result = new Map<string, JourneyMapCard[]>();
  for (const card of map.cards) {
    const key = `${card.stageKey}|${card.laneType}`;
    result.set(key, [...(result.get(key) || []), card]);
  }
  for (const [key, cards] of result) result.set(key, orderedCards(cards));
  return result;
}

function useDesktopSurface() {
  const query = '(min-width: 768px)';
  const [desktop, setDesktop] = useState(() => typeof window === 'undefined' || window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return desktop;
}

function destinationAtPointer(
  point: { x: number; y: number } | null,
  activeCardId: string
): JourneyCardDropLocation | null {
  if (!point) return null;
  let fallbackCell: HTMLElement | null = null;
  for (const element of document.elementsFromPoint(point.x, point.y)) {
    const card = element.closest<HTMLElement>('[data-card-focus]');
    const cell = element.closest<HTMLElement>('[data-cell-focus]');
    if (cell && !fallbackCell) fallbackCell = cell;
    const cardId = card?.dataset.cardFocus;
    if (!cell || !cardId || cardId === activeCardId) continue;
    const [stageKey, laneType] = (cell.dataset.cellFocus || '').split('|');
    if (stageKey && laneType) return { stageKey, laneType, overCardId: cardId };
  }
  if (!fallbackCell) return null;
  const [stageKey, laneType] = (fallbackCell.dataset.cellFocus || '').split('|');
  return stageKey && laneType ? { stageKey, laneType } : null;
}

function locationLabel(map: JourneyMapReadModel, stageKey: string, laneType: string) {
  const stage = map.stages.find((item) => item.stageKey === stageKey)?.name || stageKey;
  const lane = map.lanes.find((item) => item.laneType === laneType);
  return `${stage}, ${lane?.title || laneLabels[laneType] || laneType}`;
}

function ArmedJourneyCardHandle({ card, location, canMutate }: {
  card: JourneyMapCard;
  location: string;
  canMutate: boolean;
}) {
  const binding = useDraggable({
    id: card.id,
    data: {
      kind: 'card', cardId: card.id, stageKey: card.stageKey, laneType: card.laneType
    } satisfies DragData,
    disabled: !canMutate
  });
  return <button
    type="button"
    ref={(node) => { binding.setNodeRef(node); binding.setActivatorNodeRef(node); }}
    {...binding.attributes}
    {...binding.listeners}
    className={cn(
      'hidden h-6 w-6 shrink-0 cursor-grab place-items-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing md:grid',
      binding.isDragging && 'opacity-35'
    )}
    aria-label={`Drag ${card.title} from ${location}`}
    data-testid={`card-drag-${card.id}`}
  ><GripVertical className="h-3.5 w-3.5" /></button>;
}

function StaticJourneyCardHandle({ card, location }: { card: JourneyMapCard; location: string }) {
  return <button
    type="button"
    className="hidden h-6 w-6 shrink-0 cursor-grab place-items-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing md:grid"
    aria-label={`Drag ${card.title} from ${location}`}
    data-testid={`card-drag-${card.id}`}
  ><GripVertical className="h-3.5 w-3.5" /></button>;
}

function FocusedPointerJourneyCardHandle({ card, location, canMutate, onStart, onMove, onEnd, onCancel }: {
  card: JourneyMapCard;
  location: string;
  canMutate: boolean;
  onStart: (card: JourneyMapCard) => void;
  onMove: (card: JourneyMapCard, point: { x: number; y: number }) => void;
  onEnd: (card: JourneyMapCard, point: { x: number; y: number }) => Promise<void>;
  onCancel: (card: JourneyMapCard) => void;
}) {
  const gesture = useRef<{ pointerId: number; x: number; y: number; active: boolean } | null>(null);
  const point = (event: ReactPointerEvent<HTMLButtonElement>) => ({ x: event.clientX, y: event.clientY });
  return <button
    type="button"
    className="hidden h-6 w-6 shrink-0 cursor-grab place-items-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing md:grid"
    aria-label={`Drag ${card.title} from ${location}`}
    data-testid={`card-drag-${card.id}`}
    style={{ touchAction: 'none' }}
    onPointerDown={(event) => {
      if (!canMutate || event.button !== 0) return;
      gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, active: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 7) return;
      if (!current.active) {
        current.active = true;
        onStart(card);
      }
      event.preventDefault();
      onMove(card, point(event));
    }}
    onPointerUp={(event) => {
      const current = gesture.current;
      gesture.current = null;
      if (!current || current.pointerId !== event.pointerId) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (current.active) {
        event.preventDefault();
        const releasedAt = point(event);
        window.setTimeout(() => { void onEnd(card, releasedAt); }, 0);
      }
    }}
    onPointerCancel={(event) => {
      const current = gesture.current;
      gesture.current = null;
      if (current?.active) onCancel(card);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
  ><GripVertical className="h-3.5 w-3.5" /></button>;
}

function JourneyCardMarkup({ card, location, personaName, canMutate, selected, personasEnabled, evidenceEnabled,
  renderEvidence, actions, armed, onArm }: {
  card: JourneyMapCard;
  location: string;
  personaName: string | null;
  canMutate: boolean;
  selected: boolean;
  personasEnabled: boolean;
  evidenceEnabled: boolean;
  renderEvidence?: (card: JourneyMapCard) => ReactNode;
  actions: JourneyCardSurfaceActions;
  armed: boolean;
  onArm: (cardId: string) => void;
}) {
  return <li
    style={{ contentVisibility: 'auto', containIntrinsicSize: '140px' }}
    className={cn(
      'border bg-background p-2 outline-none focus-visible:ring-2 focus-visible:ring-ring',
      selected && 'border-foreground'
    )}
    tabIndex={0}
    data-card-focus={card.id}
    data-testid={`journey-card-${card.id}`}
    aria-label={`${card.title}. ${cardKindLabels[card.kind] || card.kind}. Press Enter to inspect; Alt plus an arrow key moves the card.`}
    onPointerEnter={() => { if (canMutate) onArm(card.id); }}
    onFocus={() => {
      actions.setActiveCell({ stageKey: card.stageKey, laneType: card.laneType });
      if (canMutate) onArm(card.id);
    }}
    onKeyDown={(event) => {
      if (event.currentTarget !== event.target) return;
      if (event.key === 'Enter') {
        event.preventDefault(); actions.inspectCard(card);
      } else if (canMutate && event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); void actions.moveCardByKeyboard(card, event.key as ArrowKey);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        event.preventDefault(); actions.copyCard(card.id);
      } else if (canMutate && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        event.preventDefault(); void actions.pasteCards({ stageKey: card.stageKey, laneType: card.laneType });
      } else if (event.key === ' ') {
        event.preventDefault(); actions.toggleCardSelection(card.id);
      } else if (canMutate && event.key.toLowerCase() === 'n') {
        event.preventDefault(); actions.openCardDraft(card.stageKey, card.laneType);
      }
    }}
  >
    <div className="flex items-start gap-2">
      {canMutate && <span data-journey-drag-slot={card.id}>
        {!armed && <StaticJourneyCardHandle card={card} location={location} />}
      </span>}
      {canMutate && <input
        type="checkbox"
        className="mt-0.5 h-3.5 w-3.5"
        checked={selected}
        aria-label={`Select card ${card.title}`}
        data-testid={`card-select-${card.id}`}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => actions.toggleCardSelection(card.id, event.target.checked)}
      />}
      <p className="min-w-0 flex-1 text-xs font-medium leading-4">{card.title}</p>
    </div>
    {card.content && <p className="mt-0.5 line-clamp-3 text-[11px] text-muted-foreground">{card.content}</p>}
    <p className="mt-0.5 text-[11px] text-muted-foreground">
      {cardKindLabels[card.kind] || card.kind}
      {personasEnabled && card.personaId && ` · ${personaName || 'Persona-specific'}`}
    </p>
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {evidenceEnabled && renderEvidence?.(card)}
      <Button type="button" variant="ghost" size="sm" className="h-6 px-1 text-[11px]"
        aria-label={`Inspect card ${card.title}`} data-testid={`card-inspect-${card.id}`}
        onClick={() => actions.inspectCard(card)}><Eye className="mr-1 h-3 w-3" />Inspect</Button>
      <Button type="button" variant="ghost" size="sm" className="h-6 px-1 text-[11px]"
        disabled={!canMutate} aria-label={`Edit card ${card.title}`} data-testid={`card-edit-${card.id}`}
        onClick={() => actions.editCard(card)}><Pencil className="mr-1 h-3 w-3" />Edit</Button>
      {evidenceEnabled && <Button type="button" variant="ghost" size="sm" className="h-6 px-1 text-[11px]"
        data-testid={`card-evidence-open-${card.id}`} onClick={() => actions.openEvidence(card)}>Evidence</Button>}
      <Button type="button" variant="ghost" size="sm" className="h-6 px-1" disabled={!canMutate}
        aria-label={`Move card ${card.title} to the previous stage`} data-testid={`card-move-left-${card.id}`}
        onClick={() => void actions.moveCardByKeyboard(card, 'ArrowLeft')}><ArrowLeft className="h-3 w-3" /></Button>
      <Button type="button" variant="ghost" size="sm" className="h-6 px-1" disabled={!canMutate}
        aria-label={`Move card ${card.title} to the next stage`} data-testid={`card-move-right-${card.id}`}
        onClick={() => void actions.moveCardByKeyboard(card, 'ArrowRight')}><ArrowRight className="h-3 w-3" /></Button>
      <Button type="button" variant="ghost" size="sm" className="h-6 px-1" disabled={!canMutate}
        aria-label={`Delete card ${card.title}`} data-testid={`card-delete-${card.id}`}
        onClick={() => void actions.deleteCard(card)}><Trash2 className="h-3 w-3" /></Button>
    </div>
  </li>;
}

function JourneyCard(props: Parameters<typeof JourneyCardMarkup>[0]) {
  return <JourneyCardMarkup {...props} />;
}

interface JourneyCellProps {
  stageKey: string;
  stageName: string;
  laneType: string;
  laneTitle: string;
  cards: JourneyMapCard[];
  canMutate: boolean;
  cellActive: boolean;
  editable: boolean;
  selectedCardIds: ReadonlySet<string>;
  personaNames: ReadonlyMap<string, string>;
  personasEnabled: boolean;
  evidenceEnabled: boolean;
  renderEvidence?: (card: JourneyMapCard) => ReactNode;
  actions: JourneyCardSurfaceActions;
  armedCardId: string;
  onArm: (cardId: string) => void;
}

function sameCard(left: JourneyMapCard, right: JourneyMapCard) {
  return left.id === right.id && left.stageKey === right.stageKey && left.laneType === right.laneType
    && left.kind === right.kind && left.title === right.title && left.content === right.content
    && left.ordinal === right.ordinal && left.personaId === right.personaId && left.status === right.status
    && left.origin === right.origin && left.evidenceLinkCount === right.evidenceLinkCount
    && left.evidence.state === right.evidence.state && left.evidence.supporting === right.evidence.supporting
    && left.evidence.contradicting === right.evidence.contradicting && left.evidence.neutral === right.evidence.neutral
    && left.evidence.stale === right.evidence.stale && left.evidence.inaccessible === right.evidence.inaccessible
    && left.evidence.reason === right.evidence.reason;
}

function sameJourneyCell(left: JourneyCellProps, right: JourneyCellProps) {
  if (left.stageKey !== right.stageKey || left.stageName !== right.stageName || left.laneType !== right.laneType
    || left.laneTitle !== right.laneTitle || left.canMutate !== right.canMutate || left.cellActive !== right.cellActive
    || left.editable !== right.editable
    || left.personasEnabled !== right.personasEnabled || left.evidenceEnabled !== right.evidenceEnabled
    || left.actions !== right.actions || left.onArm !== right.onArm || left.renderEvidence !== right.renderEvidence
    || left.cards.length !== right.cards.length) return false;
  for (let index = 0; index < left.cards.length; index += 1) {
    if (!sameCard(left.cards[index], right.cards[index])) return false;
    const cardId = left.cards[index].id;
    if (left.selectedCardIds.has(cardId) !== right.selectedCardIds.has(cardId)) return false;
    const personaId = right.cards[index].personaId;
    if (personaId && left.personaNames.get(personaId) !== right.personaNames.get(personaId)) return false;
  }
  const leftArmedHere = left.cards.some((card) => card.id === left.armedCardId);
  const rightArmedHere = right.cards.some((card) => card.id === right.armedCardId);
  return leftArmedHere === rightArmedHere
    && (!leftArmedHere || left.armedCardId === right.armedCardId);
}

const JourneyCell = memo(function JourneyCell({ stageKey, stageName, laneType, laneTitle, cards, canMutate,
  cellActive, editable, selectedCardIds, personaNames, personasEnabled, evidenceEnabled,
  renderEvidence, actions, armedCardId, onArm }: JourneyCellProps) {
  const label = `${stageName}, ${laneTitle}`;
  return <td
    className="border-b border-r p-2 align-top outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    data-testid={`cell-${stageKey}-${laneType}`}
    data-cell-focus={`${stageKey}|${laneType}`}
    tabIndex={cellActive ? 0 : -1}
    aria-label={`${label}. ${cards.length} cards. Press Enter or N to add a card.`}
    onFocus={() => actions.setActiveCell({ stageKey, laneType })}
    onKeyDown={(event) => {
      if (event.currentTarget !== event.target) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        actions.focusAdjacentCell(stageKey, laneType, event.key as ArrowKey);
      } else if (canMutate && (event.key === 'Enter' || event.key.toLowerCase() === 'n')) {
        event.preventDefault(); actions.openCardDraft(stageKey, laneType);
      } else if (canMutate && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        event.preventDefault(); void actions.pasteCards({ stageKey, laneType });
      }
    }}
  >
    <ul className="min-h-7 space-y-1.5">
        {cards.map((card) => <JourneyCard
          key={card.id}
          card={card}
          location={label}
          personaName={card.personaId ? personaNames.get(card.personaId) || null : null}
          canMutate={canMutate}
          selected={selectedCardIds.has(card.id)}
          personasEnabled={personasEnabled}
          evidenceEnabled={evidenceEnabled}
          renderEvidence={renderEvidence}
          actions={actions}
          armed={armedCardId === card.id}
          onArm={onArm}
        />)}
    </ul>
    {editable && <Button type="button" variant="ghost" size="sm"
      className="mt-1 h-7 w-full justify-start px-1 text-[11px]"
      data-testid={`add-card-${stageKey}-${laneType}`}
      onClick={() => actions.openCardDraft(stageKey, laneType)}>
      <Plus className="mr-1 h-3 w-3" />Add card
    </Button>}
  </td>;
}, sameJourneyCell);

function MobileJourneyCards({ props, cells, announcement, setAnnouncement }: {
  props: SharedProps;
  cells: Map<string, JourneyMapCard[]>;
  announcement: string;
  setAnnouncement: (message: string) => void;
}) {
  const canMutate = props.editable && !props.mutationLocked;
  const [moveCardId, setMoveCardId] = useState('');
  const [stageKey, setStageKey] = useState('');
  const [laneType, setLaneType] = useState('');
  const [overCardId, setOverCardId] = useState('');
  const selected = props.map.cards.find((card) => card.id === moveCardId) || null;
  const destinationCards = selected && stageKey && laneType
    ? (cells.get(`${stageKey}|${laneType}`) || []).filter((card) => card.id !== selected.id)
    : [];

  function openMove(card: JourneyMapCard) {
    setMoveCardId(card.id); setStageKey(card.stageKey); setLaneType(card.laneType); setOverCardId('');
  }

  async function move() {
    if (!selected || !stageKey || !laneType || props.mutationLocked) return;
    const plan = planJourneyCardDrop(props.map, selected.id, {
      stageKey, laneType, overCardId: overCardId || undefined
    }, props.cardsPerCell);
    if (plan.error) { setAnnouncement(`Could not move ${selected.title}. ${plan.error}`); return; }
    if (!plan.target) { setAnnouncement(`${selected.title} is already in that position.`); setMoveCardId(''); return; }
    setAnnouncement(`Saving ${selected.title} to ${locationLabel(props.map, stageKey, laneType)}, position ${plan.position}.`);
    const result = await props.actions.moveCard(selected, plan.target);
    if (result.status === 'saved') {
      setAnnouncement(`Moved ${selected.title} to ${locationLabel(props.map, stageKey, laneType)}, position ${plan.position} of ${plan.total}.`);
      setMoveCardId('');
    } else {
      setAnnouncement(result.message || `Could not move ${selected.title}. Its authoritative position has been restored.`);
    }
  }

  return <div data-testid="journey-mobile-card-list" className="space-y-4">
    <p className="border px-3 py-2 text-xs leading-5 text-muted-foreground">
      Dragging is available on larger screens. On this screen, use each card's Move action or Alt plus an arrow key with a keyboard.
    </p>
    {moveCardId && selected && <div className="border p-3" data-testid={`mobile-move-panel-${selected.id}`}>
      <p className="text-sm font-medium">Move {selected.title}</p>
      <div className="mt-3 grid gap-3">
        <label className="text-xs">Stage
          <select className="mt-1 h-9 w-full border px-2 text-sm" value={stageKey}
            data-testid="mobile-move-stage" onChange={(event) => {
              setStageKey(event.target.value); setOverCardId('');
            }}>
            {props.map.stages.map((stage) => <option key={stage.id} value={stage.stageKey}>{stage.name}</option>)}
          </select>
        </label>
        <label className="text-xs">Lane
          <select className="mt-1 h-9 w-full border px-2 text-sm" value={laneType}
            data-testid="mobile-move-lane" onChange={(event) => {
              setLaneType(event.target.value); setOverCardId('');
            }}>
            {props.visibleLanes.map((lane) => <option key={lane.id} value={lane.laneType}>
              {lane.title || laneLabels[lane.laneType] || lane.laneType}
            </option>)}
          </select>
        </label>
        <label className="text-xs">Position
          <select className="mt-1 h-9 w-full border px-2 text-sm" value={overCardId}
            data-testid="mobile-move-position" onChange={(event) => setOverCardId(event.target.value)}>
            <option value="">At end</option>
            {destinationCards.map((card, index) => <option key={card.id} value={card.id}>Position {index + 1}, before {card.title}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <Button type="button" size="sm" disabled={props.mutationLocked} data-testid="mobile-move-submit"
          onClick={() => void move()}>Move card</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setMoveCardId('')}>Cancel</Button>
      </div>
    </div>}
    {props.map.stages.map((stage) => <section key={stage.id} className="border" aria-labelledby={`mobile-stage-${stage.id}`}>
      <div className="border-b bg-muted/30 px-3 py-2"><h3 id={`mobile-stage-${stage.id}`} className="text-sm font-semibold">{stage.name}</h3></div>
      <div className="divide-y">{props.visibleLanes.map((lane) => {
        const cards = cells.get(`${stage.stageKey}|${lane.laneType}`) || [];
        return <section key={lane.id} className="p-3" data-testid={`cell-${stage.stageKey}-${lane.laneType}`}>
          <h4 className="text-xs font-medium text-muted-foreground">{lane.title || laneLabels[lane.laneType] || lane.laneType}</h4>
          {cards.length ? <ul className="mt-2 space-y-2">{cards.map((card) => <li key={card.id}
            className="border p-2 outline-none focus-visible:ring-2 focus-visible:ring-ring" tabIndex={0}
            data-card-focus={card.id} data-testid={`mobile-card-${card.id}`}
            aria-label={`${card.title}. Press Enter to inspect; Alt plus an arrow key moves the card.`}
            onFocus={() => props.actions.setActiveCell({ stageKey: card.stageKey, laneType: card.laneType })}
            onKeyDown={(event) => {
              if (event.currentTarget !== event.target) return;
              if (event.key === 'Enter') { event.preventDefault(); props.actions.inspectCard(card); }
              else if (canMutate && event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                event.preventDefault(); void props.actions.moveCardByKeyboard(card, event.key as ArrowKey);
              } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
                event.preventDefault(); props.actions.copyCard(card.id);
              } else if (canMutate && event.key === ' ') {
                event.preventDefault(); props.actions.toggleCardSelection(card.id);
              }
            }}>
            <div className="flex items-start gap-2">
              {props.editable && <input type="checkbox" className="mt-0.5 h-4 w-4" disabled={props.mutationLocked}
                checked={props.selectedCardIds.has(card.id)} aria-label={`Select card ${card.title}`}
                data-testid={`card-select-${card.id}`}
                onChange={(event) => props.actions.toggleCardSelection(card.id, event.target.checked)} />}
              <p className="min-w-0 flex-1 text-sm font-medium">{card.title}</p>
            </div>
            {card.content && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{card.content}</p>}
            <p className="mt-0.5 text-xs text-muted-foreground">{cardKindLabels[card.kind] || card.kind}
              {props.personasEnabled && card.personaId && ` · ${props.map.personas.find((persona) => persona.id === card.personaId)?.name || 'Persona-specific'}`}
            </p>
            {props.evidenceEnabled && props.renderEvidence && <div className="mt-2">{props.renderEvidence(card)}</div>}
            <div className="mt-2 flex flex-wrap gap-1">
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs"
                onClick={() => props.actions.inspectCard(card)}>Inspect</Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs"
                onClick={() => props.actions.copyCard(card.id)}>Copy</Button>
              {props.editable && <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs"
                disabled={props.mutationLocked} onClick={() => props.actions.editCard(card)}>Edit</Button>}
              {props.evidenceEnabled && <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs"
                onClick={() => props.actions.openEvidence(card)}>Evidence</Button>}
              {props.editable && <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs"
                disabled={props.mutationLocked} data-testid={`mobile-move-card-${card.id}`}
                onClick={() => openMove(card)}>Move</Button>}
              {props.editable && <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs"
                disabled={props.mutationLocked} onClick={() => void props.actions.deleteCard(card)}>Delete</Button>}
            </div>
          </li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">No cards</p>}
          {props.editable && <Button type="button" variant="ghost" size="sm" className="mt-2 h-7 px-1 text-xs"
            disabled={props.mutationLocked} data-testid={`add-card-${stage.stageKey}-${lane.laneType}`}
            onClick={() => props.actions.openCardDraft(stage.stageKey, lane.laneType)}><Plus className="mr-1 h-3 w-3" />Add card</Button>}
        </section>;
      })}</div>
    </section>)}
    <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</p>
  </div>;
}

interface JourneyGridTableProps {
  map: JourneyMapReadModel;
  visibleLanes: JourneyMapLane[];
  cells: Map<string, JourneyMapCard[]>;
  canEdit: boolean;
  activeCell: Cell | null;
  selectedCardIds: ReadonlySet<string>;
  personaNames: ReadonlyMap<string, string>;
  personasEnabled: boolean;
  evidenceEnabled: boolean;
  renderEvidence: (card: JourneyMapCard) => ReactNode;
  actions: JourneyCardSurfaceActions;
  armedCardId: string;
  onArm: (cardId: string) => void;
}

const JourneyGridHeader = memo(function JourneyGridHeader({ stages, canEdit, actions }: {
  stages: JourneyMapStage[];
  canEdit: boolean;
  actions: JourneyCardSurfaceActions;
}) {
  return <thead><tr>
    <th scope="col" className="w-44 border-b border-r bg-muted/40 p-2 text-left text-xs font-semibold">Lane</th>
    {stages.map((stage, stageIndex) => <th key={stage.id} scope="col"
        className="w-56 border-b border-r bg-muted/40 p-2 text-left align-top"
        data-testid={`stage-header-${stage.stageKey}`}>
        <span className="block text-xs font-semibold">{stage.name}</span>
        {stage.goal && <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">{stage.goal}</span>}
        <span className="mt-1 flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" className="h-6 px-1"
            disabled={!canEdit || stageIndex === 0} aria-label={`Move stage ${stage.name} earlier`}
            data-testid={`stage-move-left-${stage.stageKey}`}
            onClick={() => void actions.moveStage(stage, stageIndex - 1)}><ArrowLeft className="h-3.5 w-3.5" /></Button>
          <Button type="button" variant="ghost" size="sm" className="h-6 px-1"
            disabled={!canEdit || stageIndex === stages.length - 1} aria-label={`Move stage ${stage.name} later`}
            data-testid={`stage-move-right-${stage.stageKey}`}
            onClick={() => void actions.moveStage(stage, stageIndex + 1)}><ArrowRight className="h-3.5 w-3.5" /></Button>
          <Button type="button" variant="ghost" size="sm" className="h-6 px-1" disabled={!canEdit}
            aria-label={`Delete stage ${stage.name}`} data-testid={`stage-delete-${stage.stageKey}`}
            onClick={() => void actions.deleteStage(stage)}><Trash2 className="h-3.5 w-3.5" /></Button>
        </span>
      </th>)}
  </tr></thead>;
});

interface JourneyGridLaneRowProps {
  lane: JourneyMapLane;
  stages: JourneyMapStage[];
  cells: Map<string, JourneyMapCard[]>;
  canEdit: boolean;
  activeCell: Cell | null;
  firstLaneId: string | undefined;
  selectedCardIds: ReadonlySet<string>;
  personaNames: ReadonlyMap<string, string>;
  personasEnabled: boolean;
  evidenceEnabled: boolean;
  renderEvidence: (card: JourneyMapCard) => ReactNode;
  actions: JourneyCardSurfaceActions;
  armedCardId: string;
  onArm: (cardId: string) => void;
}

function sameCell(left: Cell | null, right: Cell | null) {
  return left === right || (left?.stageKey === right?.stageKey && left?.laneType === right?.laneType);
}

function sameJourneyGridLaneRow(left: JourneyGridLaneRowProps, right: JourneyGridLaneRowProps) {
  if (left.lane.id !== right.lane.id || left.lane.laneType !== right.lane.laneType
    || left.lane.title !== right.lane.title || left.lane.description !== right.lane.description
    || left.lane.ordinal !== right.lane.ordinal || left.lane.visible !== right.lane.visible
    || left.stages !== right.stages || left.canEdit !== right.canEdit || left.firstLaneId !== right.firstLaneId
    || !sameCell(left.activeCell, right.activeCell) || left.personasEnabled !== right.personasEnabled
    || left.evidenceEnabled !== right.evidenceEnabled || left.renderEvidence !== right.renderEvidence
    || left.actions !== right.actions || left.onArm !== right.onArm) return false;
  let leftArmedHere = false;
  let rightArmedHere = false;
  for (const stage of left.stages) {
    const key = `${stage.stageKey}|${left.lane.laneType}`;
    const leftCards = left.cells.get(key) || [];
    const rightCards = right.cells.get(key) || [];
    if (leftCards.length !== rightCards.length) return false;
    for (let index = 0; index < leftCards.length; index += 1) {
      const leftCard = leftCards[index];
      const rightCard = rightCards[index];
      if (!sameCard(leftCard, rightCard)
        || left.selectedCardIds.has(leftCard.id) !== right.selectedCardIds.has(rightCard.id)
        || (leftCard.personaId
          && left.personaNames.get(leftCard.personaId) !== right.personaNames.get(rightCard.personaId || ''))) return false;
      if (leftCard.id === left.armedCardId) leftArmedHere = true;
      if (rightCard.id === right.armedCardId) rightArmedHere = true;
    }
  }
  return leftArmedHere === rightArmedHere
    && (!leftArmedHere || left.armedCardId === right.armedCardId);
}

const JourneyGridLaneRow = memo(function JourneyGridLaneRow({ lane, stages, cells, canEdit, activeCell,
  firstLaneId, selectedCardIds, personaNames, personasEnabled, evidenceEnabled, renderEvidence, actions,
  armedCardId, onArm }: JourneyGridLaneRowProps) {
  const laneTitle = lane.title || laneLabels[lane.laneType] || lane.laneType;
  return <tr>
    <th scope="row" className="border-b border-r bg-muted/20 p-2 text-left align-top text-xs font-medium">
      {laneTitle}
    </th>
    {stages.map((stage) => <JourneyCell
        key={`${lane.id}-${stage.id}`}
        stageKey={stage.stageKey}
        stageName={stage.name}
        laneType={lane.laneType}
        laneTitle={laneTitle}
        cards={cells.get(`${stage.stageKey}|${lane.laneType}`) || []}
        canMutate={canEdit}
        cellActive={activeCell
          ? activeCell.stageKey === stage.stageKey && activeCell.laneType === lane.laneType
          : stage.id === stages[0]?.id && lane.id === firstLaneId}
        editable={canEdit}
        selectedCardIds={selectedCardIds}
        personaNames={personaNames}
        personasEnabled={personasEnabled}
        evidenceEnabled={evidenceEnabled}
        renderEvidence={renderEvidence}
        actions={actions}
        armedCardId={armedCardId}
        onArm={onArm}
      />)}
  </tr>;
}, sameJourneyGridLaneRow);

const JourneyGridTable = memo(function JourneyGridTable({ map, visibleLanes, cells, canEdit, activeCell,
  selectedCardIds, personaNames, personasEnabled, evidenceEnabled, renderEvidence, actions, armedCardId,
  onArm }: JourneyGridTableProps) {
  return <table className="w-full table-fixed border-collapse text-sm"
    style={{ minWidth: `${176 + map.stages.length * 224}px` }}>
    <caption className="sr-only">
      Journey map grid. Stages are columns and lanes are rows. Drag handles move cards; keyboard and button alternatives provide the same action.
    </caption>
    <JourneyGridHeader stages={map.stages} canEdit={canEdit} actions={actions} />
    <tbody>{visibleLanes.map((lane) => <JourneyGridLaneRow key={lane.id}
      lane={lane} stages={map.stages} cells={cells} canEdit={canEdit} activeCell={activeCell}
      firstLaneId={visibleLanes[0]?.id} selectedCardIds={selectedCardIds} personaNames={personaNames}
      personasEnabled={personasEnabled} evidenceEnabled={evidenceEnabled} renderEvidence={renderEvidence}
      actions={actions} armedCardId={armedCardId} onArm={onArm} />)}</tbody>
  </table>;
});

function JourneyGridDropRegion({ revision, renderedRevision, mutationLocked, children }: {
  revision: number;
  renderedRevision: number;
  mutationLocked: boolean;
  children: ReactNode;
}) {
  const stopRequestLockedInteraction = (event: SyntheticEvent) => {
    if (mutationLocked || event.currentTarget instanceof HTMLElement
      && event.currentTarget.dataset.requestLocked === 'true') {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  return <div className="overflow-x-auto border" data-testid="journey-grid"
    data-map-revision={revision} data-rendered-map-revision={renderedRevision}
    data-mutation-locked={mutationLocked ? 'true' : 'false'}
    aria-busy={mutationLocked ? 'true' : undefined} aria-disabled={mutationLocked ? 'true' : undefined}
    inert={mutationLocked ? true : undefined}
    onClickCapture={stopRequestLockedInteraction} onPointerDownCapture={stopRequestLockedInteraction}
    onKeyDownCapture={stopRequestLockedInteraction}>
    <fieldset className="contents" disabled={mutationLocked}>{children}</fieldset>
  </div>;
}

function useStableSurfaceActions(actions: JourneyCardSurfaceActions) {
  const latest = useRef(actions);
  latest.current = actions;
  const stable = useRef<JourneyCardSurfaceActions | null>(null);
  if (!stable.current) stable.current = {
    setActiveCell: (cell) => latest.current.setActiveCell(cell),
    focusAdjacentCell: (stageKey, laneType, key) => latest.current.focusAdjacentCell(stageKey, laneType, key),
    openCardDraft: (stageKey, laneType) => latest.current.openCardDraft(stageKey, laneType),
    pasteCards: (cell) => latest.current.pasteCards(cell),
    copyCard: (cardId) => latest.current.copyCard(cardId),
    toggleCardSelection: (cardId, selected) => latest.current.toggleCardSelection(cardId, selected),
    inspectCard: (card) => latest.current.inspectCard(card),
    editCard: (card) => latest.current.editCard(card),
    openEvidence: (card) => latest.current.openEvidence(card),
    deleteCard: (card) => latest.current.deleteCard(card),
    moveCardByKeyboard: (card, key) => latest.current.moveCardByKeyboard(card, key),
    moveCard: (card, target) => latest.current.moveCard(card, target),
    moveStage: (stage, ordinal) => latest.current.moveStage(stage, ordinal),
    deleteStage: (stage) => latest.current.deleteStage(stage)
  };
  return stable.current;
}

export function JourneyCardGrid(props: SharedProps) {
  const desktop = useDesktopSurface();
  const [localAuthoritativeMap, setLocalAuthoritativeMap] = useState<JourneyMapReadModel | null>(null);
  const map = localAuthoritativeMap
    && localAuthoritativeMap.definition.id === props.map.definition.id
    && localAuthoritativeMap.definition.revision >= props.map.definition.revision
    ? localAuthoritativeMap : props.map;
  const cells = useMemo(() => cardsByCell(map), [map]);
  const personaNames = useMemo(() => new Map(map.personas.map((persona) => [persona.id, persona.name])), [map.personas]);
  const actions = useStableSurfaceActions(props.actions);
  const latestRenderEvidence = useRef(props.renderEvidence);
  latestRenderEvidence.current = props.renderEvidence;
  const renderEvidence = useCallback((card: JourneyMapCard) => latestRenderEvidence.current?.(card), []);
  const pointerPosition = useRef<{ x: number; y: number } | null>(null);
  const [armedCardId, setArmedCardId] = useState('');
  const [activeCardId, setActiveCardId] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const announcementRef = useRef<HTMLParagraphElement | null>(null);
  const authoritativeAnnouncementRef = useRef<string | null>(null);
  const authoritativeRevisionRef = useRef<number | null>(null);
  const focusedOverlayRef = useRef<HTMLDivElement | null>(null);
  const focusedOverlayTitleRef = useRef<HTMLSpanElement | null>(null);
  const canEdit = props.editable;
  const canMutate = props.editable && !props.mutationLocked;
  const useFocusedPointer = map.stages.length * props.visibleLanes.length >= 500;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 7 } }));
  const activeCard = map.cards.find((card) => card.id === activeCardId) || null;
  const armedCard = map.cards.find((card) => card.id === armedCardId) || null;
  const armedSlot = armedCardId
    ? document.querySelector<HTMLElement>(`[data-journey-drag-slot="${CSS.escape(armedCardId)}"]`)
    : null;
  const activeCardIdRef = useRef(activeCardId);
  activeCardIdRef.current = activeCardId;
  const armCard = useCallback((cardId: string) => {
    if (!activeCardIdRef.current) setArmedCardId(cardId);
  }, []);

  useEffect(() => {
    const recordPointer = (event: PointerEvent) => { pointerPosition.current = { x: event.clientX, y: event.clientY }; };
    document.addEventListener('pointerdown', recordPointer, true);
    document.addEventListener('pointermove', recordPointer, true);
    return () => {
      document.removeEventListener('pointerdown', recordPointer, true);
      document.removeEventListener('pointermove', recordPointer, true);
    };
  }, []);

  useEffect(() => {
    if (armedCardId && !map.cards.some((card) => card.id === armedCardId)) setArmedCardId('');
  }, [armedCardId, map.cards]);

  function beginCardDrag(card: JourneyMapCard) {
    if (!canMutate) return;
    setActiveCardId(card.id);
    setAnnouncement(`Picked up ${card.title} from ${locationLabel(map, card.stageKey, card.laneType)}, position ${card.ordinal + 1}.`);
  }

  function announceCardDrag(card: JourneyMapCard, render = true) {
    const destination = destinationAtPointer(pointerPosition.current, card.id);
    if (!destination) return;
    const plan = planJourneyCardDrop(map, card.id, destination, props.cardsPerCell);
    const message = plan.error
      ? `Cannot move ${card.title} to ${locationLabel(map, destination.stageKey, destination.laneType)}. ${plan.error}`
      : `Move ${card.title} to ${locationLabel(map, destination.stageKey, destination.laneType)}, position ${plan.position} of ${plan.total}.`;
    if (render) setAnnouncement(message);
    else if (announcementRef.current) announcementRef.current.textContent = message;
  }

  async function completeCardDrag(cardId: string) {
    const card = map.cards.find((item) => item.id === cardId);
    const destination = destinationAtPointer(pointerPosition.current, cardId);
    if (!card || !destination) {
      setActiveCardId('');
      setAnnouncement(card ? `${card.title} was not moved.` : 'The card was not moved.');
      return;
    }
    if (!canMutate) {
      setActiveCardId('');
      setAnnouncement(`${card.title} was not moved because editing is unavailable.`);
      return;
    }
    const plan = planJourneyCardDrop(map, card.id, destination, props.cardsPerCell);
    if (plan.error) {
      setActiveCardId(''); setAnnouncement(`Could not move ${card.title}. ${plan.error}`); return;
    }
    if (!plan.target) {
      setActiveCardId(''); setAnnouncement(`${card.title} is already in that position.`); return;
    }
    const label = locationLabel(map, destination.stageKey, destination.laneType);
    if (announcementRef.current) {
      announcementRef.current.textContent = `Saving ${card.title} to ${label}, position ${plan.position}.`;
    }
    const result = await actions.moveCard(card, plan.target);
    const finalMessage = result.status === 'saved'
      ? `Moved ${card.title} to ${label}, position ${plan.position} of ${plan.total}.`
      : result.message || `Could not move ${card.title}. Its authoritative position has been restored.`;
    if (result.status === 'saved' && result.authoritativeMap) {
      authoritativeRevisionRef.current = result.authoritativeMap.definition.revision;
      authoritativeAnnouncementRef.current = finalMessage;
      const grid = document.querySelector<HTMLElement>('[data-testid="journey-grid"]');
      if (grid) grid.dataset.mapRevision = String(result.authoritativeMap.definition.revision);
      if (announcementRef.current) announcementRef.current.textContent = finalMessage;
      const authoritativeMap = result.authoritativeMap;
      window.setTimeout(() => {
        authoritativeRevisionRef.current = null;
        authoritativeAnnouncementRef.current = null;
        setLocalAuthoritativeMap(authoritativeMap);
        setActiveCardId('');
        setAnnouncement(finalMessage);
      }, 0);
      return;
    }
    setActiveCardId('');
    setAnnouncement(finalMessage);
  }

  const displayedProps = map === props.map ? props : { ...props, map };
  if (!desktop) return <MobileJourneyCards props={displayedProps} cells={cells}
    announcement={announcement} setAnnouncement={setAnnouncement} />;

  return <>
    <JourneyGridDropRegion revision={authoritativeRevisionRef.current ?? map.definition.revision}
      renderedRevision={map.definition.revision}
      mutationLocked={props.mutationLocked}>
      <JourneyGridTable map={map} visibleLanes={props.visibleLanes} cells={cells} canEdit={canEdit}
        activeCell={props.activeCell} selectedCardIds={props.selectedCardIds} personaNames={personaNames}
        personasEnabled={props.personasEnabled} evidenceEnabled={props.evidenceEnabled}
        renderEvidence={renderEvidence} actions={actions} armedCardId={armedCardId} onArm={armCard} />
    </JourneyGridDropRegion>
    <p ref={announcementRef} role="status" aria-live="polite" aria-atomic="true" data-testid="journey-drag-status"
      className={cn('mt-2 min-h-5 text-xs text-muted-foreground', !announcement && 'sr-only')}>
      {authoritativeAnnouncementRef.current ?? announcement}
    </p>
    {useFocusedPointer && armedCard && armedSlot
      ? createPortal(<FocusedPointerJourneyCardHandle card={armedCard}
        location={locationLabel(map, armedCard.stageKey, armedCard.laneType)} canMutate={canMutate}
        onStart={(card) => {
          if (announcementRef.current) {
            announcementRef.current.textContent = `Picked up ${card.title} from ${locationLabel(map, card.stageKey, card.laneType)}, position ${card.ordinal + 1}.`;
          }
          if (focusedOverlayTitleRef.current) focusedOverlayTitleRef.current.textContent = card.title;
          if (focusedOverlayRef.current) focusedOverlayRef.current.hidden = false;
        }}
        onMove={(card, point) => {
          pointerPosition.current = point;
          if (focusedOverlayRef.current) {
            focusedOverlayRef.current.style.transform = `translate3d(${point.x + 12}px, ${point.y + 12}px, 0)`;
          }
          announceCardDrag(card, false);
        }}
        onEnd={async (card, point) => {
          pointerPosition.current = point;
          if (focusedOverlayRef.current) focusedOverlayRef.current.hidden = true;
          await completeCardDrag(card.id);
        }}
        onCancel={(card) => {
          if (focusedOverlayRef.current) focusedOverlayRef.current.hidden = true;
          if (announcementRef.current) announcementRef.current.textContent = `${card.title} was not moved.`;
        }} />, armedSlot)
      : null}
    {useFocusedPointer ? <div ref={focusedOverlayRef} hidden
      className="pointer-events-none fixed left-0 top-0 z-50 max-w-56 border bg-background px-3 py-2 text-xs font-medium shadow-sm"
      style={{ transform: `translate3d(${(pointerPosition.current?.x || 0) + 12}px, ${(pointerPosition.current?.y || 0) + 12}px, 0)` }}
      data-testid="journey-drag-overlay"><span className="flex items-center gap-2"><GripVertical className="h-3.5 w-3.5" />
        <span ref={focusedOverlayTitleRef} className="truncate" /></span></div> : null}
    <DndContext
      sensors={sensors}
      onDragStart={(event: DragStartEvent) => {
        const data = event.active.data.current as DragData | undefined;
        const card = data?.kind === 'card' ? map.cards.find((item) => item.id === data.cardId) : null;
        if (card) beginCardDrag(card);
      }}
      onDragMove={(_event: DragMoveEvent) => { if (activeCard) announceCardDrag(activeCard); }}
      onDragCancel={() => {
        const card = activeCard;
        setActiveCardId('');
        setAnnouncement(card ? `${card.title} was not moved.` : 'The drag was cancelled.');
      }}
      onDragEnd={(event: DragEndEvent) => { void completeCardDrag(String(event.active.id)); }}
    >
      {!useFocusedPointer && armedCard && armedSlot
        ? createPortal(<ArmedJourneyCardHandle card={armedCard}
          location={locationLabel(map, armedCard.stageKey, armedCard.laneType)} canMutate={canMutate} />, armedSlot)
        : null}
      <DragOverlay dropAnimation={null}>{activeCard ? <div className="max-w-56 border bg-background px-3 py-2 text-xs font-medium shadow-sm"
        data-testid="journey-drag-overlay"><span className="flex items-center gap-2"><GripVertical className="h-3.5 w-3.5" />
          <span className="truncate">{activeCard.title}</span></span></div> : null}</DragOverlay>
    </DndContext>
  </>;
}

export function JourneyCardOutline({ map, editable, mutationLocked, selectedCardIds, personasEnabled, evidenceEnabled, actions }: Pick<
  SharedProps,
  'map' | 'editable' | 'mutationLocked' | 'selectedCardIds' | 'personasEnabled' | 'evidenceEnabled' | 'actions'
>) {
  const laneTitles = useMemo(() => new Map(map.lanes.map((lane) => [
    lane.laneType, lane.title || laneLabels[lane.laneType] || lane.laneType
  ])), [map.lanes]);
  const stageOrdinals = useMemo(() => new Map(map.stages.map((stage) => [stage.stageKey, stage.ordinal])), [map.stages]);
  const laneOrdinals = useMemo(() => new Map(map.lanes.map((lane) => [lane.laneType, lane.ordinal])), [map.lanes]);
  const cards = useMemo(() => [...map.cards].sort((left, right) => (
    (stageOrdinals.get(left.stageKey) ?? 0) - (stageOrdinals.get(right.stageKey) ?? 0)
    || (laneOrdinals.get(left.laneType) ?? 0) - (laneOrdinals.get(right.laneType) ?? 0)
    || left.ordinal - right.ordinal || left.id.localeCompare(right.id)
  )), [laneOrdinals, map.cards, stageOrdinals]);
  const canMutate = editable && !mutationLocked;
  return <div className="overflow-x-auto border" data-testid="journey-outline">
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">{evidenceEnabled
        ? 'Journey map outline listing every card with its stage, lane, kind, evidence state, and equivalent keyboard actions.'
        : 'Journey map outline listing every card with its stage, lane, kind, and equivalent keyboard actions.'}</caption>
      <thead><tr className="bg-muted/40 text-left text-xs">
        {editable && <th scope="col" className="border-b p-2">Select</th>}
        <th scope="col" className="border-b p-2">Stage</th><th scope="col" className="border-b p-2">Lane</th>
        <th scope="col" className="border-b p-2">Kind</th><th scope="col" className="border-b p-2">Card</th>
        {evidenceEnabled && <th scope="col" className="border-b p-2">Evidence state</th>}
        {evidenceEnabled && <th scope="col" className="border-b p-2">Why</th>}
      </tr></thead>
      <tbody>{cards.map((card) => {
        const stage = map.stages.find((item) => item.stageKey === card.stageKey);
        const laneTitle = laneTitles.get(card.laneType) || card.laneType;
        const laneCategory = laneLabels[card.laneType];
        return <tr key={card.id} tabIndex={0}
          className="outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={`${card.title}. Press Enter to inspect or Space to select. Alt plus an arrow key moves the card.`}
          data-testid={`outline-card-${card.id}`}
          onKeyDown={(event) => {
            if (event.currentTarget !== event.target) return;
            if (event.key === 'Enter') { event.preventDefault(); actions.inspectCard(card); }
            else if (canMutate && event.key === ' ') { event.preventDefault(); actions.toggleCardSelection(card.id); }
            else if (canMutate && event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
              event.preventDefault(); void actions.moveCardByKeyboard(card, event.key as ArrowKey);
            } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
              event.preventDefault(); actions.copyCard(card.id);
            }
          }}>
          {editable && <td className="border-b p-2"><input type="checkbox"
            checked={selectedCardIds.has(card.id)} disabled={mutationLocked}
            aria-label={`Select card ${card.title}`} onChange={(event) => actions.toggleCardSelection(card.id, event.target.checked)} /></td>}
          <td className="border-b p-2 text-xs">{stage?.name || card.stageKey}</td>
          <td className="border-b p-2 text-xs">{laneCategory && laneCategory !== laneTitle && <span className="sr-only">{laneCategory}: </span>}{laneTitle}</td>
          <td className="border-b p-2 text-xs">{cardKindLabels[card.kind] || card.kind}</td>
          <td className="border-b p-2 text-xs"><span>{card.title}</span>
            <Button type="button" variant="ghost" size="sm" className="ml-2 h-7 px-2 text-xs"
              aria-label={`Inspect card ${card.title}`} onClick={() => actions.inspectCard(card)}>Inspect</Button></td>
          {evidenceEnabled && <td className="border-b p-2 text-xs">{evidenceStateLabels[card.evidence.state].label}</td>}
          {evidenceEnabled && <td className="border-b p-2 text-xs text-muted-foreground">{card.evidence.reason.replaceAll('_', ' ')}</td>}
        </tr>;
      })}
      {!cards.length && <tr><td colSpan={(evidenceEnabled ? 6 : 4) + (editable ? 1 : 0)}
        className="p-4 text-center text-sm text-muted-foreground">This map has no cards yet.</td></tr>}
      </tbody>
    </table>
  </div>;
}
