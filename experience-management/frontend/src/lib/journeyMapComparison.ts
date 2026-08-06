import type { JourneyMapCard, JourneyMapReadModel, JourneyMapStage } from '@/lib/journeyMaps';

export type JourneyComparisonChange = 'added' | 'removed' | 'changed' | 'reordered';
export type JourneyComparisonMatch = 'stage_key' | 'card_id' | 'exact_content' | 'structural_slot' | 'unmatched';

export interface JourneyStageDifference {
  entity: 'stage';
  key: string;
  changes: JourneyComparisonChange[];
  match: JourneyComparisonMatch;
  changedFields: string[];
  before: JourneyMapStage | null;
  after: JourneyMapStage | null;
}

export interface JourneyCardDifference {
  entity: 'card';
  key: string;
  changes: JourneyComparisonChange[];
  match: JourneyComparisonMatch;
  changedFields: string[];
  before: JourneyMapCard | null;
  after: JourneyMapCard | null;
}

export interface JourneyMapComparison {
  stages: JourneyStageDifference[];
  cards: JourneyCardDifference[];
  summary: {
    stages: Record<JourneyComparisonChange, number>;
    cards: Record<JourneyComparisonChange, number>;
  };
}

export interface JourneyComparisonOptions {
  includePersonas: boolean;
  includeEvidence: boolean;
}

function changedFields<T extends object>(before: T, after: T, fields: Array<keyof T>) {
  return fields.filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field])).map(String);
}

function cardContentSignature(card: JourneyMapCard, options: JourneyComparisonOptions) {
  return JSON.stringify({
    kind: card.kind,
    title: card.title,
    content: card.content,
    status: card.status,
    origin: card.origin,
    ...(options.includePersonas ? { personaId: card.personaId } : {}),
    ...(options.includeEvidence ? {
      evidenceState: card.evidence.state,
      evidenceLinkCount: card.evidenceLinkCount
    } : {})
  });
}

function cardSlot(card: JourneyMapCard) {
  return `${card.stageKey}|${card.laneType}|${card.ordinal}`;
}

function summary<T extends { changes: JourneyComparisonChange[] }>(items: T[]) {
  return {
    added: items.filter((item) => item.changes.includes('added')).length,
    removed: items.filter((item) => item.changes.includes('removed')).length,
    changed: items.filter((item) => item.changes.includes('changed')).length,
    reordered: items.filter((item) => item.changes.includes('reordered')).length
  };
}

function compareStages(before: JourneyMapReadModel, after: JourneyMapReadModel) {
  const beforeByKey = new Map(before.stages.map((stage) => [stage.stageKey, stage]));
  const afterByKey = new Map(after.stages.map((stage) => [stage.stageKey, stage]));
  const keys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);
  const differences: JourneyStageDifference[] = [];
  for (const key of keys) {
    const left = beforeByKey.get(key) || null;
    const right = afterByKey.get(key) || null;
    if (!left || !right) {
      differences.push({
        entity: 'stage', key, changes: [left ? 'removed' : 'added'], match: 'unmatched', changedFields: [],
        before: left, after: right
      });
      continue;
    }
    const fields = changedFields(left, right, ['name', 'goal', 'description']);
    const changes: JourneyComparisonChange[] = [];
    if (fields.length) changes.push('changed');
    if (left.ordinal !== right.ordinal) changes.push('reordered');
    if (changes.length) differences.push({
      entity: 'stage', key, changes, match: 'stage_key', changedFields: fields, before: left, after: right
    });
  }
  return differences.sort((left, right) => {
    const leftOrder = Math.min(left.before?.ordinal ?? Number.MAX_SAFE_INTEGER, left.after?.ordinal ?? Number.MAX_SAFE_INTEGER);
    const rightOrder = Math.min(right.before?.ordinal ?? Number.MAX_SAFE_INTEGER, right.after?.ordinal ?? Number.MAX_SAFE_INTEGER);
    return leftOrder - rightOrder || left.key.localeCompare(right.key);
  });
}

function compareCards(before: JourneyMapReadModel, after: JourneyMapReadModel, options: JourneyComparisonOptions) {
  const pairs: Array<{ left: JourneyMapCard; right: JourneyMapCard; match: JourneyComparisonMatch }> = [];
  const leftRemaining = new Map(before.cards.map((card) => [card.id, card]));
  const rightRemaining = new Map(after.cards.map((card) => [card.id, card]));

  // A direct ID is the only unqualified card identity. Versioned cards normally
  // receive new IDs, so later passes use exact, visibly labelled matches only.
  for (const [id, left] of leftRemaining) {
    const right = rightRemaining.get(id);
    if (!right) continue;
    pairs.push({ left, right, match: 'card_id' });
    leftRemaining.delete(id);
    rightRemaining.delete(id);
  }

  const leftSignatures = new Map<string, JourneyMapCard[]>();
  const rightSignatures = new Map<string, JourneyMapCard[]>();
  for (const card of leftRemaining.values()) {
    const signature = cardContentSignature(card, options);
    leftSignatures.set(signature, [...(leftSignatures.get(signature) || []), card]);
  }
  for (const card of rightRemaining.values()) {
    const signature = cardContentSignature(card, options);
    rightSignatures.set(signature, [...(rightSignatures.get(signature) || []), card]);
  }
  for (const [signature, leftCards] of leftSignatures) {
    const rightCards = rightSignatures.get(signature) || [];
    if (leftCards.length !== 1 || rightCards.length !== 1) continue;
    const left = leftCards[0];
    const right = rightCards[0];
    pairs.push({ left, right, match: 'exact_content' });
    leftRemaining.delete(left.id);
    rightRemaining.delete(right.id);
  }

  const rightBySlot = new Map<string, JourneyMapCard[]>();
  for (const card of rightRemaining.values()) {
    const slot = cardSlot(card);
    rightBySlot.set(slot, [...(rightBySlot.get(slot) || []), card]);
  }
  for (const left of [...leftRemaining.values()]) {
    const candidates = rightBySlot.get(cardSlot(left)) || [];
    if (candidates.length !== 1) continue;
    const right = candidates[0];
    pairs.push({ left, right, match: 'structural_slot' });
    leftRemaining.delete(left.id);
    rightRemaining.delete(right.id);
    rightBySlot.delete(cardSlot(left));
  }

  const fieldNames: Array<keyof JourneyMapCard> = ['kind', 'title', 'content', 'status', 'origin'];
  if (options.includePersonas) fieldNames.push('personaId');
  if (options.includeEvidence) fieldNames.push('evidence', 'evidenceLinkCount');
  const differences: JourneyCardDifference[] = [];
  for (const { left, right, match } of pairs) {
    const fields = changedFields(left, right, fieldNames);
    const changes: JourneyComparisonChange[] = [];
    if (fields.length) changes.push('changed');
    if (left.stageKey !== right.stageKey || left.laneType !== right.laneType || left.ordinal !== right.ordinal) {
      changes.push('reordered');
    }
    if (changes.length) differences.push({
      entity: 'card', key: left.id, changes, match, changedFields: fields, before: left, after: right
    });
  }
  for (const left of leftRemaining.values()) differences.push({
    entity: 'card', key: left.id, changes: ['removed'], match: 'unmatched', changedFields: [], before: left, after: null
  });
  for (const right of rightRemaining.values()) differences.push({
    entity: 'card', key: right.id, changes: ['added'], match: 'unmatched', changedFields: [], before: null, after: right
  });
  return differences.sort((left, right) => {
    const a = left.before || left.after!;
    const b = right.before || right.after!;
    return a.stageKey.localeCompare(b.stageKey) || a.laneType.localeCompare(b.laneType)
      || a.ordinal - b.ordinal || left.key.localeCompare(right.key);
  });
}

export function compareJourneyMaps(
  before: JourneyMapReadModel,
  after: JourneyMapReadModel,
  options: JourneyComparisonOptions
): JourneyMapComparison {
  const stages = compareStages(before, after);
  const cards = compareCards(before, after, options);
  return { stages, cards, summary: { stages: summary(stages), cards: summary(cards) } };
}
