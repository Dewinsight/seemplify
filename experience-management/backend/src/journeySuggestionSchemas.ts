import { z } from 'zod';
import { journeyCardKinds } from './journeyDomain.js';

const evidenceRefs = z.array(z.string().trim().min(1).max(400)).max(20);
const rationale = z.string().trim().min(12).max(2_000);
const title = z.string().trim().min(1).max(200);
const content = z.string().max(2_000);
const nullableTitle = title.nullable();
const nullableContent = content.nullable();
const base = { rationale, evidenceRefs };

export const journeySuggestionChange = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('stage.add'),
    name: title,
    goal: z.string().max(200),
    description: content,
    position: z.number().int().min(0).max(49),
    ...base
  }).strict(),
  z.object({
    operation: z.literal('stage.update'),
    stageKey: z.string().trim().min(1).max(100),
    name: nullableTitle,
    goal: z.string().max(200).nullable(),
    description: nullableContent,
    ...base
  }).strict(),
  z.object({
    operation: z.literal('lane.add'),
    title,
    description: content,
    position: z.number().int().min(0).max(23),
    ...base
  }).strict(),
  z.object({
    operation: z.literal('lane.update'),
    laneKey: z.string().trim().min(1).max(63),
    title: nullableTitle,
    description: nullableContent,
    visible: z.boolean().nullable(),
    ...base
  }).strict(),
  z.object({
    operation: z.literal('card.add'),
    stageKey: z.string().trim().min(1).max(100),
    laneKey: z.string().trim().min(1).max(63),
    kind: z.enum(journeyCardKinds),
    title,
    content,
    status: z.enum(['draft', 'active']),
    position: z.number().int().min(0).max(39),
    ...base
  }).strict(),
  z.object({
    operation: z.literal('card.update'),
    cardId: z.string().trim().min(1).max(200),
    kind: z.enum(journeyCardKinds).nullable(),
    title: nullableTitle,
    content: nullableContent,
    status: z.enum(['draft', 'active', 'retired']).nullable(),
    ...base
  }).strict()
]);

export const journeySuggestionResult = z.object({
  summary: z.string().trim().min(20).max(4_000),
  changes: z.array(journeySuggestionChange).min(1).max(30)
}).strict();

export type JourneySuggestionCandidate = z.infer<typeof journeySuggestionChange>;
export type JourneySuggestionProviderResult = z.infer<typeof journeySuggestionResult>;

const string = (minimum = 0, maximum = 2_000) => ({ type: 'string', minLength: minimum, maxLength: maximum });
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const finite = (properties: Record<string, unknown>) => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties
});

export function journeySuggestionJsonSchemaFor(selectedEvidenceRefs: string[]): Record<string, unknown> {
  const refs = [...new Set(selectedEvidenceRefs.map((value) => String(value).trim()).filter(Boolean))].sort();
  const citations = {
    type: 'array', maxItems: refs.length ? 20 : 0,
    items: refs.length ? { type: 'string', enum: refs } : string(1, 400)
  };
  const common = {
    rationale: string(12, 2_000),
    evidenceRefs: citations
  };
  const operations = [
    finite({ operation: { type: 'string', enum: ['stage.add'] }, name: string(1, 200), goal: string(0, 200),
      description: string(0, 2_000), position: { type: 'integer', minimum: 0, maximum: 49 }, ...common }),
    finite({ operation: { type: 'string', enum: ['stage.update'] }, stageKey: string(1, 100),
      name: nullable(string(1, 200)), goal: nullable(string(0, 200)),
      description: nullable(string(0, 2_000)), ...common }),
    finite({ operation: { type: 'string', enum: ['lane.add'] }, title: string(1, 200),
      description: string(0, 2_000), position: { type: 'integer', minimum: 0, maximum: 23 }, ...common }),
    finite({ operation: { type: 'string', enum: ['lane.update'] }, laneKey: string(1, 63),
      title: nullable(string(1, 200)), description: nullable(string(0, 2_000)),
      visible: nullable({ type: 'boolean' }), ...common }),
    finite({ operation: { type: 'string', enum: ['card.add'] }, stageKey: string(1, 100), laneKey: string(1, 63),
      kind: { type: 'string', enum: [...journeyCardKinds] }, title: string(1, 200), content: string(0, 2_000),
      status: { type: 'string', enum: ['draft', 'active'] },
      position: { type: 'integer', minimum: 0, maximum: 39 }, ...common }),
    finite({ operation: { type: 'string', enum: ['card.update'] }, cardId: string(1, 200),
      kind: nullable({ type: 'string', enum: [...journeyCardKinds] }), title: nullable(string(1, 200)),
      content: nullable(string(0, 2_000)), status: nullable({ type: 'string', enum: ['draft', 'active', 'retired'] }),
      ...common })
  ];
  return finite({
    summary: string(20, 4_000),
    changes: { type: 'array', minItems: 1, maxItems: 30, items: { anyOf: operations } }
  });
}
