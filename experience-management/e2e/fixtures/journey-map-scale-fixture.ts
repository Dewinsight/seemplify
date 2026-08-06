import type { Page, Route } from '@playwright/test';

type VersionState = 'draft' | 'published';

const builtInLanes = [
  ['stage_goal', 'Stage goal'], ['customer_actions', 'Customer actions'], ['touchpoints', 'Touchpoints'],
  ['expectations', 'Expectations'], ['emotions', 'Emotions'], ['evidence', 'Evidence'], ['metrics', 'Metrics'],
  ['pain_points', 'Pain points'], ['opportunities', 'Opportunities'], ['initiatives', 'Initiatives'],
  ['frontstage', 'Frontstage'], ['backstage', 'Backstage'], ['supporting_systems', 'Supporting systems'],
  ['policies', 'Policies'], ['handoffs', 'Handoffs']
] as const;

function uuid(group: number, index: number) {
  return `00000000-0000-4000-8000-${`${group}${String(index).padStart(11, '0')}`}`;
}

function iso(offset = 0) {
  return new Date(Date.UTC(2026, 7, 4, 12, 0, offset)).toISOString();
}

export function createJourneyMapFixture(options: {
  state?: VersionState;
  stageCount?: number;
  laneCount?: number;
  cardCount?: number;
  name?: string;
} = {}) {
  const state = options.state || 'draft';
  const stageCount = options.stageCount ?? 2;
  const laneCount = options.laneCount ?? 2;
  const cardCount = options.cardCount ?? 2;
  const definitionId = '10000000-0000-4000-8000-000000000001';
  const versionId = '20000000-0000-4000-8000-000000000001';
  const stages = Array.from({ length: stageCount }, (_, index) => ({
    id: uuid(1, index + 1), stageKey: `s${String(index + 1).padStart(2, '0')}-stage-${index + 1}`,
    name: `Stage ${index + 1}`, goal: `Complete stage ${index + 1}`, description: '', ordinal: index
  }));
  const lanes = Array.from({ length: laneCount }, (_, index) => {
    const builtIn = builtInLanes[index];
    return {
      id: uuid(2, index + 1), laneType: builtIn?.[0] || `custom_scale_${String(index + 1).padStart(2, '0')}`,
      title: builtIn?.[1] || `Custom lane ${index + 1}`, description: '', ordinal: index, visible: true
    };
  });
  const scaleShape = stageCount === 50 && laneCount === 20 && cardCount === 500;
  const cards = Array.from({ length: cardCount }, (_, index) => {
    const bucket = scaleShape ? index % 250 : 0;
    const stageIndex = scaleShape ? Math.floor(bucket / 5) : 0;
    const laneIndex = scaleShape ? bucket % 5 : 0;
    const ordinal = scaleShape ? Math.floor(index / 250) : index;
    const laneType = lanes[laneIndex].laneType;
    const kind = laneType === 'stage_goal' ? 'goal' : laneType === 'customer_actions' ? 'action'
      : laneType === 'touchpoints' ? 'touchpoint' : laneType === 'expectations' ? 'expectation'
        : laneType === 'emotions' ? 'emotion' : 'note';
    return {
      id: uuid(3, index + 1), stageKey: stages[stageIndex].stageKey, laneType, kind,
      title: `Scale card ${String(index + 1).padStart(3, '0')}`,
      content: `Production-shaped journey claim ${index + 1}.`, ordinal, personaId: null,
      status: 'active' as const, origin: 'workspace' as const,
      evidence: { state: 'hypothesis' as const, supporting: 0, contradicting: 0, neutral: 0, stale: 0, inaccessible: 0, reason: 'no_evidence' },
      evidenceLinkCount: 0
    };
  });
  const definition = {
    id: definitionId, legacyJourneyId: null, name: options.name || (scaleShape ? '50 stage scale map' : 'Pointer safety map'),
    purpose: 'Representative journey editor fixture.', experienceType: 'customer' as const,
    mapType: 'current_state' as const, mode: 'designed' as const,
    status: state === 'published' ? 'published' as const : 'draft' as const,
    currentVersionId: versionId, publishedVersionId: state === 'published' ? versionId : null,
    revision: 1, stageCount, cardCount, evidenceLinkCount: 0, personaCount: 0,
    createdAt: iso(), updatedAt: iso()
  };
  const version = {
    id: versionId, versionNumber: 1, schemaVersion: 2, state, publishedAt: state === 'published' ? iso(1) : null,
    createdAt: iso(), mapType: 'current_state' as const, mode: 'designed' as const,
    experienceType: 'customer' as const, objective: 'Exercise the complete editor.', industry: 'Cross-industry',
    summary: 'Deterministic scale and interaction fixture.', legacyAudience: ''
  };
  const map = {
    definition, version, stages, lanes, cards, personas: [],
    versions: [{ id: versionId, versionNumber: 1, state, publishedAt: version.publishedAt, createdAt: version.createdAt }],
    researchGaps: [], evidenceSummary: { hypothesis: cardCount }
  };
  const index = {
    journeyMaps: [definition], personas: [],
    limits: { stages: 50, lanes: 24, cards: 500, cardsPerCell: 40, titleChars: 200, contentChars: 2000 },
    catalog: {
      mapTypes: ['current_state', 'future_state', 'ideal_state', 'service_blueprint'],
      experienceTypes: ['customer', 'employee', 'citizen', 'patient', 'partner', 'custom'],
      laneTypes: lanes.map((lane) => lane.laneType),
      cardKinds: ['goal', 'action', 'touchpoint', 'expectation', 'emotion', 'note'],
      evidenceSourceTypes: [], evidenceAssessments: ['supports', 'contradicts', 'neutral'],
      personaLifecycleStates: ['draft', 'in_review', 'active', 'retired']
    }
  };
  return { map, index, definitionId };
}

function reindex(cards: Array<{ id: string; stageKey: string; laneType: string; ordinal: number }>, stageKey: string, laneType: string) {
  cards.filter((card) => card.stageKey === stageKey && card.laneType === laneType)
    .sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id))
    .forEach((card, ordinal) => { card.ordinal = ordinal; });
}

export async function installJourneyMapFixture(page: Page, fixture: ReturnType<typeof createJourneyMapFixture>) {
  let moveRequests = 0;
  let fullMapReads = 0;
  let conflictNext = false;
  let malformedCompactNext = false;
  const moveRequestBodies: Array<{
    expectedRevision: number; stageKey?: string; laneType?: string; ordinal?: number;
    responseMode?: 'affected_cells';
  }> = [];
  await page.route('**/api/journey-maps**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === 'GET' && path === '/api/journey-maps') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture.index) });
      return;
    }
    if (request.method() === 'GET' && path === `/api/journey-maps/${fixture.definitionId}`) {
      fullMapReads += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture.map) });
      return;
    }
    const moveMatch = path.match(new RegExp(`^/api/journey-maps/${fixture.definitionId}/cards/([^/]+)/move$`, 'u'));
    if (request.method() === 'POST' && moveMatch) {
      moveRequests += 1;
      const input = request.postDataJSON() as {
        expectedRevision: number; stageKey?: string; laneType?: string; ordinal?: number;
        responseMode?: 'affected_cells';
      };
      moveRequestBodies.push(input);
      if (conflictNext) {
        conflictNext = false;
        await route.fulfill({
          status: 409, contentType: 'application/json',
          body: JSON.stringify({ error: 'Revision conflict.', code: 'JOURNEY_MAP_REVISION_CONFLICT' })
        });
        return;
      }
      if (input.expectedRevision !== fixture.map.definition.revision) {
        await route.fulfill({
          status: 409, contentType: 'application/json',
          body: JSON.stringify({ error: 'Revision conflict.', code: 'JOURNEY_MAP_REVISION_CONFLICT' })
        });
        return;
      }
      const card = fixture.map.cards.find((item) => item.id === decodeURIComponent(moveMatch[1]));
      if (!card) { await route.fulfill({ status: 404, body: JSON.stringify({ error: 'Card not found.' }) }); return; }
      const source = { stageKey: card.stageKey, laneType: card.laneType };
      card.stageKey = input.stageKey || card.stageKey;
      card.laneType = input.laneType || card.laneType;
      card.ordinal = Number.MAX_SAFE_INTEGER;
      reindex(fixture.map.cards, source.stageKey, source.laneType);
      const destination = fixture.map.cards.filter((item) => item.stageKey === card.stageKey && item.laneType === card.laneType)
        .sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id));
      const from = destination.findIndex((item) => item.id === card.id);
      const to = Math.min(Math.max(input.ordinal ?? from, 0), destination.length - 1);
      destination.splice(to, 0, ...destination.splice(from, 1));
      destination.forEach((item, ordinal) => { item.ordinal = ordinal; });
      fixture.map.definition.revision += 1;
      fixture.map.definition.updatedAt = iso(fixture.map.definition.revision);
      if (input.responseMode === 'affected_cells') {
        const cells = new Map<string, { stageKey: string; laneType: string }>();
        for (const cell of [source, { stageKey: card.stageKey, laneType: card.laneType }]) {
          cells.set(`${cell.stageKey}|${cell.laneType}`, cell);
        }
        const affectedCells = [...cells.values()].map((cell) => ({
          ...cell,
          cards: fixture.map.cards
            .filter((item) => item.stageKey === cell.stageKey && item.laneType === cell.laneType)
            .sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id))
        }));
        const compactBody: any = {
          responseMode: 'affected_cells', definitionId: fixture.definitionId,
          versionId: fixture.map.version.id, cardId: card.id,
          revision: fixture.map.definition.revision, updatedAt: fixture.map.definition.updatedAt,
          cardsPerCellLimit: fixture.index.limits.cardsPerCell, affectedCells
        };
        if (malformedCompactNext) {
          malformedCompactNext = false;
          compactBody.affectedCells = compactBody.affectedCells.map((cell) => ({
            ...cell,
            cards: cell.cards.map((item) => item.id === card.id ? { ...item, kind: 'not_a_journey_card_kind' } : item)
          }));
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(compactBody)
        });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture.map) });
      }
      return;
    }
    await route.fallback();
  });
  return {
    conflictOnNextMove() { conflictNext = true; },
    malformNextCompactResponse() { malformedCompactNext = true; },
    fullMapReadCount() { return fullMapReads; },
    moveRequestCount() { return moveRequests; },
    moveRequestBodies() { return [...moveRequestBodies]; }
  };
}
