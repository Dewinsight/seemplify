import type {
  JourneyCardMoveAffectedCellsResponse, JourneyMapCard, JourneyMapReadModel
} from '@/lib/journeyMaps';

export type JourneyCardPatch = Partial<Pick<
  JourneyMapCard,
  'kind' | 'title' | 'content' | 'personaId' | 'status'
>>;

export type JourneyCardWrite = Pick<
  JourneyMapCard,
  'stageKey' | 'laneType' | 'kind' | 'title' | 'content' | 'personaId' | 'status'
>;

export type JourneyBulkCardPatch = Partial<Pick<
  JourneyMapCard,
  'status' | 'personaId' | 'stageKey' | 'laneType'
>>;

export type JourneyEditorOperation =
  | { type: 'add_card'; card: JourneyCardWrite }
  | { type: 'remove_card'; cardId: string; requireNoEvidence: true }
  | { type: 'update_card'; cardId: string; patch: JourneyCardPatch }
  | { type: 'move_card'; cardId: string; target: { stageKey?: string; laneType?: string; ordinal?: number } }
  | { type: 'bulk_patch_cards'; label: string; cardIds: string[]; patch: JourneyBulkCardPatch }
  | { type: 'add_stage'; stage: { name: string; goal?: string } }
  | { type: 'remove_stage'; stageKey: string; requireEmpty: true }
  | { type: 'move_stage'; stageKey: string; toOrdinal: number }
  | { type: 'add_lane'; lane: { laneKey?: string; title: string; description?: string } }
  | { type: 'remove_lane'; laneKey: string; requireEmpty: true }
  | { type: 'update_lane'; laneKey: string; patch: { title?: string; description?: string } }
  | { type: 'move_lane'; laneKey: string; toOrdinal: number }
  | { type: 'set_lane_visibility'; laneKey: string; visible: boolean }
  | { type: 'composite'; label: string; operations: JourneyEditorOperation[] };

export interface JourneyCardDropLocation {
  stageKey: string;
  laneType: string;
  overCardId?: string;
}

export interface JourneyCardDropPlan {
  target: { stageKey: string; laneType: string; ordinal: number } | null;
  position: number;
  total: number;
  error: string | null;
}

/** Replace only the cells named by a validated compact server response. The
 * rest of the loaded read model remains referentially stable, which keeps a
 * 500-card editor responsive without inventing any client-side authority. */
export function reconcileAffectedCellMove(
  map: JourneyMapReadModel,
  response: JourneyCardMoveAffectedCellsResponse
): JourneyMapReadModel {
  const affected = new Set(response.affectedCells.map((cell) => `${cell.stageKey}|${cell.laneType}`));
  const replacement = response.affectedCells.flatMap((cell) => cell.cards);
  const authoritativeCards = new Map(replacement.map((card) => [card.id, card]));
  const stageNames = new Map(map.stages.map((stage) => [stage.stageKey, stage.name]));
  const cards = [
    ...map.cards.filter((card) => !affected.has(`${card.stageKey}|${card.laneType}`)),
    ...replacement
  ];
  const stageOrdinals = new Map(map.stages.map((stage) => [stage.stageKey, stage.ordinal]));
  const laneOrdinals = new Map(map.lanes.map((lane) => [lane.laneType, lane.ordinal]));
  cards.sort((left, right) => (
    (stageOrdinals.get(left.stageKey) ?? Number.MAX_SAFE_INTEGER)
    - (stageOrdinals.get(right.stageKey) ?? Number.MAX_SAFE_INTEGER)
    || (laneOrdinals.get(left.laneType) ?? Number.MAX_SAFE_INTEGER)
    - (laneOrdinals.get(right.laneType) ?? Number.MAX_SAFE_INTEGER)
    || left.ordinal - right.ordinal
    || left.id.localeCompare(right.id)
  ));
  return {
    ...map,
    definition: { ...map.definition, revision: response.revision, updatedAt: response.updatedAt },
    cards,
    researchGaps: map.researchGaps.map((gap) => {
      const card = authoritativeCards.get(gap.cardId);
      return card ? {
        ...gap,
        stageKey: card.stageKey,
        stageName: stageNames.get(card.stageKey) || gap.stageName,
        laneType: card.laneType
      } : gap;
    })
  };
}

/** Resolve a pointer drop into the same ordinal contract used by keyboard and
 * button moves. The calculation is independent of render order: cards are
 * always sorted by their persisted ordinal and stable id before a position is
 * chosen. */
export function planJourneyCardDrop(
  map: JourneyMapReadModel,
  cardId: string,
  destination: JourneyCardDropLocation,
  cardsPerCell: number
): JourneyCardDropPlan {
  const card = map.cards.find((item) => item.id === cardId);
  if (!card) return { target: null, position: 0, total: 0, error: 'The dragged card no longer exists.' };
  if (!map.stages.some((stage) => stage.stageKey === destination.stageKey)) {
    return { target: null, position: 0, total: 0, error: 'The destination stage is no longer available.' };
  }
  if (!map.lanes.some((lane) => lane.laneType === destination.laneType && lane.visible)) {
    return { target: null, position: 0, total: 0, error: 'The destination lane is no longer available.' };
  }
  if (destination.laneType.startsWith('custom_') && card.kind !== 'note') {
    return { target: null, position: 0, total: 0, error: 'Only note cards can move into a custom lane.' };
  }
  const sameCell = card.stageKey === destination.stageKey && card.laneType === destination.laneType;
  const ordered = map.cards
    .filter((item) => item.stageKey === destination.stageKey && item.laneType === destination.laneType)
    .sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id));
  if (!sameCell && ordered.length >= cardsPerCell) {
    return {
      target: null,
      position: ordered.length,
      total: ordered.length,
      error: `That cell already contains the maximum of ${cardsPerCell} cards.`
    };
  }
  if (destination.overCardId === card.id) {
    return { target: null, position: card.ordinal + 1, total: ordered.length, error: null };
  }
  let ordinal: number;
  if (destination.overCardId) {
    ordinal = ordered.findIndex((item) => item.id === destination.overCardId);
    if (ordinal < 0) {
      return { target: null, position: 0, total: ordered.length, error: 'The drop position is no longer available.' };
    }
  } else {
    ordinal = Math.max(0, ordered.length - (sameCell ? 1 : 0));
  }
  if (sameCell && ordinal === card.ordinal) {
    return { target: null, position: ordinal + 1, total: ordered.length, error: null };
  }
  return {
    target: { stageKey: destination.stageKey, laneType: destination.laneType, ordinal },
    position: ordinal + 1,
    total: ordered.length + (sameCell ? 0 : 1),
    error: null
  };
}

/**
 * The session clipboard intentionally excludes identifiers, evidence links,
 * evidence snapshots, and computed evidence state. A pasted card is a new
 * workspace hypothesis; it never impersonates the source claim's provenance.
 */
export interface JourneyCardClipboardItem {
  kind: string;
  title: string;
  content: string;
  personaId: string | null;
  status: JourneyMapCard['status'];
}

export interface JourneyCardClipboard {
  sourceDefinitionId: string;
  copiedAt: string;
  items: JourneyCardClipboardItem[];
}

export function createJourneyCardClipboard(
  sourceDefinitionId: string,
  cards: readonly JourneyMapCard[],
  personasEnabled: boolean
): JourneyCardClipboard {
  return {
    sourceDefinitionId,
    copiedAt: new Date().toISOString(),
    items: cards.map((card) => ({
      kind: card.kind,
      title: card.title,
      content: card.content,
      personaId: personasEnabled ? card.personaId : null,
      status: card.status
    }))
  };
}

export function validateJourneyCardPaste(
  map: JourneyMapReadModel,
  clipboard: JourneyCardClipboard,
  target: { stageKey: string; laneType: string },
  limits: { cards: number; cardsPerCell: number }
): string | null {
  if (!map.stages.some((stage) => stage.stageKey === target.stageKey)) return 'Choose an available target stage.';
  if (!map.lanes.some((lane) => lane.laneType === target.laneType)) return 'Choose an available target lane.';
  if (!clipboard.items.length) return 'Copy at least one card first.';
  if (map.cards.length + clipboard.items.length > limits.cards) {
    return `Pasting these cards would exceed the map limit of ${limits.cards}.`;
  }
  const targetCount = map.cards.filter((card) => (
    card.stageKey === target.stageKey && card.laneType === target.laneType
  )).length;
  if (targetCount + clipboard.items.length > limits.cardsPerCell) {
    return `Pasting these cards would exceed the cell limit of ${limits.cardsPerCell}.`;
  }
  if (target.laneType.startsWith('custom_') && clipboard.items.some((item) => item.kind !== 'note')) {
    return 'Custom lanes accept note cards only. Choose another lane or copy note cards.';
  }
  return null;
}

export function pasteJourneyCardOperations(
  clipboard: JourneyCardClipboard,
  target: { stageKey: string; laneType: string },
  linkedPersonaIds: ReadonlySet<string>,
  personasEnabled: boolean
): JourneyEditorOperation {
  return {
    type: 'composite',
    label: clipboard.items.length === 1 ? 'Paste card' : `Paste ${clipboard.items.length} cards`,
    operations: clipboard.items.map((item) => ({
      type: 'add_card',
      card: {
        ...item,
        stageKey: target.stageKey,
        laneType: target.laneType,
        personaId: personasEnabled && item.personaId && linkedPersonaIds.has(item.personaId)
          ? item.personaId
          : null
      }
    }))
  };
}

function reorder<Item>(items: readonly Item[], from: number, to: number): Item[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;
  const target = Math.min(Math.max(to, 0), next.length - 1);
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

function optimisticMoveCard(
  map: JourneyMapReadModel,
  cardId: string,
  target: { stageKey?: string; laneType?: string; ordinal?: number }
) {
  const current = map.cards.find((card) => card.id === cardId);
  if (!current) return map;
  const stageKey = target.stageKey || current.stageKey;
  const laneType = target.laneType || current.laneType;
  const without = map.cards.filter((card) => card.id !== cardId);
  const targetCell = without
    .filter((card) => card.stageKey === stageKey && card.laneType === laneType)
    .sort((left, right) => left.ordinal - right.ordinal);
  const inserted = reorder(
    [...targetCell, { ...current, stageKey, laneType, ordinal: Number.MAX_SAFE_INTEGER }],
    targetCell.length,
    target.ordinal ?? targetCell.length
  ).map((card, ordinal) => ({ ...card, ordinal }));
  const insertedById = new Map(inserted.map((card) => [card.id, card]));
  const cards = [...without.filter((card) => !insertedById.has(card.id)), ...inserted];
  const stageOrdinals = new Map(map.stages.map((stage) => [stage.stageKey, stage.ordinal]));
  const laneOrdinals = new Map(map.lanes.map((lane) => [lane.laneType, lane.ordinal]));
  cards.sort((left, right) => (
    (stageOrdinals.get(left.stageKey) ?? 0) - (stageOrdinals.get(right.stageKey) ?? 0)
    || (laneOrdinals.get(left.laneType) ?? 0) - (laneOrdinals.get(right.laneType) ?? 0)
    || left.ordinal - right.ordinal
    || left.id.localeCompare(right.id)
  ));
  return { ...map, cards };
}

/** Apply only changes whose client identity is already known. Create/remove
 * operations wait for the authoritative response instead of drawing fake rows. */
export function applyOptimisticJourneyOperation(
  map: JourneyMapReadModel,
  operation: JourneyEditorOperation
): JourneyMapReadModel {
  switch (operation.type) {
    case 'composite':
      return operation.operations.reduce(applyOptimisticJourneyOperation, map);
    case 'update_card':
      return { ...map, cards: map.cards.map((card) => card.id === operation.cardId ? { ...card, ...operation.patch } : card) };
    case 'move_card':
      return optimisticMoveCard(map, operation.cardId, operation.target);
    case 'bulk_patch_cards': {
      const selected = new Set(operation.cardIds);
      const moved = operation.patch.stageKey !== undefined || operation.patch.laneType !== undefined
        ? operation.cardIds.reduce((current, cardId) => optimisticMoveCard(current, cardId, {
          stageKey: operation.patch.stageKey,
          laneType: operation.patch.laneType
        }), map)
        : map;
      return {
        ...moved,
        cards: moved.cards.map((card) => selected.has(card.id) ? {
          ...card,
          ...(operation.patch.status !== undefined ? { status: operation.patch.status } : {}),
          ...(operation.patch.personaId !== undefined ? { personaId: operation.patch.personaId } : {})
        } : card)
      };
    }
    case 'move_stage': {
      const ordered = [...map.stages].sort((left, right) => left.ordinal - right.ordinal);
      const from = ordered.findIndex((stage) => stage.stageKey === operation.stageKey);
      return { ...map, stages: reorder(ordered, from, operation.toOrdinal).map((stage, ordinal) => ({ ...stage, ordinal })) };
    }
    case 'update_lane':
      return { ...map, lanes: map.lanes.map((lane) => lane.laneType === operation.laneKey ? { ...lane, ...operation.patch } : lane) };
    case 'move_lane': {
      const ordered = [...map.lanes].sort((left, right) => left.ordinal - right.ordinal);
      const from = ordered.findIndex((lane) => lane.laneType === operation.laneKey);
      return { ...map, lanes: reorder(ordered, from, operation.toOrdinal).map((lane, ordinal) => ({ ...lane, ordinal })) };
    }
    case 'set_lane_visibility':
      return { ...map, lanes: map.lanes.map((lane) => lane.laneType === operation.laneKey
        ? { ...lane, visible: operation.visible }
        : lane) };
    default:
      return map;
  }
}

export function journeyEditorOperationLabel(operation: JourneyEditorOperation): string {
  switch (operation.type) {
    case 'composite': return operation.label;
    case 'add_card': return 'Add card';
    case 'remove_card': return 'Remove newly added card';
    case 'update_card': return 'Edit card';
    case 'move_card': return 'Move card';
    case 'bulk_patch_cards': return operation.label;
    case 'add_stage': return 'Add stage';
    case 'remove_stage': return 'Remove newly added stage';
    case 'move_stage': return 'Move stage';
    case 'add_lane': return 'Add lane';
    case 'remove_lane': return 'Remove newly added lane';
    case 'update_lane': return 'Edit lane';
    case 'move_lane': return 'Move lane';
    case 'set_lane_visibility': return operation.visible ? 'Show lane' : 'Hide lane';
  }
}
