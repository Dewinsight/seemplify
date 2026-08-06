import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeJourneyPageCursor,
  encodeJourneyPageCursor,
  journeyCollaborationCapabilities,
  journeyCollaborationLimits,
  journeyCollaborationRoles,
  journeyRoleCapabilities,
  journeyRoleCapabilitiesContained,
  normalizeJourneyCommentBody,
  parseJourneyCollaborationViewConfiguration,
  roleHasJourneyCapability,
  type JourneyCollaborationCapability,
  type JourneyCollaborationRole
} from '../src/journeyCollaborationSchema.js';

/**
 * Pure contract tests for the collaboration vocabulary. No database, no module
 * side effects: everything here is decided by the schema module alone, so a
 * failure is a real regression in the capability lattice, the comment-body
 * bounds, the cursor codec or the saved-view configuration parser.
 */

const capability = (value: string) => value as JourneyCollaborationCapability;
const role = (value: string) => value as JourneyCollaborationRole;

test('role capabilities inherit without gaps and stay in canonical order', () => {
  for (const named of journeyCollaborationRoles) {
    const held = journeyRoleCapabilities[named];
    assert.ok(held.length > 0, `${named} holds no capability`);
    assert.deepEqual([...held], journeyCollaborationCapabilities.filter((entry) => held.includes(entry)),
      `${named} capabilities are not in canonical order`);
    assert.equal(new Set(held).size, held.length, `${named} repeats a capability`);
    for (const entry of held) {
      assert.ok(journeyCollaborationCapabilities.includes(entry), `${named} holds unknown ${entry}`);
    }
  }
  for (const [inner, outer] of [['viewer', 'contributor'], ['contributor', 'editor'], ['editor', 'manager'],
    ['approver', 'manager'], ['manager', 'administrator']] as const) {
    assert.ok(journeyRoleCapabilitiesContained(inner, journeyRoleCapabilities[outer]),
      `${outer} should contain every ${inner} capability`);
  }
  assert.deepEqual([...journeyRoleCapabilities.administrator], [...journeyCollaborationCapabilities]);
});

test('the capability lattice is not monotonic, so rank order cannot contain a grant', () => {
  assert.ok(roleHasJourneyCapability('approver', 'journeys.review'));
  assert.ok(roleHasJourneyCapability('approver', 'journeys.publish'));
  assert.ok(!roleHasJourneyCapability('approver', 'journeys.edit'));
  assert.ok(roleHasJourneyCapability('editor', 'journeys.edit'));
  assert.ok(!roleHasJourneyCapability('editor', 'journeys.review'));
  assert.ok(!roleHasJourneyCapability('editor', 'journeys.publish'));
  // Higher rank, and still not a superset in either direction.
  assert.ok(!journeyRoleCapabilitiesContained('editor', journeyRoleCapabilities.approver));
  assert.ok(!journeyRoleCapabilitiesContained('approver', journeyRoleCapabilities.editor));
});

test('viewers cannot write and cannot manage', () => {
  for (const denied of ['journeys.edit', 'journeys.review', 'journeys.publish', 'journeys.manage_roles',
    'journeys.manage_shares', 'journeys.manage_views', 'journeys.export', 'journeys.request_review',
    'journeys.manage_portfolio']) {
    assert.ok(!roleHasJourneyCapability('viewer', capability(denied)), `viewer must not hold ${denied}`);
  }
  for (const granted of ['journeys.read', 'journeys.comment', 'journeys.watch']) {
    assert.ok(roleHasJourneyCapability('viewer', capability(granted)));
  }
});

test('capability sets are immutable, so one mutation cannot escalate every space', () => {
  const viewer = journeyRoleCapabilities.viewer as unknown as JourneyCollaborationCapability[];
  assert.ok(Object.isFrozen(viewer));
  assert.throws(() => viewer.push('journeys.manage_roles'), TypeError);
  assert.throws(() => { viewer[0] = 'journeys.manage_roles'; }, TypeError);
  assert.ok(!roleHasJourneyCapability('viewer', 'journeys.manage_roles'));
  assert.throws(() => {
    (journeyRoleCapabilities as Record<string, unknown>).viewer = ['journeys.manage_roles'];
  }, TypeError);
  assert.ok(!roleHasJourneyCapability('viewer', 'journeys.manage_roles'));
});

test('unknown roles and capabilities are not silently granted', () => {
  assert.equal(journeyRoleCapabilities[role('superuser')], undefined);
  assert.ok(!roleHasJourneyCapability('administrator', capability('journeys.delete_everything')));
});

const paragraph = (text: string) => ({ type: 'paragraph', text, marks: [] });
const document = (...texts: string[]) => ({ version: 1, blocks: texts.map(paragraph) });

test('comment bodies accept plain strings and structured documents', () => {
  const fromString = normalizeJourneyCommentBody('  Checkout drops at payment.  ');
  assert.equal(fromString.plainText, 'Checkout drops at payment.');
  assert.equal(fromString.document.blocks.length, 1);
  const structured = normalizeJourneyCommentBody(document('First line', 'Second line'));
  assert.equal(structured.plainText, 'First line\nSecond line');
});

test('empty and whitespace-only comment bodies are rejected', () => {
  for (const empty of ['', '   ', '\n\n', document(), document('', '   ')]) {
    assert.throws(() => normalizeJourneyCommentBody(empty), /cannot be empty/u);
  }
});

test('comment bodies are rejected rather than truncated at the character limit', () => {
  const block = 'a'.repeat(2_000);
  // Four maximal blocks are exactly at the character limit before the newline
  // joins, and past it afterwards. The join must reject, never silently trim.
  assert.throws(() => normalizeJourneyCommentBody(document(block, block, block, block)), /too long/u);
  const withinLimit = normalizeJourneyCommentBody(document(block, block, block, 'a'.repeat(1_997)));
  assert.equal(withinLimit.plainText.length, journeyCollaborationLimits.commentCharacters);
  assert.throws(() => normalizeJourneyCommentBody(document(block, block, block, block, block)),
    (error: unknown) => Number((error as { status?: number }).status) === 413);
});

test('malformed comment bodies do not reach the rich-text projection', () => {
  for (const malformed of [null, undefined, 42, [], { version: 2, blocks: [] },
    { version: 1, blocks: [{ type: 'table', text: 'x', marks: [] }] },
    { version: 1, blocks: [{ type: 'paragraph', text: 'x', marks: [{ type: 'bold', start: 0, end: 9 }] }] }]) {
    assert.throws(() => normalizeJourneyCommentBody(malformed));
  }
});

test('the byte budget is separate from the character budget', () => {
  // Inside the 8 000 character limit and far outside the 64 KiB body_json
  // column check: 2 blocks x 20 link marks, each href near its own 2 048 limit.
  const href = (index: number) => `https://example.test/${String(index).padStart(4, '0')}${'a'.repeat(1_990)}`;
  const marked = {
    version: 1,
    blocks: [0, 1].map((block) => ({
      type: 'paragraph',
      text: 'x'.repeat(20),
      marks: Array.from({ length: 20 }, (_unused, index) => ({
        type: 'link', start: index, end: index + 1, href: href(block * 20 + index)
      }))
    }))
  };
  const normalized = normalizeJourneyCommentBody(marked);
  assert.ok(normalized.plainText.length < journeyCollaborationLimits.commentCharacters);
  assert.ok(Buffer.byteLength(JSON.stringify(normalized.document), 'utf8')
    > journeyCollaborationLimits.commentBodyBytes,
    'the fixture must exceed the byte budget for the facade guard to be meaningful');
});

test('page cursors round-trip and reject every malformed shape', () => {
  const cursor = { createdAt: '2026-08-05T10:11:12.000Z', id: 'comment-one' };
  const token = encodeJourneyPageCursor(cursor);
  assert.match(token, /^[A-Za-z0-9_-]+$/u);
  assert.deepEqual(decodeJourneyPageCursor(token), cursor);
  for (const empty of [undefined, null, '']) assert.equal(decodeJourneyPageCursor(empty), null);
  const invalid = [
    'not base64url!!',
    Buffer.from('{"createdAt":"2026-08-05T10:11:12.000Z"}', 'utf8').toString('base64url'),
    Buffer.from('{"id":"comment-one"}', 'utf8').toString('base64url'),
    Buffer.from('{"createdAt":"5 August 2026","id":"comment-one"}', 'utf8').toString('base64url'),
    Buffer.from('{"createdAt":"2026-08-05T10:11:12.000Z","id":"a","extra":1}', 'utf8').toString('base64url'),
    Buffer.from('{"createdAt":"2026-08-05T10:11:12.000Z","id":""}', 'utf8').toString('base64url'),
    Buffer.from('not json', 'utf8').toString('base64url'),
    'a'.repeat(513)
  ];
  for (const token of invalid) {
    assert.throws(() => decodeJourneyPageCursor(token), /pagination cursor is invalid/u, `accepted ${token}`);
  }
});

const baseConfiguration = {
  schemaVersion: 1,
  layout: 'table',
  filters: {
    kinds: ['pain_point'], lifecycles: ['approved'], ownerUserIds: ['user-one'],
    tags: ['checkout'], journeyDefinitionIds: ['journey-one'], includeArchived: false
  },
  columns: ['title', 'kind'],
  sort: [{ field: 'title', direction: 'asc' }],
  presentation: {
    title: 'Checkout', showEvidence: true, showMetrics: true, showOwnership: true, showSourceNotes: true
  }
};

test('saved-view configuration parsing is strict about shape and duplicates', () => {
  const parsed = parseJourneyCollaborationViewConfiguration(baseConfiguration);
  assert.equal(parsed.layout, 'table');
  assert.throws(() => parseJourneyCollaborationViewConfiguration({ ...baseConfiguration, unexpected: 1 }));
  assert.throws(() => parseJourneyCollaborationViewConfiguration({
    ...baseConfiguration, filters: { ...baseConfiguration.filters, unexpected: 1 }
  }));
  assert.throws(() => parseJourneyCollaborationViewConfiguration({ ...baseConfiguration, columns: [] }));
  assert.throws(() => parseJourneyCollaborationViewConfiguration({
    ...baseConfiguration, columns: ['title', 'title']
  }), /unique/u);
  for (const duplicated of [
    { kinds: ['pain_point', 'pain_point'] },
    { lifecycles: ['approved', 'APPROVED'] },
    { ownerUserIds: ['user-one', 'user-one'] },
    { tags: ['checkout', 'checkout'] },
    { journeyDefinitionIds: ['journey-one', 'journey-one'] }
  ]) {
    assert.throws(() => parseJourneyCollaborationViewConfiguration({
      ...baseConfiguration, filters: { ...baseConfiguration.filters, ...duplicated }
    }), /unique/u, `accepted duplicate ${JSON.stringify(duplicated)}`);
  }
  assert.throws(() => parseJourneyCollaborationViewConfiguration({
    ...baseConfiguration, filters: { ...baseConfiguration.filters, ownerUserIds: Array.from(
      { length: journeyCollaborationLimits.viewFilterValues + 1 }, (_unused, index) => `user-${index}`) }
  }));
});

test('saved-view layouts are constrained by the resource they present', () => {
  assert.throws(() => parseJourneyCollaborationViewConfiguration(
    { ...baseConfiguration, layout: 'kanban' }, 'journey_map'), /map or table/u);
  assert.equal(parseJourneyCollaborationViewConfiguration(
    { ...baseConfiguration, layout: 'map' }, 'journey_map').layout, 'map');
  assert.throws(() => parseJourneyCollaborationViewConfiguration(
    { ...baseConfiguration, layout: 'map' }, 'portfolio'), /do not support the map layout/u);
  assert.equal(parseJourneyCollaborationViewConfiguration(
    { ...baseConfiguration, layout: 'kanban' }, 'portfolio').layout, 'kanban');
});

test('an over-long comment body reports one status regardless of how far over it is', () => {
  // Two documents that fail the same limit for the same reason. 40 blocks of 200
  // characters pass `normalizeJourneyRichText` at exactly 8 000 but join to 8 039
  // once the block newlines are counted, so they are rejected by
  // `normalizeJourneyCommentBody` itself; 40 blocks of 201 fail the rich-text
  // check first at 8 040. Both are "too long" and both must report 413 -- the
  // joined overflow used to throw a bare Error, which the facade mapped to a 400
  // JOURNEY_COMMENT_BODY_INVALID, so the status depended only on how far over the
  // limit the caller was.
  const document = (perBlock: number) => ({
    version: 1,
    blocks: Array.from({ length: 40 }, () => ({ type: 'paragraph', text: 'x'.repeat(perBlock), marks: [] }))
  });
  const joinedOverflow = document(200);
  assert.equal(joinedOverflow.blocks.reduce((total, block) => total + block.text.length, 0), 8_000);
  // The same failure reached through the per-block maximum: four blocks of 2 000
  // total exactly 8 000 and join to 8 003.
  const fourFullBlocks = {
    version: 1,
    blocks: Array.from({ length: 4 }, () => ({ type: 'paragraph', text: 'x'.repeat(2_000), marks: [] }))
  };
  for (const candidate of [joinedOverflow, document(201), fourFullBlocks]) {
    assert.throws(() => normalizeJourneyCommentBody(candidate), (error: any) => {
      assert.equal(error.status, 413, `status for a too-long body: got ${error.status} ${error.message}`);
      return true;
    });
  }
  // An empty body is a different failure and keeps its own status.
  assert.throws(() => normalizeJourneyCommentBody(''), (error: any) => {
    assert.equal(error.status, 400);
    return true;
  });
  // Exactly at the limit once the joining newlines are counted is still accepted.
  const atLimit = {
    version: 1,
    blocks: [2_000, 2_000, 2_000, 1_997].map((length) => ({
      type: 'paragraph', text: 'x'.repeat(length), marks: []
    }))
  };
  assert.equal(normalizeJourneyCommentBody(atLimit).plainText.length, 8_000);
});

test('manager and administrator hold identical capabilities, so rank is the only separator', () => {
  // Pinned deliberately, not endorsed. `manage` is built as edit + approve +
  // {manage_roles, manage_shares}, which is already all thirteen capabilities, so
  // the "you cannot grant a capability you do not hold" guard in assignJourneyRole
  // can never fire: journeys.manage_roles is held only by these two roles and both
  // hold everything, making roleRank the only real control on a grant. Collapsing
  // or separating the two roles is a product decision on the role model and is out
  // of scope for this run; this test exists so the equivalence cannot change
  // silently in either direction.
  assert.deepEqual([...journeyRoleCapabilities.manager], [...journeyRoleCapabilities.administrator]);
  assert.equal(journeyRoleCapabilities.manager.length, journeyCollaborationCapabilities.length);
  assert.ok(journeyRoleCapabilitiesContained('administrator', journeyRoleCapabilities.manager));
  assert.ok(journeyCollaborationRoles.indexOf('administrator') > journeyCollaborationRoles.indexOf('manager'));
});

test('collaboration limits stay bounded and internally consistent', () => {
  assert.ok(Object.isFrozen(journeyCollaborationLimits));
  assert.equal(journeyCollaborationLimits.commentCharacters, 8_000);
  assert.equal(journeyCollaborationLimits.commentBodyBytes, 65_536);
  assert.ok(journeyCollaborationLimits.pageSize >= 1 && journeyCollaborationLimits.pageSize <= 1_000);
  for (const range of [journeyCollaborationLimits.commentRetentionDays,
    journeyCollaborationLimits.viewRetentionDays, journeyCollaborationLimits.maximumShareDays]) {
    assert.ok(range.minimum >= 1 && range.maximum > range.minimum);
  }
});
