# Connected Journey Management master implementation plan

**Status:** Proposed programme plan  
**Last updated:** 2026-08-04  
**Product:** Seemplify Experience Management  
**Document purpose:** Execution-ready plan for evolving the existing Journey Maps feature into a complete, evidence-backed, connected Journey Management platform.

## 1. Executive decision

Seemplify will build a complete Journey Management capability that covers the five previously agreed product phases, the publicly documented XEBO.ai journey capabilities, the strongest journey-management patterns found in Smaply and UXPressia, and connected-journey capabilities comparable in purpose to Qualtrics Customer Journey Optimizer.

The programme will deliver three visibly different journey modes:

1. **Designed journey:** a human- or AI-created planning hypothesis.
2. **Evidence-backed journey:** a map whose claims, pain points, emotions, metrics, and opportunities are linked to authorised research evidence.
3. **Connected journey:** a map continuously informed by customer, account, application, survey, service, communication, and operational events.

The existing local Knowledge Graph RAG system remains the authoritative document evidence and retrieval system. The programme will **not** create a second knowledge-management engine. A Journey Research Hub will organise references to existing knowledge documents, survey evidence, saved intelligence, social evidence, tickets, messages, agreements, interview observations, and product events. It will store journey-specific links, classifications, excerpts, confidence, freshness, and validation state while the original evidence remains in its system of record.

The first externally useful connected-journey release must allow a customer to install the Web SDK, send events, map events to stages, and see stage volume, conversion, drop-off, elapsed time, and linked survey evidence. Seemplify itself will be the first production-like customer of this capability.

## 2. Outcomes and success criteria

The programme is successful when Seemplify can answer, with traceable evidence:

- Who is experiencing this journey: persona, segment, account, or individual profile?
- What is the intended journey and what paths are customers actually taking?
- What does the customer try to accomplish at each stage?
- Which channels, touchpoints, people, processes, and systems shape the experience?
- What do customers feel and say, and what evidence supports that conclusion?
- What are the stage-level NPS, CSAT, CES, sentiment, conversion, abandonment, and time metrics?
- Where do journeys break, loop, stall, or diverge between cohorts?
- Which pain points recur across journeys and which should be prioritised?
- Who owns each improvement, what is its status, and did it improve the outcome?
- Which safe, approved workflow should happen when a risk or opportunity is detected?

Programme-level measures:

| Outcome | Initial acceptance target |
| --- | --- |
| Evidence traceability | 100% of AI-created evidence-backed claims retain source IDs and excerpts or are labelled unsupported hypotheses |
| Ingestion reliability | At least 99.9% accepted events durably persisted; no acknowledged event silently lost |
| Ingestion latency | p95 acknowledgement below 300 ms under the agreed initial load profile |
| Analytics freshness | New accepted events reflected in standard stage aggregates within 60 seconds |
| Deduplication | Replayed event IDs do not inflate metrics |
| Isolation | No cross-space event, profile, map, evidence, metric, or export access in automated security tests |
| Privacy | Identify, merge, export, suppress, and erase flows pass end-to-end privacy tests |
| Accessibility | Core editor, analytics, portfolio, and profile experiences meet WCAG 2.2 AA checks |
| Dogfooding | Seemplify activation journey runs from real first-party events in production-like staging before customer beta |
| Actionability | A validated pain point can become an owned initiative and a measured before/after outcome without re-entering data |

## 3. Scope

### 3.1 Journey design and visualisation

- Manual and AI-assisted map creation.
- Industry, organisation, and use-case templates.
- Current-state, future-state, ideal-state, and service-blueprint maps.
- Customer, employee, citizen, patient, partner, and custom experience types.
- Reusable personas and multiple persona layers per map.
- Stages, steps, goals, actions, decisions, expectations, needs, jobs-to-be-done, touchpoints, channels, emotions, pain points, moments of truth, opportunities, metrics, evidence, and initiatives.
- Configurable lanes and structured cards.
- Drag-and-drop stage/card movement, keyboard movement, bulk edit, copy, and reusable components.
- Emotional curves, metric overlays, images, attachments, rich text, and linked subjourneys.
- Saved views, filters, version history, comments, presentation mode, and branded export.
- AI generation, audit, gap detection, template recommendation, and measurable improvement suggestions.

### 3.2 Evidence and Journey Research Hub

- Reuse the existing Knowledge Graph RAG runtime and knowledge-base permissions.
- Link knowledge documents and exact retrieval citations.
- Link surveys, questions, responses, response excerpts, and saved analyses.
- Link social posts, mentions, reply outcomes, and social intelligence.
- Link recovery tickets, assistant email, agreements, research reports, interviews, observations, and imported studies.
- Link product events, aggregate facts, and customer-path observations.
- Support evidence classifications, source freshness, population, time window, confidence, contradictions, and validation status.
- Detect unsupported claims, stale evidence, conflicting evidence, and unrepresented personas.
- Re-run bounded analysis when explicitly requested or when an authorised monitored source changes.

### 3.3 Personas, segments, profiles, and Customer 360

- Reusable research-backed personas with goals, behaviours, needs, barriers, attributes, evidence, ownership, and lifecycle status.
- Persona comparison and persona-specific journey views.
- Dynamic segments defined by consent-aware profile, account, event, metric, and survey conditions.
- Individual customer profiles with attributes, consent, identities, memberships, and interaction timeline.
- Account/household/organisation profiles with members, traits, journeys, and aggregate health.
- Anonymous visitor profiles and deterministic anonymous-to-known identity merge.
- Journey instances showing an individual or account's actual progress through a journey.
- Clear UI and API distinction among persona, segment, profile, account, and journey instance.

### 3.4 Live analytics and actual paths

- Stage NPS, CSAT, CES, sentiment, emotions, effort, conversion, completion, drop-off, time-in-stage, repeat-contact, and custom metrics.
- Current value, target, baseline, sample size, data window, freshness, and trend.
- Filters by time, persona, segment, account, geography, plan, channel, device, source, campaign, and consent-compatible custom attributes.
- Funnel, path, Sankey/flow, cohort, transition, duration, anomaly, and journey-health visualisations.
- Most common, successful, unsuccessful, unexpected, looping, and stalled paths.
- Metric and path comparison across personas, segments, periods, channels, and journey versions.
- Driver/correlation analysis with explicit non-causation warnings.
- Churn and conversion indicators with explainability, confidence, and source windows.

### 3.5 Journey management and portfolio

- Journey hierarchy, macro journeys, subjourneys, variants, handoffs, and linked maps.
- Reusable pain points, opportunities, solutions, metrics, touchpoints, and initiatives.
- Portfolio table, board, relationship tree, and prioritisation matrix.
- Configurable scoring including impact, reach, confidence, effort, cost, risk, and strategic alignment.
- Owners, collaborators, teams, status, priority, due dates, dependencies, risks, approvals, and review cadence.
- Before/after measurements, initiative outcomes, and benefit tracking.
- Comments, mentions, watchers, activity, audit history, saved views, and role-based permissions.
- Executive and operational journey dashboards.

### 3.6 Service blueprints

- Customer actions and visible touchpoints.
- Frontstage employee/partner activity.
- Backstage processes.
- Supporting systems, vendors, policies, data, and business rules.
- Lines of interaction, visibility, and internal interaction.
- Handoffs, queues, failure points, controls, SLAs, costs, and operational metrics.
- Structured ownership and dependencies connecting backstage causes to customer-facing pain points.

### 3.7 Connected-journey developer platform

- Canonical, versioned event protocol.
- Public Events API, batch endpoint, server endpoint, and signed webhook ingestion.
- Browser/JavaScript, React, Node.js, React Native, iOS, and Android SDKs.
- API keys, public write keys, server secrets, rotation, revocation, scopes, environments, origins, and source controls.
- Schema registry, tracking plan, event catalogue, sample payloads, test console, debugger, dead-letter inspection, and authorised replay.
- Identity resolution, sessions, devices, accounts, transactions, consent, suppression, retention, export, and deletion.
- CRM, support, analytics, data-warehouse, survey, communication, and automation integrations.
- Quotas, rate limits, metering, billing dimensions, and platform administration.

### 3.8 Orchestration and closed-loop action

- Trigger surveys, tickets, assistant actions, alerts, reminders, approved messages, webhooks, and internal workflows.
- Journey entry, exit, transition, stall, metric threshold, negative sentiment, churn risk, and profile-change triggers.
- Segment and frequency conditions, quiet hours, suppression lists, consent checks, idempotency, retries, approval gates, and action caps.
- Human review for consequential or externally visible actions by default.
- Workflow versions, simulation, dry run, activation, pause, audit, rollback, and outcome attribution.

### 3.9 Administration, plans, and operations

- Feature flags and subscription entitlements for journey design, evidence, analytics, profiles, orchestration, SDKs, retention, and export.
- Enforced limits for maps, personas, seats, sources, monthly tracked events, stored profiles, event properties, retention, workflows, actions, exports, and AI operations.
- Platform and space administration for keys, sources, schemas, usage, failures, queues, replay, retention, regional routing, and audit.
- Operational dashboards for ingest rate, invalid events, latency, queue lag, aggregation freshness, profile merge failures, orchestration outcomes, and SDK versions.

## 4. Explicit competitor and gap coverage

This is a parity-and-improvement target, not an attempt to copy proprietary implementation or branding.

| Capability | Required Seemplify target | Primary phase |
| --- | --- | --- |
| AI map generation | Retain and upgrade with templates, personas, evidence, and structured output | 1 |
| Editable stages | Structured stage/lane/card editor with drag, keyboard, and bulk operations | 1 |
| Evidence warnings | Retain; add evidence state per claim/card | 1 |
| Reusable personas | Persona library with evidence, owners, states, and reusable links | 1 |
| Multiple personas | Overlay, compare, and filter persona-specific lanes and metrics | 1-2 |
| Stage-level citations | Exact source links, excerpts, populations, dates, and confidence | 1 |
| Journey NPS/CSAT/CES | Live stage metrics with sample and time window | 2 |
| Sentiment trends | Evidence and event-derived stage sentiment over time | 2 |
| Automatic journey visualisation | AI draft plus event-derived actual-path views; mode clearly labelled | 1 and 5 |
| Churn/gap identification | Rules and analytics first; predictive indicators after adequate data | 2 and 5 |
| AI gap-fixing suggestions | Evidence-backed opportunities and measurable initiatives | 1-3 |
| Omnichannel tracking | Normalised channel/touchpoint/event sources | 2 and 5 |
| Actual customer paths | Identity-aware journey instances and transition analytics | 5 |
| Journey hierarchy/linking | Macro/subjourneys, variants, handoffs, and dependency graph | 4 |
| Service blueprint | Frontstage/backstage/system/process lanes and visibility lines | 4 |
| Pain-point portfolio | Reusable, evidence-backed pain points with scoring and reuse | 3 |
| Initiative ownership/status | Owner, state, due date, dependency, impact, and measured outcome | 3 |
| Collaboration/comments | Comments, mentions, watchers, approvals, presence-safe conflict handling | 3 |
| Templates | Industry, organisation, and map-type templates with admin governance | 1 |
| PDF/PNG/PPT export | Accessible branded export with saved-view selection | 3 |
| Customer profile/segment linkage | Consent-aware Customer 360 and dynamic segments | 5 |
| Closed-loop workflows | Safe orchestration with approval and audit | 5 |
| Multi-journey linking | Journey links and hierarchy | 4 |
| Editable persona | Rich reusable persona rather than a plain audience string | 1 |
| Journey sharing | Permissioned internal sharing and optional expiring read-only links | 3 |
| 360-degree view | Profile/account timeline across events, feedback, tickets, messages, and journeys | 5 |

## 5. Product terminology and invariants

### 5.1 Canonical terminology

| Term | Definition |
| --- | --- |
| Persona | Evidence-backed archetype representing a recurring type of participant; never an individual person |
| Segment | Dynamic or materialised cohort selected by rules over authorised data |
| Profile | A known or anonymous individual with identities, traits, consent, and interactions |
| Account | Organisation, household, team, or other grouping of profiles |
| Journey definition | Versioned model of stages, rules, metrics, and presentation |
| Journey instance | Observed progress of one profile or account through a journey definition |
| Stage | Meaningful phase defined by the participant's goal, not merely an internal department |
| Step | Finer activity within a stage |
| Touchpoint | Interaction between participant and organisation/partner/system |
| Evidence link | Authorised reference from a journey artefact to immutable or version-pinned source evidence |
| Metric definition | Formula, source, filters, aggregation, window, and target for a measure |
| Metric observation | Computed value for a metric definition at a point/window and segment |
| Pain point | Evidence-backed customer or employee problem that may occur in multiple journeys |
| Opportunity | Outcome-oriented area for improvement linked to pain points and evidence |
| Solution | Proposed response to one or more opportunities |
| Initiative | Owned, scheduled, measurable delivery effort implementing a solution |
| Orchestration | Versioned rule that evaluates conditions and requests controlled actions |

### 5.2 Non-negotiable product and engineering invariants

- A designed or AI-generated map is labelled a hypothesis until evidence supports it.
- An AI response cannot silently convert a hypothesis into observed fact.
- Every evidence-backed claim retains source, excerpt or aggregate definition, population, time window, and access scope.
- Metrics show sample size, freshness, filters, and source; percentages without denominators are prohibited.
- Correlation and prediction are never labelled causation.
- Space identity comes from authenticated membership, never a browser-supplied `spaceId`.
- Public SDK keys can only write bounded events to their configured space/source/environment and cannot read data.
- Server secrets never appear in browser or mobile packages.
- Event acknowledgement occurs only after durable persistence or an explicitly documented durable edge buffer.
- At-least-once delivery is assumed; event IDs and idempotency make processing effectively once for metrics.
- Raw immutable events and derived aggregates are separate; derived data can be rebuilt.
- Identity merges are deterministic, audited, reversible where legally and technically possible, and scoped to a space.
- Consent, suppression, deletion, and retention are enforced before activation and in downstream derived stores.
- External actions are human-reviewed unless an authorised administrator explicitly enables a bounded automation.
- The existing knowledge runtime remains a rebuildable evidence index; the application database remains the control-plane source of truth.
- Subscription features must be hidden in navigation and rejected by backend enforcement when disabled.
- Every long-running operation is durable, idempotent, observable, cancellable where safe, and restart-recoverable.

## 6. Current Seemplify foundation to reuse

| Existing foundation | Reuse decision |
| --- | --- |
| `journeys` with structured stages | Migrate into versioned Journey Map 2.0 definitions; preserve legacy maps |
| AI `journey.generate` and `journey.optimize` jobs | Retain durable jobs; upgrade schemas/prompts and introduce suggestion review rather than silent replacement |
| Journey provenance and hypothesis warning | Retain and expand to card-level evidence state |
| Journey version history and conflict control | Retain; extend to definitions, views, templates, and workflow versions |
| Surveys, collectors, responses, NPS/CSAT/CES analytics | Link surveys/collectors/questions to stages and reuse deterministic metrics |
| Saved survey/social/cross-source intelligence | Expose as Journey Research Hub sources through evidence adapters |
| Recovery tickets and assistant actions | Reuse as initial initiative/action destinations |
| Social listening | Link mentions, sentiment, publications, and reply outcomes to stages/touchpoints |
| Agreements and email | Link authorised activity/evidence; respect privacy and existing human-review contracts |
| Knowledge Graph RAG | Reuse unchanged as core document extraction, indexing, retrieval, graph, and citation service |
| Deep corpus analysis | Reuse for explicitly requested large journey research syntheses |
| Durable AI queue and runtime selection | Reuse for journey generation, research synthesis, suggestions, and explanations |
| Spaces and roles | Extend with journey-specific capabilities; do not create a separate tenancy model |
| Platform plans and enforced entitlements | Extend feature and quota catalogue for journey capabilities and event usage |
| Platform admin/audit | Extend for tracking sources, keys, schemas, usage, failures, and orchestration governance |
| SQLite development plus PostgreSQL runtime migrations | Continue additive, tested, versioned migrations; keep fresh install and upgrade parity |

## 7. Target architecture

```text
Customer applications and systems
  Web SDK | React | React Native | iOS | Android | Node/server
  CRM | support | analytics | data warehouse | imports | signed webhooks
                              |
                              v
                    Regional ingest edge/API
          origin/key/scope -> validate -> consent gate -> durable append
                              |
                +-------------+------------------+
                |                                |
                v                                v
       Schema/debug/dead-letter            Identity resolution
                |                         profile/account/session
                +-------------+------------------+
                              |
                              v
                  Journey evaluation pipeline
          stage rules -> instances -> transitions -> aggregations
                  |              |              |
                  v              v              v
             Live metrics     Actual paths    Trigger candidates
                  |                             |
                  +---------------+-------------+
                                  v
                         Orchestration engine
                    policy -> approval -> action -> outcome

Existing Seemplify evidence systems
  Knowledge Graph RAG | surveys | social | tickets | email | agreements
                                  |
                                  v
                         Journey Research Hub
                 version-pinned evidence links and synthesis
                                  |
                                  v
Journey Management application
  personas | maps | analytics | hierarchy | blueprints | portfolio | 360
```

### 7.1 Deployment boundaries

The plan should initially preserve the existing application deployment while introducing clear internal modules and durable boundaries:

- **Control plane:** journey definitions, personas, permissions, plans, sources, keys, schemas, tracking plans, workflows, and audit.
- **Ingest plane:** internet-facing write-only endpoints, validation, rate limiting, deduplication, and durable append.
- **Processing plane:** identity resolution, journey evaluation, aggregates, path materialisation, and trigger evaluation.
- **Evidence plane:** existing knowledge runtime plus source adapters and journey evidence links.
- **Action plane:** approval-aware orchestration, retries, provider adapters, and outcome logging.

Start as well-separated modules and workers inside the existing backend where load permits. Extract ingest/processing into independently scalable services only when measured throughput, isolation, or release cadence justifies it. The event protocol and storage boundaries must be service-extraction-safe from the beginning.

## 8. Knowledge and evidence strategy

### 8.1 No second knowledge-management system

The Journey Research Hub is a control-plane catalogue, not another vector store. It contains:

- `evidence_source`: adapter and source identity, such as knowledge document, survey response, saved intelligence, social mention, ticket, email, agreement, interview, observation, or event aggregate.
- `evidence_snapshot`: immutable/version-pinned source locator, collection time, population, filter/window, checksum, visibility, and deletion state.
- `evidence_link`: relationship from evidence snapshot to persona, stage, touchpoint, emotion, pain point, opportunity, metric, or initiative.
- `evidence_excerpt`: exact authorised excerpt or structured aggregate explanation.
- `evidence_assessment`: support/contradict/neutral classification, confidence, reviewer, method, and validation date.

Document content, chunks, embeddings, graph nodes, and retrieval stay in the existing knowledge runtime. Survey responses remain in survey storage. Social mentions remain in social storage. The Research Hub stores stable references and only the bounded excerpt/aggregate necessary for explainability and audit.

### 8.2 Evidence states

- `hypothesis`: no supporting evidence attached.
- `anecdotal`: one or weak qualitative source.
- `supported`: multiple or sufficiently strong sources for the declared population/window.
- `strongly_supported`: triangulated qualitative and quantitative evidence with adequate sample and freshness.
- `contradicted`: material credible evidence conflicts with the claim.
- `stale`: evidence is outside its review/freshness policy.
- `invalidated`: reviewer or source correction has made the claim unusable.

The state is computed from transparent rules and can be reviewer-adjusted only with an audit reason. AI may recommend a state but cannot finalise `strongly_supported` without deterministic checks and/or authorised review.

### 8.3 Evidence refresh

- Store version-pinned references so previous analyses remain reproducible.
- Notify map owners when a linked source changes, expires, is deleted, or becomes inaccessible.
- Never silently replace evidence on a published journey version.
- Offer an explicit “refresh evidence” run that produces a reviewed change set.
- Cascade privacy deletion into links, excerpts, aggregates, and derived claims without leaking deleted content into history or exports.

## 9. Target domain and data model

The model should be normalised for reuse, ownership, metrics, and evidence. JSON may remain for bounded presentation settings, immutable snapshots, and provider payloads; reusable business entities must not remain anonymous strings buried in one journey blob.

### 9.1 Core design entities

| Entity | Essential fields and relationships |
| --- | --- |
| `journey_definitions` | id, space, name, purpose, experience type, map type, mode, status, owner, current version, review cadence, created/updated |
| `journey_versions` | immutable version, definition, schema version, state, provenance, author, source AI job, publication state, created |
| `journey_stages` | version, stable stage key, name, goal, description, ordinal, entry/exit semantics, parent stage, visual settings |
| `journey_steps` | stage, name, goal/action/decision type, ordinal, optional transition hints |
| `journey_lanes` | version or template, type, title, ordinal, visibility, custom schema |
| `journey_cards` | version, stage/step, lane, reusable item reference or local content, persona applicability, status, visual settings |
| `journey_links` | source journey/stage, target journey/stage, type such as parent/child/handoff/variant/precedes, explanation |
| `journey_views` | owner/shared scope, filters, visible lanes, personas, time window, segment, presentation settings |
| `journey_templates` | system/space ownership, industry, use case, map type, version, definition snapshot, approval state |

### 9.2 Persona, segment, and profile entities

| Entity | Essential fields and relationships |
| --- | --- |
| `personas` | space, name, summary, lifecycle state, owner, attributes, goals, behaviours, needs, barriers, review date |
| `persona_evidence_links` | persona field/claim to evidence snapshot and assessment |
| `segments` | name, description, rule version, evaluation mode, consent constraints, estimated/materialised count |
| `segment_versions` | immutable expression AST, referenced fields/events, validation result, author, activation state |
| `profiles` | opaque internal ID, anonymous/known state, traits, locale/timezone, consent summary, suppression/deletion state |
| `profile_identities` | type, normalised value hash, encrypted value where permitted, verified state, source, first/last seen |
| `accounts` | type, name, external references, traits, consent/policy context, health summary |
| `account_memberships` | account, profile, role, validity window, source |
| `profile_persona_assignments` | profile or segment to persona, confidence, method, version, explanation; optional and never treated as identity |

### 9.3 Research, insight, and improvement entities

| Entity | Essential fields and relationships |
| --- | --- |
| `evidence_sources` | source type, adapter, source record, system of record, visibility, owner |
| `evidence_snapshots` | source, pinned version/checksum, population, window, metadata, deletion/access state |
| `evidence_links` | target entity/type/field, snapshot, relationship, excerpt, assessment, reviewer |
| `journey_pain_points` | reusable title/description, severity, frequency, status, owner, evidence state |
| `journey_opportunities` | desired outcome, linked pain points, reach, impact, status, owner |
| `journey_solutions` | hypothesis, linked opportunities, constraints, estimated effort/cost/risk |
| `journey_initiatives` | solution, owner/team, status, priority, dates, dependencies, target metrics, outcome |
| `journey_item_links` | reusable item to journey/stage/touchpoint/persona and applicability window |
| `journey_comments` | target, author, body, mentions, state, created/edited/resolved |
| `journey_activity` | append-only material business activity; complements platform audit rather than replacing it |

### 9.4 Metrics and analytics entities

| Entity | Essential fields and relationships |
| --- | --- |
| `journey_metric_definitions` | name, type, formula AST, source, journey/stage/touchpoint, unit, aggregation, target, direction |
| `journey_metric_observations` | metric, segment/cohort, window, value, numerator, denominator, sample, confidence, freshness |
| `journey_stage_rules` | versioned rule mapping events/conditions to stage entry, progress, completion, or exit |
| `journey_instances` | journey version, profile/account, state, current stage, started/completed/last activity, attribution |
| `journey_instance_transitions` | instance, from/to stage, triggering event, occurred/processed, sequence, duration |
| `journey_aggregate_buckets` | journey/stage/transition/segment/window counts and statistics; rebuildable |
| `journey_path_signatures` | bounded normalised path, cohort/window, instances, completion, duration, outcome measures |
| `journey_anomalies` | metric/path, detector version, baseline, observed value, severity, explanation, state |

### 9.5 Event, identity, and developer entities

| Entity | Essential fields and relationships |
| --- | --- |
| `tracking_sources` | space, name, type, environment, allowed origins/apps, state, region, default retention |
| `tracking_keys` | source, prefix/fingerprint, encrypted or one-way secret material, scopes, expiry, rotation/revocation |
| `tracking_plans` | space/source, semantic version, status, compatibility policy, approved event schemas |
| `event_schemas` | event name/version, JSON schema, classification, owner, PII policy, limits, deprecation |
| `raw_events` | immutable accepted envelope, space/source/environment, event ID, identity refs, timestamps, payload, consent, ingest state |
| `event_processing_receipts` | raw event, processor/version, status, attempts, errors, processed time |
| `identity_merge_operations` | source/target profiles, reason, method, actor/source, state, reversal metadata |
| `privacy_requests` | subject scope, request type, verification, state, execution checkpoints, completion proof |
| `dead_letter_events` | bounded redacted failure payload/reference, code, attempts, eligibility, resolution |
| `orchestration_definitions` | trigger, conditions, policy, action graph, approval mode, limits, status/current version |
| `orchestration_runs` | workflow version, trigger event/fact, subject, state, idempotency, decisions, outcome |
| `orchestration_actions` | run, adapter, request snapshot, approval, attempts, provider reference, result, audit |

### 9.6 Storage policy

- PostgreSQL is the production control plane and initial durable event/aggregate store.
- SQLite remains supported for local development and automated tests with explicitly lower volume limits.
- Start with date/time partitioning for production raw events and processing receipts.
- Use append-only raw event rows and immutable journey versions.
- Keep frequently filtered, non-sensitive routing fields as typed columns; bounded event properties may use JSONB.
- Do not index arbitrary JSON properties. Promote approved properties through schema/tracking-plan configuration.
- Store sensitive identifiers encrypted where retrieval is necessary and keyed hashes where equality matching is sufficient.
- Separate raw-event retention from long-lived aggregate retention.
- Prepare an archival interface for object storage before high-volume general availability.
- Treat identity indexes, event partitions, aggregate indexes, and active-request indexes as explicit PostgreSQL contract items with real migration tests.

## 10. Canonical event protocol

### 10.1 Envelope

All SDKs and integrations emit the same protocol. A representative v1 payload is:

```json
{
  "protocolVersion": "1.0",
  "eventId": "018f4d85-4f31-7a1d-9f11-4d4ac3f10f48",
  "event": "workspace_created",
  "eventVersion": 1,
  "occurredAt": "2026-08-04T12:34:56.123Z",
  "anonymousId": "anon_7fdb...",
  "userId": "customer_123",
  "accountId": "company_456",
  "sessionId": "session_789",
  "properties": {
    "workspaceType": "team",
    "source": "onboarding"
  },
  "context": {
    "locale": "en-GB",
    "timezone": "Europe/London",
    "page": { "url": "https://example.com/onboarding", "referrer": "https://example.com/" },
    "device": { "type": "desktop" },
    "library": { "name": "@seemplify/browser", "version": "1.0.0" }
  },
  "consent": {
    "analytics": "granted",
    "personalisation": "unknown",
    "source": "customer_cmp",
    "updatedAt": "2026-08-04T12:30:00.000Z"
  }
}
```

### 10.2 Supported calls

- `track`: behavioural or business event.
- `identify`: associate a verified customer-controlled external ID and approved traits with a profile.
- `alias`/`merge`: deterministic anonymous-to-known association under strict rules; server-only for arbitrary known-to-known merges.
- `group`: associate a profile with an account/organisation and role.
- `page` and `screen`: optional standard navigation events with privacy-safe defaults.
- `consent`: update consent/suppression state independently from behavioural events.
- `metric`: server-only submission of an approved operational measure where raw events are inappropriate.
- `delete` and `suppress`: authenticated server/privacy APIs, not public browser event calls.

### 10.3 Validation and limits

- Required protocol version, event ID, event name, version, occurred time, and at least one permitted subject/session identifier.
- Event names use lower snake case and reserved prefixes are blocked.
- Event and property names, nesting depth, array length, string length, numeric range, total bytes, batch size, and clock skew are bounded.
- Unknown schemas follow the source's configured mode: reject, quarantine, or accept as unplanned with restricted processing. Production default is reject for strict sources and quarantine for migration sources.
- Personally identifying fields are denied unless declared in the schema and source policy.
- URL collection removes query strings/fragments by default and supports allowlisted parameters only.
- SDKs redact common credential/payment fields and support customer-configured deny lists; server validation remains authoritative.
- `eventId` is globally unique within a space/source retention window and is the ingestion idempotency key.
- `sentAt` and server `receivedAt` may be added for delivery-latency diagnostics; `occurredAt` remains the business time subject to skew policy.

### 10.4 Ingestion contract

1. Authenticate key and resolve space/source/environment only from that key.
2. Enforce origin/app identity, source state, plan entitlement, rate limit, and payload byte limit.
3. Parse and validate envelope and event schema.
4. Apply field classification, consent/suppression, and privacy policy.
5. Canonicalise identifiers and derive non-sensitive routing hashes.
6. Durably append accepted or quarantined event and deduplication receipt.
7. Return per-event status for batch calls.
8. Process identity, journey rules, aggregates, and trigger candidates asynchronously.
9. Preserve processing receipts and bounded errors for authorised debugging.

Suggested response semantics:

- `202 Accepted` after durable append for a valid new event.
- `200 OK` with `duplicate: true` for an already accepted event ID.
- `207 Multi-Status` for mixed batch results, with a stable result per input index/event ID.
- `400/422` for protocol/schema failures, `401/403` for key/scope/origin failures, `413` for bytes, `429` for rate/quota policy, and `503` only when durable acceptance is unavailable.

## 11. Identity, consent, and Customer 360 design

### 11.1 Identity rules

- Every event may resolve to an anonymous profile, known profile, account, or session without requiring raw PII.
- Browser/mobile SDKs generate durable anonymous IDs in first-party storage according to consent policy.
- `identify` merges an anonymous profile into a known external ID only when the source is authorised and the external ID namespace is configured.
- Email addresses and phone numbers are not default identity keys. If enabled, normalisation, encryption/hash policy, verification source, consent, and deletion behaviour are explicit.
- Cross-space identity matching is prohibited.
- Known-to-known merge is a server/admin operation with conflict detection and audit.
- Conflicting high-assurance identities stop automatic merge and enter a resolution queue.
- Late and out-of-order events can update historical instances/aggregates within a bounded correction window.
- Merge processing is idempotent and maintains redirect/tombstone records so old internal IDs cannot resurrect duplicates.

### 11.2 Consent and privacy

- Store purpose-specific states such as analytics, personalisation, research contact, and marketing; do not reduce all consent to one Boolean.
- Permit customers to configure lawful-basis/policy metadata without Seemplify asserting legal sufficiency.
- SDKs can buffer or drop events until consent is known; the chosen behaviour is explicit per source.
- Suppression is checked before profile enrichment, segmentation, and orchestration.
- Data subject export includes profile, identities, events in scope, survey links, journey instances, segment memberships, and actions in a portable format.
- Erasure removes or irreversibly anonymises raw identity data and derived personal data, invalidates evidence excerpts where required, and rebuilds affected aggregates when necessary.
- Retention jobs cover raw events, dead letters, debug payloads, identity aliases, profiles, journey instances, and orchestration details independently.
- Consent and privacy changes are propagated using durable jobs with resumable checkpoints and completion audit.

### 11.3 Customer 360 presentation

The profile view must show:

- Identity and consent summary with restricted fields permission-gated.
- Traits with source, confidence, and last updated time.
- Account memberships.
- Segment memberships and why the profile qualifies.
- Current and completed journey instances.
- Chronological interaction timeline across permitted product events, surveys, tickets, social, messages, agreements, and actions.
- Stage transitions, sentiment/score observations, risks, and open recovery/initiatives.
- Source and environment filters, export/privacy state, and complete audit provenance.

It must not imply that a persona is an individual profile or that an inferred trait is verified fact.

## 12. SDK and integration programme

### 12.1 Shared SDK requirements

Every SDK must implement the same conformance contract:

- Protocol versioning and generated types from canonical schemas.
- `track`, `identify`, `group`, consent, reset/logout, flush, and debug hooks appropriate to the platform.
- Stable event ID generation and retry-safe batching.
- Exponential backoff with jitter; respect `Retry-After`.
- Offline queue with bounded storage, expiry, and explicit overflow behaviour.
- Automatic context collection disabled or privacy-minimised by default.
- Configurable property and URL redaction.
- Environment/source isolation.
- Clock, batch, payload, and schema validation before send while server remains authoritative.
- No secrets or raw event bodies in production logs.
- Runtime metrics/callbacks for accepted, rejected, queued, dropped, and retried events.
- Semantic versioning, changelog, deprecation policy, supported platform matrix, and conformance fixtures.

### 12.2 Delivery order

1. **Protocol package and conformance kit**: JSON schemas, examples, test vectors, mock ingest server, golden error responses.
2. **Browser/JavaScript SDK**: framework-independent ESM/CJS/browser builds, consent, first-party anonymous identity, page tracking opt-in, sendBeacon/fetch delivery.
3. **React package**: provider/hooks/error boundary helpers built on the Browser SDK; no separate protocol logic.
4. **Node.js server SDK**: server secret support, batch import, group/verified identity, graceful flush, framework middleware helpers.
5. **React Native SDK**: shared TypeScript core plus native storage/app lifecycle/network awareness.
6. **iOS SDK**: Swift Package Manager, URLSession, Keychain/approved storage, app lifecycle and offline queue.
7. **Android SDK**: Kotlin/Gradle, encrypted/approved storage, WorkManager delivery, app lifecycle and offline queue.
8. **Integration templates/adapters**: webhooks, Segment-compatible destination/source where lawful, CRM/support/data warehouse patterns, and import CLI.

Native SDK work begins only after the protocol, ingestion API, conformance suite, and Browser/Node dogfood prove stable. React Native precedes native SDKs if customer demand and Seemplify product strategy support that order.

### 12.3 Key management

- Public keys use recognisable environment prefixes such as `sp_test_` and `sp_live_` and contain no read privileges.
- Display the secret value only at creation; store fingerprints and protected verification material.
- Server keys have explicit scopes and optional IP/network restrictions.
- Support two active keys during rotation, scheduled expiry, immediate revoke, last-used metadata, and audit.
- Allowed browser origins, mobile bundle/application IDs, SDK names/versions, and environment are enforced where technically reliable.
- Key operations require appropriate space capability; platform support access is separately controlled and audited.

### 12.4 Developer experience

- Guided “Add source” flow with code snippets matched to framework and environment.
- Test mode that shows received, normalised, rejected, quarantined, deduplicated, and processed states.
- Schema/tracking-plan editor with sample payload validation and breaking-change warnings.
- Event catalogue with owners, descriptions, property definitions, PII classifications, volume, last seen, and SDK versions.
- Live debugger payloads are permissioned, redacted, short-retention, and disabled independently.
- Journey stage-rule simulator accepts sample/historical events and explains every match/non-match.
- Copyable curl examples, generated types, quickstarts, sample applications, migration guides, and troubleshooting.

## 13. Application information architecture and primary surfaces

### 13.1 Main navigation

`Journey Management` becomes a capability group with plan-aware children:

- Overview
- Journey maps
- Personas
- Research hub
- Metrics
- Portfolio
- Profiles and accounts
- Segments
- Workflows
- Sources and tracking

Service blueprints are a map type inside Journey maps. Platform/space administration contains entitlements, permissions, templates, event schemas, usage, retention, and operational health.

### 13.2 Journey workspace

The journey workspace should provide:

- Header: name, mode, state, owner, map type, personas, version, freshness, health, permissions, share/export.
- View switcher: Map, Analytics, Actual paths, Evidence, Initiatives, Blueprint, Activity.
- Stage columns and configurable lane rows.
- Card drawer with content, persona applicability, evidence, comments, metrics, ownership, links, and history.
- Filters for persona, segment, cohort, time, channel, map version, and evidence state.
- Current/future comparison and persona comparison.
- AI assistant that proposes a reviewed change set; users accept/reject individual changes.
- Unsupported/stale/contradicted evidence indicators at card, stage, and map level.
- Keyboard-accessible alternatives and a table outline for screen-reader and bulk-edit use.

Default lanes:

1. Stage goal and customer job.
2. Customer actions and decisions.
3. Touchpoints and channels.
4. Expectations and needs.
5. Emotional curve.
6. Evidence and verbatim excerpts.
7. NPS/CSAT/CES and operational metrics.
8. Pain points and moments of truth.
9. Opportunities and solutions.
10. Initiatives and owners.

Blueprint mode adds frontstage, backstage, supporting systems, policies/rules, handoffs, SLAs/costs, and failure/control lanes separated by recognised interaction/visibility lines.

### 13.3 Other primary surfaces

- **Persona library:** cards/table, lifecycle state, owner, evidence coverage, linked journeys, comparison, version/review.
- **Research Hub:** evidence inbox, source filters, synthesis, contradiction/staleness, unlinked evidence, research gaps, exact source viewer.
- **Journey analytics:** health, stage metrics, time trends, cohort comparison, filters, data definitions, freshness.
- **Actual paths:** path flow, funnels, transitions, loops, durations, individual instances subject to permission.
- **Portfolio:** table/board/matrix/tree of pain points, opportunities, solutions, initiatives, journeys, and evidence.
- **Customer 360:** profile/account timeline, journeys, segments, consent, feedback, tickets, messages, and actions.
- **Workflow builder:** trigger, conditions, approval, actions, limits, simulation, versions, runs, outcomes.
- **Tracking:** sources, keys, schemas, debugger, usage, invalid/dead-letter events, SDK setup.

## 14. Public and internal API plan

All APIs are versioned, space-scoped through authentication/key resolution, paginated where collections can grow, protected by consistent idempotency and concurrency contracts, and represented in OpenAPI plus generated SDK types.

### 14.1 Journey design APIs

- `GET/POST /api/journeys`
- `GET/PATCH/DELETE /api/journeys/:journeyId`
- `GET/POST /api/journeys/:journeyId/versions`
- `POST /api/journeys/:journeyId/versions/:versionId/restore`
- `POST /api/journeys/:journeyId/publish`
- `POST /api/journeys/:journeyId/ai/suggestions`
- `POST /api/journeys/:journeyId/ai/suggestions/:suggestionId/apply`
- CRUD/reorder endpoints or a bounded transactional patch protocol for stages, lanes, cards, and links.
- `GET /api/journeys/:journeyId/export?format=pdf|png|pptx|csv|json&view=...`

### 14.2 Persona, research, and portfolio APIs

- CRUD/version/review endpoints for personas and persona links.
- CRUD/version/preview endpoints for segments.
- Evidence search, attach, detach, assess, refresh, and source-view endpoints.
- CRUD/link/score endpoints for pain points, opportunities, solutions, initiatives, metrics, and comments.
- Portfolio query endpoints with filters, saved views, bulk actions, and dependency graph.

### 14.3 Analytics and profile APIs

- Journey/stage metric definitions and observations.
- Funnel, transition, duration, path, cohort, anomaly, and health queries.
- Profile/account search and detail guarded by profile permissions and purpose.
- Journey-instance timeline and transition detail.
- Explain endpoints that return definition, numerator/denominator, filters, time window, source freshness, and lineage for every aggregate.

### 14.4 Developer and ingestion APIs

- `POST /v1/events`
- `POST /v1/batch`
- Server-scoped identity, group, consent, suppress, and privacy endpoints.
- CRUD/rotate/revoke endpoints for sources and keys.
- Tracking-plan and event-schema lifecycle endpoints.
- Test/debug query endpoints with short retention and redaction.
- Dead-letter resolve/replay endpoints with permission and eligibility checks.

### 14.5 Orchestration APIs

- Workflow definition/version CRUD.
- Validate and simulate endpoints.
- Activate, pause, archive, and rollback endpoints with optimistic concurrency.
- Approval inbox and approve/reject endpoints.
- Run/action history, retry/cancel where safe, and outcome endpoints.
- Dry-run webhook/action adapter test endpoints with strong SSRF/secret controls.

## 15. Delivery phases

No calendar duration is committed until team composition and production-volume assumptions are approved. Work is divided into independently verifiable vertical slices. A later phase may begin foundational work early, but no phase is considered complete until its exit criteria pass.

### Phase 0 — Programme foundation and architecture contracts

**Objective:** Freeze terminology, boundaries, privacy posture, target data contracts, migration approach, and measurable non-functional requirements before widening implementation.

**Product/design work**

- Validate jobs-to-be-done with CX managers, researchers, product analytics users, service designers, frontline/service owners, privacy administrators, and developers.
- Produce low- and high-fidelity designs for map, persona, evidence, analytics, portfolio, blueprint, profile, tracking, and workflow surfaces.
- Test map usability with both mouse and keyboard and with large journeys.
- Establish modes, evidence language, metric explainability, and AI suggestion review patterns.
- Approve competitor traceability matrix and non-goals.

**Architecture/data work**

- Publish architecture decision records for event protocol, storage/partitions, identity, consent, tenancy, evidence links, metric formula representation, orchestration, and SDK versioning.
- Define canonical IDs, timestamps, versioning, deletion semantics, and audit events.
- Define journey/persona/research schemas and backwards-compatible migration path.
- Define event load profiles for starter/team/enterprise and internal dogfood.
- Define regional/data-residency boundary and production topology assumptions.
- Prove PostgreSQL partition/index strategy using generated data and actual migrations.
- Confirm SQLite local/test degradation policy.

**Security/privacy work**

- Threat-model public ingestion, key leakage, event poisoning, identity takeover/merge, cross-tenant access, tracking without consent, export, deletion, SSRF/webhooks, workflow abuse, and AI prompt injection through event/evidence content.
- Classify data fields and establish default deny/redaction policies.
- Define data-processing roles and required privacy/security documentation without claiming certifications not obtained.

**Exit criteria**

- Approved domain glossary and UX concepts.
- Approved ADRs and threat model.
- Event protocol v1 and conformance fixtures versioned.
- Migration proof handles legacy journey data without loss.
- Load/storage model and initial SLOs approved.
- Phase feature flags, permissions, entitlements, and audit vocabulary defined.

### Phase 1 — Evidence-backed Journey Map 2.0

**Objective:** Replace the document-like journey editor with a visual, persona-aware, evidence-backed mapping system while preserving every current map and safety guarantee.

**Backend and data**

- Add normalised journey definition/version/stage/lane/card/view/template tables.
- Add personas, persona versions/claims, and evidence-link foundation.
- Add reusable touchpoint/channel catalogue and custom lane definitions.
- Implement additive migration that creates a Journey Map 2.0 version for each legacy journey.
- Preserve legacy IDs, names, stages, provenance, timestamps, version history, AI job links, and exports.
- Map existing stage arrays into default lanes without inventing evidence.
- Keep a read compatibility adapter until all clients and rollback windows expire.
- Add granular capabilities: view, create, edit, publish, template manage, persona manage, evidence attach, export.
- Upgrade AI journey generation/audit schemas to structured suggestions, personas, lanes, and evidence claims.
- AI changes are proposed as diffs and applied only after user review; the current direct replace path is retired after migration.
- Add evidence adapters for existing knowledge citations, surveys/responses/insights, social mentions/intelligence, tickets, assistant artefacts, and agreements.

**Frontend**

- Build stage-column/lane-row visual editor with semantic HTML fallback/table outline.
- Implement drag-and-drop plus keyboard move controls, undo/redo for the active edit session, copy/paste, bulk select/edit, and autosave conflict handling.
- Add persona library and persona selection/comparison.
- Add map-type and mode indicators, evidence badges, exact evidence drawer, research-gap view, and AI suggestion review.
- Add current/future versions and template selection.
- Preserve simple stage detail view for small screens and accessibility.
- Add robust empty, loading, partial, stale, conflict, and failure states.

**Templates**

- Ship reviewed templates for onboarding, purchase, service recovery, renewal, employee onboarding, citizen service, patient access, and a blank service blueprint.
- Let platform administrators publish system templates and space administrators create organisation templates.
- Version templates; creating a map pins the template version and does not silently inherit later changes.

**Evidence behaviour**

- Attach exact source references to any stage/card/reusable item.
- Show source type, excerpt/aggregate definition, population/window, date, confidence, visibility, and freshness.
- Enforce access at read and export time.
- Identify unsupported, contradicted, stale, and inaccessible claims.
- Offer explicit bounded AI synthesis from selected authorised sources only.

**Exports and sharing foundation**

- Continue CSV/JSON compatibility.
- Add server-rendered PDF and PNG based on a saved view.
- Design PPTX export contract; implementation may complete in Phase 3 with presentation views.
- All exports include journey mode, filters, version, generated time, evidence legend, and metric source notes.

**Phase 1 acceptance scenarios**

- A legacy map opens as a Map 2.0 journey with all stages/content and historical snapshots intact.
- A user creates a persona, links it to two maps, edits it once, and sees controlled reuse without changing pinned published versions.
- Two personas can be compared without duplicating the underlying map.
- A pain-point card can cite a knowledge excerpt and a survey response; unauthorised users cannot open either source.
- AI proposes stage/lane changes; accepting one and rejecting another produces a traceable new version.
- A keyboard-only user can create, edit, move, and inspect cards.
- PDF/PNG output matches the selected saved view and labels hypotheses correctly.
- Cross-space IDs, stale optimistic writes, deleted evidence, oversized cards, formula injection, and prompt injection are rejected or safely handled.

**Exit criteria**

- All existing journey tests remain green with migration coverage.
- Visual, accessibility, security, and large-map performance budgets pass.
- No legacy journey data loss in production-like PostgreSQL upgrade/rollback rehearsal.
- Persona, template, evidence, and map permissions/entitlements are enforced in backend and navigation.

### Phase 2 — Live evidence, stage metrics, and Journey Research Hub

**Objective:** Turn maps into living measurement surfaces using existing Seemplify surveys, research, knowledge, social, and service data before requiring external product telemetry.

**Research Hub**

- Build source adapters and a unified evidence search/inbox.
- Add authorised linking, excerpts, classifications, assessments, contradiction detection, freshness policies, and research gaps.
- Add interview/observation/research-note intake through the existing knowledge/document pipeline plus structured metadata.
- Add monitored-source notifications and explicit evidence refresh runs.
- Add research synthesis outputs that retain evidence ledgers and do not overwrite reviewed map content.

**Metric definitions and observations**

- Link surveys and collectors to journey, stage, touchpoint, persona, and segment context.
- Reuse deterministic NPS, CSAT, CES, completion, response, dropout, ticket, and social metrics.
- Define metric formula, source, population, filters, window, aggregation, direction, baseline, and target.
- Materialise stage observations with numerator/denominator/sample and freshness.
- Add custom operational metric import/API with schema and server authentication.
- Build correction/rebuild jobs and provenance from observation to source records.

**Analytics UI**

- Stage metric cards and overlays.
- Emotional/sentiment trend lanes with sample and source.
- Time trend, cohort/segment/persona/channel comparison, and stage health.
- Explain panel for every number.
- Alerts for stale sources, falling metrics, small samples, and contradictory qualitative evidence.
- Evidence coverage map showing which stages/personas lack research.

**Phase 2 acceptance scenarios**

- A survey collector is assigned to onboarding stage 2 and its NPS/CSAT/CES appears with correct sample/window.
- Filtering a journey by persona and date recomputes/display selects matching authorised observations.
- A deleted or corrected response updates derived metrics through an auditable rebuild.
- A social sentiment change is linked to the correct stage without being presented as an individual customer path.
- Every chart value exposes its definition and lineage.
- Small or stale samples display warnings and do not trigger strong evidence automatically.

**Exit criteria**

- Deterministic aggregate parity tests pass against source survey/ticket/social calculations.
- Research Hub access, deletion, and citation tests pass.
- Aggregation freshness and rebuild SLOs pass under agreed Phase 2 load.
- No metric is rendered without source/window/sample metadata.

### Phase 3 — Journey management, collaboration, and portfolio

**Objective:** Move from maps as artefacts to an operating process that prioritises and measures improvement.

**Reusable portfolio model**

- Promote pain points, opportunities, solutions, and initiatives to first-class reusable entities.
- Link one item across multiple journeys/stages/personas and show usage/impact.
- Add configurable scoring and prioritisation.
- Add owner/team, status, priority, due date, dependencies, risk, expected outcome, target metric, and review cadence.
- Reuse/bridge existing assistant actions and service-recovery tickets where appropriate; do not conflate delivery initiatives with individual recovery tickets.

**Collaboration and governance**

- Comments, threaded replies, mentions, watchers, resolution, notifications, and activity.
- Roles/capabilities at space and optionally journey scope: viewer, contributor, editor, approver, manager, administrator.
- Review/approval and publish flow for personas, maps, reusable insights, and future-state recommendations.
- Saved views for executives, researchers, delivery teams, and external read-only audiences.
- Expiring, revocable, permissioned read-only links only after a dedicated security/privacy review.

**Portfolio and reporting UI**

- Table, Kanban, matrix, and relationship/dependency tree.
- Cross-journey occurrence and evidence coverage.
- Initiative progress and before/after metric view.
- Executive dashboard for top pain points, deteriorating journeys, priority initiatives, overdue ownership, and realised outcomes.
- Branded PDF/PNG/PPTX exports and presentation mode from saved views.

**Phase 3 acceptance scenarios**

- One pain point appears in three journeys; editing its canonical description updates current working views while published versions retain snapshots.
- A team prioritises opportunities using configured scoring and converts one to an owned initiative.
- Before/after metric observations show whether the initiative met its declared target without claiming causality.
- A viewer comments but cannot edit; an approver publishes; every action is auditable.
- A revoked shared link immediately loses access.
- A PPTX export includes the selected persona, filters, evidence legend, source notes, and current initiative status.

**Exit criteria**

- Permissions, comments, notifications, approval, sharing, and export security tests pass.
- Portfolio queries meet performance targets at enterprise-sized synthetic volumes.
- Initiative and source deletions preserve valid audit while removing prohibited content.
- Plan entitlements and quotas cover collaborators, shared views/links, exports, and portfolio items.

### Phase 4 — Journey hierarchy and service blueprints

**Objective:** Represent complex ecosystems, linked journeys, handoffs, and operational causes without losing navigability.

**Hierarchy and linking**

- Parent/child macro and micro journeys.
- Variants by persona, segment, product, geography, or channel.
- Stage-to-subjourney drill-down and cross-journey handoffs.
- Journey taxonomy, tags, owners, lifecycle, review status, and health roll-up.
- Cycle/depth/size safeguards and clear handling of shared subjourneys.
- Hierarchy tree, relationship graph, impact traversal, and breadcrumb navigation.

**Service blueprints**

- Blueprint-specific lanes and recognised interaction/visibility boundaries.
- Structured frontstage/backstage activities, people/teams, systems, policies, vendors, controls, SLAs, cost, risk, and failure points.
- Link backstage items to customer-facing touchpoints/pain points and portfolio initiatives.
- Show responsibility and handoff gaps.
- Compare current and future blueprint and measure targeted change.

**Phase 4 acceptance scenarios**

- An enterprise onboarding macro journey links to signup, verification, implementation, and support subjourneys.
- A shared verification subjourney can be reused without cloning and its impact is visible to parents.
- A customer pain point traces to a backstage process, supporting system, owner, SLA, and improvement initiative.
- Hierarchy health rolls up with transparent rules; users can inspect the child values.
- Cycles, inaccessible linked journeys, and cross-space references are rejected.

**Exit criteria**

- Hierarchy/graph correctness and permission-filtering tests pass.
- Large hierarchy and blueprint rendering/performance budgets pass.
- Exports and saved views preserve hierarchy/blueprint context.
- Governance and review workflows cover shared/reused items.

### Phase 5 — Connected journeys, Customer 360, actual paths, and orchestration

**Objective:** Connect real applications and systems, resolve authorised identities, derive actual journey instances and paths, and close the loop safely.

Phase 5 is delivered in controlled subreleases rather than one launch.

#### Phase 5A — Event platform and Web/Node SDK dogfood

- Ship source/key administration, protocol v1, schema registry, tracking plans, ingest API, raw store, processing receipts, debugger, dead-letter flow, metering, and operational dashboards.
- Ship Browser/JavaScript, React, and Node SDKs with conformance suite.
- Instrument Seemplify first using a dedicated production-like source and strict tracking plan.
- Build stage-rule editor/simulator and simple anonymous/profile journey instances.
- Compute stage volume, conversion, drop-off, transition, and time measures.
- Do not activate external orchestration yet.

**5A exit criteria**

- Seemplify dogfood events flow reliably through signup-to-first-value journey.
- Duplicate, late, out-of-order, invalid, over-quota, consent-denied, offline, and rotated-key cases pass.
- Ingest and aggregate SLOs pass load/soak testing.
- Security review of public ingestion and SDK storage passes.

#### Phase 5B — Identity, accounts, segments, and Customer 360

- Add anonymous-to-known identify, deterministic merge, account/group, sessions, and conflict resolution.
- Add dynamic segments and materialisation where needed.
- Add profile/account 360 views, interaction timeline, journey instances, consent/privacy surfaces, export, suppression, and erasure.
- Add correction-window processing after merges and late events.
- Add profile permissions and sensitive-field controls.

**5B exit criteria**

- Merge/undo/conflict and cross-device scenarios pass.
- Export/erasure/suppression propagates through events, profiles, instances, segments, evidence, aggregates, and actions.
- Cross-space and unauthorised-profile enumeration tests pass.
- Customer 360 never exposes data beyond source permissions and declared purpose.

#### Phase 5C — Actual path intelligence

- Add path signatures, flow/Sankey, funnels, loops, stalls, durations, cohort comparison, and unexpected-path detection.
- Add stage-inference recommendations with human review.
- Add anomaly and risk indicators using deterministic/rules-based methods first.
- Add predictive churn/conversion only after data sufficiency, validation, drift monitoring, explainability, and opt-in governance are complete.
- Connect stage metrics and path outcomes to portfolio initiatives.

**5C exit criteria**

- Path calculations match event fixtures and independently computed reference results.
- Filters and identity merges produce reproducible corrections.
- Prediction features abstain on insufficient/out-of-distribution data and expose version/confidence/features/window.
- No path chart implies identity continuity when only aggregate anonymous data exists.

#### Phase 5D — Safe orchestration

- Build workflow definitions, triggers, conditions, simulation, versions, approval, action adapters, retries, idempotency, caps, quiet hours, suppression, and outcome tracking.
- Initial actions reuse Seemplify surveys, service-recovery tickets, assistant actions, internal notifications, and signed webhooks.
- Email/social/external communication remains reviewed unless specifically authorised and bounded.
- Add kill switches at platform, space, workflow, adapter, and profile/consent levels.

**5D exit criteria**

- Dry-run and historical simulation explain why each subject would or would not qualify.
- Duplicate triggers cannot duplicate consequential actions.
- Consent, suppression, frequency, approval, quota, and kill-switch tests pass.
- Provider outage/retry/recovery does not lose or duplicate actions.
- Every action has trigger, workflow version, decision trace, approval, provider result, and outcome audit.

#### Phase 5E — Mobile and integration expansion

- Ship React Native SDK, then native iOS and Android SDKs through their standard package managers.
- Add lifecycle, screen, offline, network, storage, consent, reset/logout, and background-delivery semantics.
- Add approved CRM/support/data warehouse/analytics connectors based on customer demand.
- Publish sample mobile apps and cross-SDK conformance dashboard.

**5E exit criteria**

- All SDKs pass the same golden protocol/error/retry/consent fixtures.
- Mobile offline, app reinstall, logout/reset, background/foreground, clock skew, and upgrade tests pass.
- Store/privacy declarations and documentation match actual collection defaults.
- Connector replay, pagination, deletion, rate-limit, and partial-failure contracts pass.

## 16. Seemplify dogfooding plan

Seemplify uses separate local, automated-test, staging, and production sources. Test events must never enter production analytics. Browser/React SDK calls represent client observations; the Node SDK emits authoritative backend completion/failure facts.

### 16.1 Initial tracking plan

| Event | Authoritative emitter | Prohibited payload examples |
| --- | --- | --- |
| `auth_signup_started` | Browser | Password, full form body |
| `auth_signup_completed` | Backend | Verification token |
| `auth_email_verified` | Backend | Verification link/token |
| `space_created` | Backend | Private member data |
| `onboarding_started` | Browser/backend | Free-text content |
| `onboarding_step_completed` | Backend where possible | Form field values not approved by schema |
| `onboarding_completed` | Backend | Profile free text |
| `ai_chatgpt_connection_started` | Backend/control flow | OAuth codes/tokens |
| `ai_chatgpt_connected` | Backend | Access/refresh tokens |
| `ai_runtime_selected` | Backend | Local secrets |
| `survey_created` | Backend | Survey question text by default |
| `survey_published` | Backend | Survey content/responses |
| `survey_first_response_received` | Backend | Answers or respondent PII |
| `intelligence_requested` | Backend | Prompt/source contents |
| `intelligence_completed` | Backend | Generated report contents |
| `intelligence_failed` | Backend | Raw exception/credential details |
| `knowledge_base_created` | Backend | Document contents |
| `knowledge_document_indexed` | Backend | Extracted text |
| `journey_created` | Backend | Full journey content |
| `social_source_connected` | Backend | OAuth tokens |
| `assistant_mailbox_connected` | Backend | Grant tokens/email bodies |
| `agreement_sent` | Backend | Agreement content/recipient PII beyond approved subject references |
| `agreement_completed` | Backend | Signed file contents |
| `subscription_requested` | Backend | Payment credentials |
| `subscription_activated` | Backend | Billing secrets |
| `feature_limit_reached` | Backend | Sensitive attempted content |

These names follow protocol v1's lower-snake-case grammar. Names and properties are reviewed against actual product taxonomy before publication and then versioned; this table is the starting contract rather than permission for ad hoc collection.

### 16.2 Internal activation journey

```text
Discover and sign up
  -> Verify identity
  -> Create or enter a space
  -> Connect ChatGPT or select an available AI runtime
  -> Create first experience artefact
  -> Collect or connect first evidence
  -> Generate first intelligence
  -> Share, publish, or take an approved action
  -> Return and repeat value
```

The internal programme should answer:

- Signup and verification conversion.
- Time to first space and first value.
- ChatGPT connection start/success/failure and its relationship to activation.
- Survey creation-to-publication and first-response conversion.
- Intelligence completion/failure and subsequent abandonment.
- Feature activation and limit encounters by plan.
- Knowledge, social, assistant, agreement, and journey feature adoption.
- Return and repeat-value indicators.

### 16.3 Dogfood rollout

1. Run protocol/SDK fixtures locally.
2. Collect staging events in observe mode with no identity merge, stage decisions, or actions.
3. Reconcile event facts against authoritative application rows.
4. Audit payload samples and logs for sensitive content.
5. Enable production collection for internal/test accounts only.
6. Publish stage rules in shadow mode and manually validate match traces.
7. Enable aggregate dashboards after reconciliation tolerances pass.
8. Enable one notification-only internal workflow.
9. Enable one human-approved recovery workflow.
10. Publish a dogfood quality report and resolve correctness/privacy defects before design-partner beta.

Dogfood exit requires explainable stage assignment, correct anonymous-to-known merge, no duplicate inflation/action, no sensitive content leakage, acceptable reconciliation, and a trustworthy time-to-first-value dashboard.

## 17. Migration, compatibility, and rollback

### 17.1 Journey Map 2.0 migration sequence

1. **Additive schema:** add new tables/indexes/contracts without altering legacy rows.
2. **Converters:** implement schema-versioned legacy-to-v2 conversion and v2-to-legacy-compatible read representation where needed.
3. **Idempotent backfill:** process bounded per-space batches, deterministic IDs, cursors, counts, checksums, failures, and duration.
4. **Reconciliation:** compare journey/stage/item/version counts, ordering, provenance, timestamps, ownership, field checksums, and export equivalence.
5. **Dual write:** write legacy and v2 representations behind a feature flag while recording divergence.
6. **Shadow read:** build/compare v2 responses without serving them.
7. **Internal cutover:** Seemplify/internal spaces first.
8. **Design-partner cutover:** explicitly enrolled spaces.
9. **Percentage rollout:** eligible spaces with monitored error/divergence.
10. **Default v2:** legacy fallback remains available for the agreed compatibility window.
11. **Cleanup:** only after restore rehearsal, signed migration report, stability window, privacy/retention review, and explicit approval.

Legacy conversion rules:

- Preserve journey ID, space, name, objective, industry, summary, timestamps, provenance, and stage order.
- Give each stage/lane/card a stable deterministic ID.
- Keep legacy `audience` as `legacyAudience`; never silently label it a validated persona.
- Offer an explicit “Convert audience to persona draft” action.
- Convert metric strings to `proposed_measure`, not observed measurements.
- Convert pain point/opportunity/recommended-action strings to draft reusable/local items without evidence.
- Retain old snapshots with `schemaVersion` and converters.
- Do not copy large evidence/event payloads into version snapshots; store immutable references/ledgers.
- Never fabricate historical connected paths. Actual paths begin at valid event import/collection time.

### 17.2 Database delivery contract

Every schema tranche requires:

- Additive checksummed PostgreSQL migration.
- PostgreSQL runtime compatibility/version metadata and deployment contract update.
- SQLite fresh-install and compatibility migration.
- SQLite-to-PostgreSQL migration parity where applicable.
- Idempotency, source precondition, checksum, rollback, least-privilege, and schema-drift tests.
- Actual PostgreSQL upgrade test using production-shaped legacy data and enterprise-sized values.
- Explicit index review: normalised IDs/hashes/bounded columns; never raw unbounded JSON/text in B-tree keys.
- Backup/restore and mixed-version deployment rehearsal.

### 17.3 Event reprocessing compatibility

- Raw events are immutable and retain protocol/schema version.
- Normalisers, identity resolvers, stage rules, metric definitions, and path projections have independent versions/checkpoints.
- New projections may shadow old projections before promotion.
- Reprocessing writes a new labelled projection version; it does not silently rewrite previously published analytics.
- Late-event correction windows and historical-import rules are explicit per source.
- Rollback selects the prior projection/rule version and stops new incompatible processing; it does not delete raw evidence.

## 18. Entitlements, quotas, metering, and permissions

### 18.1 Plan features

Replace the current implicit coupling of Journey Maps to the broad AI-runtime feature with granular features such as:

- `journeyDesign`
- `journeyAi`
- `journeyPersonas`
- `journeyEvidence`
- `journeyTemplates`
- `journeyCollaboration`
- `journeyExports`
- `journeyMetrics`
- `journeyPortfolio`
- `journeyBlueprints`
- `journeyConnected`
- `journeyProfiles`
- `journeyActualPaths`
- `journeyOrchestration`
- `journeyWebSdk`
- `journeyMobileSdk`
- `journeyConnectors`

Manual journey design can therefore remain available when AI is disabled. AI actions continue to require the selected runtime and AI allowance.

### 18.2 Plan quotas

- Total and published journeys.
- Personas and organisation templates.
- Journey collaborators and shared links.
- Event sources, environments, public keys, and server keys.
- Monthly accepted unique events and batch bytes.
- Identified profiles, accounts, and active journey instances.
- Event schemas/properties and mapping rule sets.
- Raw event, debug, dead-letter, profile, and aggregate retention days.
- Metric definitions and refresh frequency.
- Active segments and materialisation frequency.
- Active workflows, monthly workflow runs, and monthly external actions.
- Connector destinations, export jobs, and AI journey actions.
- Storage where independently chargeable/measurable.

### 18.3 Enforcement rules

- Hide disabled navigation and entry points.
- Enforce every feature and quota on the backend atomically.
- Meter accepted unique events, not retries, duplicates, or rejected payloads unless a separately documented abuse allowance applies.
- Maintain an immutable/reconcilable usage ledger and aggregate usage views.
- Display allowance, used, reserved, forecast, reset date, and retention implications.
- Notify at configurable 70%, 85%, 95%, and 100% thresholds without repeated spam.
- Return stable machine-readable errors for disabled/over-limit ingestion and application APIs.
- Define plan-specific overage behaviour: reject, paid overage, or short bounded grace; never silently discard.
- Subscription suspension pauses new ingestion/orchestration according to documented policy without deleting configuration or retained data.
- A retention downgrade previews affected data and uses an audited delayed expiry job.

### 18.4 Downgrade behaviour

- Existing premium objects become read-only for a defined grace period.
- Exports remain available according to policy during the grace period.
- Keys and workflows are paused, not silently deleted.
- Owners receive advance warning and an impact preview.
- Re-upgrade restores retained configuration.
- Destructive retention changes require explicit dates, jobs, audit, and recovery window where feasible.

### 18.5 Space capabilities

- `journeys.read`, `journeys.create`, `journeys.edit`, `journeys.delete`, `journeys.publish`
- `journeys.share`, `journeys.export`, `journeys.comment`
- `journeys.manage_personas`, `journeys.manage_evidence`, `journeys.manage_metrics`
- `journeys.manage_portfolio`, `journeys.manage_blueprints`
- `journeys.view_profiles`, `journeys.export_profiles`
- `journeys.manage_sources`, `journeys.manage_keys`, `journeys.manage_schemas`
- `journeys.manage_identity`
- `journeys.manage_workflows`, `journeys.publish_workflows`, `journeys.approve_actions`
- `journeys.view_audit`

Profile export, raw-event debugging, key management, identity merges, workflow publication, and action approval are separately assignable sensitive capabilities. Platform administration receives corresponding global read/manage/support permissions with break-glass controls and audit.

## 19. Feature flags and kill switches

Recommended progressive flags:

- `journeys_v2_read`, `journeys_v2_write`, `journeys_v2_dual_write`, `journeys_v2_compare_reads`
- `journey_personas`, `journey_multi_persona`, `journey_visual_editor`
- `journey_research_hub`, `journey_evidence_validation`, `journey_templates`, `journey_exports_v2`
- `journey_live_metrics`, `journey_metric_alerts`
- `journey_portfolio`, `journey_collaboration`
- `journey_hierarchy`, `journey_blueprints`
- `journey_event_sources`, `journey_event_ingestion`, `journey_event_processing`
- `journey_identity_resolution`, `journey_customer_360`, `journey_actual_paths`, `journey_ai_path_insights`
- `journey_orchestration_authoring`, `journey_orchestration_execution`
- `journey_mobile_sdks`, `journey_connectors`

Critical server-side kill switches:

- Stop all or selected-source event acceptance.
- Accept durably but pause downstream processing.
- Pause identity merges.
- Pause aggregation/reprojection.
- Disable journey AI inference.
- Pause all, one-space, one-workflow, or one-adapter orchestration.
- Revoke one key/source/connector.
- Force legacy journey reads during the compatibility window.
- Disable public sharing/export generation.

UI flags never substitute for backend enforcement. Flag, entitlement, permission, and kill-switch decisions are included in diagnostic/audit output without disclosing sensitive configuration.

## 20. Security, privacy, compliance, and abuse controls

### 20.1 Required security controls

- TLS in transit and protected storage at rest.
- Space predicate on every control/data-plane record and query; automated cross-space tests.
- Ingestion-only public keys; scoped server secrets; one-time display; fingerprint; expiry; rotation; revoke; last use.
- HMAC timestamp/nonce/body-digest signing for privileged server calls where applicable.
- Origin/app allowlists as abuse controls, never represented as secret protection.
- Per-key/source/space/global rate and byte limits before expensive work.
- Payload depth/size/cardinality limits, decompression-ratio controls, prototype-pollution key rejection, schema validation, and stored-XSS protection.
- No customer identifiers/event payloads in ordinary logs/traces.
- Debug payload redaction and short retention.
- Webhook destination validation, DNS/IP revalidation, redirect policy, private/reserved network blocking, signing, and replay defence.
- Software composition analysis, secret scanning, static analysis, SDK SBOM/provenance/signing where supported.
- Penetration testing before connected-journey and orchestration GA.

### 20.2 Required privacy controls

- Data-protection impact assessment before Customer 360 beta.
- Purpose-specific consent/lawful-policy representation and execution-time recheck.
- Field classification and allowlist/denylist policy in tracking plans.
- IP/user-agent/geolocation policy; raw IP discarded/truncated unless an approved need exists.
- Small-cohort suppression and profile drill-down permissions.
- Retention by data class and environment.
- Profile access, correction, portable export, suppression, deletion, and legal hold where required.
- Deletion lineage across identities, events, instances, segments, evidence excerpts, aggregates, debug/dead-letter, and actions.
- Audit profile access, export, merge/split, deletion, workflow publication, approval, and execution.
- Define regional/data-residency boundaries before advertising locations or compliance.

### 20.3 AI safeguards

- Treat map briefs, events, traits, evidence, and external content as untrusted data, never instructions.
- Deterministic analytics remain outside the language model.
- AI factual output requires valid evidence/aggregate references.
- AI path summaries include cohort/window/sample and cannot invent metrics.
- AI recommendations are suggestions requiring review and measurable success criteria.
- Prediction abstains on insufficient, drifting, or out-of-distribution data.
- Model/action/effort/runtime and prompt/evidence snapshot are auditable under existing AI-runtime controls.

## 21. Testing and quality programme

### 21.1 Unit and property tests

- Domain/schema validation, converters, ordering, permissions, evidence state, scoring, metric formulas, stage matching, transitions, path signatures, and workflow conditions.
- Property-based sequences for event deduplication, out-of-order arrival, identity merge/split, stage transitions, quota concurrency, aggregate correction, and workflow idempotency.
- Formula/parser safety and numeric boundary tests.

### 21.2 Contract and SDK tests

- OpenAPI and JSON Schema compatibility.
- Golden request/normalisation/error/retry/consent fixtures across every SDK.
- Partial batch status and stable machine codes.
- Webhook signature and connector pagination/rate-limit/deletion contracts.
- SDK semantic-version compatibility, bundle size, tree shaking, SSR/Strict Mode, browser/device matrix, offline queue bounds, and host-app failure isolation.

### 21.3 Integration tests

- SQLite and actual PostgreSQL migrations/fresh installs.
- Durable append, worker lease, crash/restart, retry, dead letter, and replay.
- Key issue/rotate/revoke and origin/signature controls.
- Event -> identity -> stage -> instance -> metric -> trigger pipeline.
- Survey/collector -> stage metric, source permission change, evidence deletion, and aggregate rebuild.
- Profile merge/split/export/suppress/delete across every derived store.
- Plan upgrade/downgrade, quota reservation/reconciliation, and retention job.
- Workflow trigger -> approval -> adapter -> outcome including unknown provider result.

### 21.4 End-to-end and visual tests

- Create persona and multi-persona map; edit via mouse and keyboard.
- Attach exact knowledge/survey/social/ticket evidence and verify access changes.
- Generate/review/apply selected AI suggestions.
- Publish, comment, approve, share, revoke, and export.
- Create reusable pain point/opportunity/initiative and inspect portfolio reuse.
- Create hierarchy/service blueprint and follow dependencies.
- Add source/key/schema; send SDK event; inspect debugger; publish rule; view metrics/path/profile.
- Build/simulate/publish workflow; approve action; verify deduplication and audit.
- Browser refresh/race/offline/error states and mobile lifecycle flows.
- Screenshot/visual regression for large maps, paths, blueprints, exports, and responsive layouts.

### 21.5 Accessibility tests

Meet WCAG 2.2 AA for core surfaces:

- Full keyboard operation and visible focus.
- Accessible alternatives to drag-and-drop.
- Semantic stage/lane/table representation.
- Text/tabular alternatives to emotional curves, flow/Sankey, and metric-only visuals.
- Non-colour state indicators, contrast, zoom/reflow, reduced motion, error association, and disciplined live regions.
- Accessible PDF where supported and clear accessibility limitations for other export formats.

### 21.6 Performance and resilience tests

- At least 50 stages/500 cards and large evidence portfolios.
- Enterprise-sized journey/persona/portfolio/hierarchy/profile synthetic datasets.
- Sustained and burst ingestion, large valid batches, source abuse, high-cardinality rejection, long retention, and path/metric query workloads.
- Hundreds of readers and agreed concurrent-edit profile.
- Aggregation/reprojection/export/workflow bursts.
- Worker/database/provider/connector outage, backpressure, disk pressure, clock skew, late events, partial batch failure, key revoke midflight, action timeout, and recovery.
- Disaster recovery, backup restore, projection rebuild, and regional failover assumptions where supported.

### 21.7 Release quality gates

- No critical/high unresolved tenant, privacy, credential, identity, event correctness, or orchestration defect.
- Migration reconciliation is complete for enrolled spaces.
- No acknowledged event loss or duplicate consequential action under failure injection.
- Metric/path golden datasets reconcile.
- Accessibility has no critical issue on required journeys.
- Feature/permission/entitlement enforcement has both positive and negative backend tests.

## 22. Observability, service objectives, and operations

### 22.1 Required telemetry

- Requests, events, bytes, accepted/rejected/duplicate/throttled by source/schema/SDK.
- Ingestion latency, inbox depth/oldest age, processing attempts, dead letters, and projection lag.
- Unknown schema, prohibited field, unmatched stage, and multi-match conflict rates.
- Profiles created, identify/merge/split/conflict, consent blocks, export/deletion backlog.
- Aggregate freshness, reconciliation drift, path computation/query latency, correction/reprojection jobs.
- Workflow evaluations, suppressed/approval-wait/action attempts/success/retry/dead-letter/duplicate prevention/outcome.
- Feature/quota usage/reservations and ledger reconciliation.
- AI model/effort/runtime, success, validation, citation coverage, unsupported-claim rate, and human accept/reject.

Correlate ingest receipt through canonical event, identity, stage assignment, aggregate, workflow, and action without logging customer content.

### 22.2 Initial objectives to ratify in Phase 0

- 99.9% event API availability.
- No acknowledged event loss.
- p95 ordinary-batch acknowledgement below 300 ms under ratified load.
- p95 accepted-event to standard aggregate below 60 seconds during normal operation.
- p95 standard 30-day journey query below 2 seconds for ratified dimensions.
- p95 immediate trigger to action eligibility below 60 seconds, excluding approval/provider delay.
- Zero cross-space disclosure and zero duplicate external actions.

### 22.3 Alerts and runbooks

Alert on error-budget burn, ingestion/schema rejection spike, unusual key traffic, queue/projection lag, dead-letter growth, identity conflicts, unmatched events, metric drift, deletion backlog, orchestration failures, storage/capacity, and quota-ledger drift.

Runbooks cover key compromise/revoke, source pause, invalid release/schema rollback, backlog recovery, dead-letter resolution, identity conflict/split, aggregate reconciliation/reprojection, privacy export/deletion failure, workflow global pause, provider unknown outcome, migration rollback, backup/restore, and incident communication.

## 23. Release and rollout gates

### Internal pre-alpha

Required: Phase 0 contracts, seed/golden data, additive migration, feature flags, threat model, basic diagnostics, no external keys. Exit when backfill is repeatable, tenant tests pass, terminology is approved, and critical incidents have owners/runbooks.

### Internal alpha and dogfood

Required: Journey Map 2.0, evidence links, Browser/React/Node SDK, debugger, stage rules, basic metrics, isolated environments. Exit when activation journey works, reconciliation/privacy audit passes, event loss/identity/duplicate tests pass, and support runs an incident drill.

### Private design-partner beta

Audience: three to five selected customers. Required: security/privacy review, deletion, key rotation, usage/limits, export, support process. Exit when no critical/high issue remains, SLOs hold for four consecutive weeks, at least two customers reach a trustworthy connected journey, and upgrade/downgrade/retention flows pass.

### Public beta

Required: self-service sources, complete SDK docs, capacity/on-call/status process, usage policy and known limitations. Exit when SLOs hold for six consecutive weeks, restore and kill-switch rehearsals pass, penetration/accessibility findings are resolved to policy, costs are understood, and support load is sustainable.

### General availability

Required: production support commitments, stable SDKs, compatibility/deprecation policy, disaster-recovery test, privacy/legal approval, capacity headroom, and complete admin/audit coverage.

GA is declared independently for Journey Design, Evidence/Analytics, Connected Journeys, Customer 360, Mobile SDKs, and Orchestration. Advanced prediction is not required for the earlier capabilities to reach GA.

## 24. Principal risks and mitigations

| Risk | Mitigation |
| --- | --- |
| A visual map is mistaken for observed truth | Designed/evidence-backed/connected modes; card-level evidence states and warnings |
| Legacy stage arrays cannot support stable links | Additive normalised model, deterministic IDs, dual-write/shadow-read and reconciliation |
| A second research system fragments knowledge | Journey Research Hub stores links/assessments; existing Knowledge Graph RAG remains authoritative |
| Public key is copied/abused | Ingestion-only scope, limits, schema, origins/app diagnostics, anomaly detection, rapid revoke |
| Event poisoning misleads analytics | Tracking plans, trust/source labels, field bounds, rule review and data-quality dashboards |
| Duplicate/late events corrupt metrics | Stable event IDs, idempotent processors, event-time windows, correction/reprojection |
| Identity merges combine different people | Authenticated/deterministic links only, conflict queue, merge graph, controlled split/reversal |
| Sensitive data enters events/debug/logs | Default content prohibition, classification, SDK redaction, server enforcement, redacted short-retention debugger |
| High-cardinality/unbounded fields drive cost | Schema classification, approved promoted columns, index/query budgets, cardinality alerts |
| PostgreSQL hot path competes with application OLTP | Partitioning, separate workers/connections, backpressure, measured extraction threshold |
| SQLite diverges from production | Shared contracts plus actual PostgreSQL authority for migration/performance tests |
| Rule changes rewrite history invisibly | Immutable versions, effective dates, shadow projection, labelled explicit reprocessing |
| Analytics implies causation | Deterministic lineage, sample/window, caveats, experiment-aware language |
| External actions duplicate or violate consent | Transactional outbox, action idempotency, execution-time consent, caps, approval, kill switches |
| SDKs drift | One protocol, shared conformance fixtures, generated types, compatibility matrix |
| Downgrade destroys data unexpectedly | Pause/read-only/grace/preview; audited delayed retention jobs |
| Plan checks exist only in UI | Central backend capability/quota enforcement with negative tests |
| AI follows malicious evidence/event text | Treat all input as untrusted; structured schemas; exact citation validation; no tool instructions from evidence |

## 25. Programme workstreams and dependency sequence

| Workstream | Main ownership scope |
| --- | --- |
| Product/research | Jobs, terminology, workflows, templates, design-partner validation, success measures |
| Journey domain | Definitions, versions, stages, lanes, cards, personas, evidence links, hierarchy |
| Visual experience | Editor, analytics, paths, portfolio, blueprints, 360, exports, accessibility |
| Evidence/intelligence | Existing knowledge adapters, Research Hub, citations, synthesis, evidence quality |
| Data platform | Event ingest, durable processing, identity, metrics, path projections, retention |
| Developer platform | Protocol, source/key/schema/debugger, SDKs, examples, release process |
| Action platform | Workflows, approval, adapters, idempotency, suppressions, outcomes |
| Administration/billing | Roles, entitlements, quotas, metering, usage, support and audit |
| Security/privacy | Threat models, consent, classification, profile access, export/deletion, reviews |
| Reliability/QA | Migrations, contracts, performance, resilience, observability, runbooks and releases |

Strict dependency path:

```text
Phase 0 contracts
  +-> stable journey/stage/persona/evidence IDs -> live metrics -> portfolio -> hierarchy/blueprints
  +-> event protocol -> sources/keys/schemas -> durable ingest -> SDK dogfood
  +-> identity/consent -> stage rules/instances -> actual paths/360 -> orchestration
  +-> stable protocol/conformance -> React Native -> iOS/Android/connectors
```

Orchestration cannot precede trustworthy identity/consent, idempotency, stage rules, and audit. Native SDKs cannot precede a stable protocol and conformance suite. Predictive churn cannot precede sufficient validated connected data and drift governance.

## 26. Documentation and enablement deliverables

### Customer documentation

- Designed vs evidence-backed vs connected journeys.
- Personas vs segments vs profiles/accounts.
- Map editor, research/evidence, metrics/calculations, portfolio, blueprints, sharing/export.
- Customer 360, actual paths, workflows, privacy/retention, permissions, plans/limits.

### Developer documentation

- Five-minute Browser, React, Node, React Native, Swift, and Kotlin quickstarts.
- Protocol, event naming, schemas/tracking plans, identity, account/group, consent, batch/retry/offline, environments/debugger.
- Stage-rule examples, testing, webhook signing, imports/connectors, migration guides, sample applications, API reference.

### Operator documentation

- Flags/kill switches, plans/quotas, usage reconciliation, source/key incident response, schema/rejection/dead-letter, reprocessing, migration/rollback, identity conflicts, privacy jobs, workflow pause, backups/restores, capacity, and incident playbooks.

## 27. Definition of programme completion

The full programme is complete when an authorised customer can:

1. Create or AI-generate a visual multi-persona designed journey.
2. Convert it to an evidence-backed journey using exact existing Seemplify evidence without duplicating the knowledge engine.
3. Attach trustworthy NPS/CSAT/CES, sentiment, and operational measures to stages.
4. Manage reusable pain points, opportunities, solutions, and owned initiatives across a portfolio.
5. Link macro/subjourneys and model a complete service blueprint.
6. Install a supported SDK and send versioned, consent-aware events with secure source/key governance.
7. Debug and map those events to published journey-stage rules.
8. See real stage conversion, drop-off, durations, cohorts, paths, and designed-versus-observed differences.
9. Inspect a permissioned Customer/Account 360 timeline with clear fact/inference/evidence distinctions.
10. Detect deterioration, gaps, loops, abandonment, and justified risk indicators.
11. Trigger safe, consent-aware, idempotent, auditable, human-governed recovery actions.
12. Govern the entire capability through roles, plans, quotas, retention, feature flags, audit, observability, and operational runbooks.

## 28. Immediate implementation backlog after plan approval

1. Ratify terminology, five-phase scope, release capabilities, and design-partner profile.
2. Create ADR/RFC set for Map 2.0, evidence, events, identity/consent, metrics, orchestration, and SDK compatibility.
3. Produce threat model and privacy/data classification.
4. Prototype the stage-column/lane-row editor and accessible outline with large-map usability testing.
5. Define normalised Journey Map 2.0 schema and deterministic legacy converter.
6. Build production-shaped PostgreSQL migration/backfill/reconciliation proof.
7. Define persona, evidence-link, metric, and reusable portfolio schemas.
8. Define protocol v1, event taxonomy guide, OpenAPI/JSON Schema, and golden conformance fixtures.
9. Define Seemplify dogfood tracking plan and prohibited property list.
10. Extend entitlements/permissions/quotas and admin UX contracts before exposing new endpoints.
11. Implement Phase 1 behind read/write/dual-write/shadow-read flags.
12. Implement Research Hub adapters against existing systems.
13. Connect surveys/collectors and deterministic metrics to stages.
14. Build sources/keys/schemas/usage, then durable ingest and SDK core.
15. Dogfood, reconcile, audit privacy/security, and only then begin external connected-journey beta.

## 29. Decisions that must be ratified before implementation

The plan makes recommended defaults but the following require recorded product/engineering/security approval:

- Initial target event throughput, retention, profile count, and regional topology by plan.
- Exact customer-facing plan packaging and overage policy.
- Consent purposes and default SDK buffering/drop behaviour before consent.
- Whether public read-only sharing is permitted in the first release.
- Initial profile identifier namespaces and whether verified email hash is permitted.
- Exact late-event correction and historical import windows.
- Whether custom metric formulas use a bounded expression language or selected operators only in the first release.
- First external action adapters and which require mandatory approval.
- When to extract the data plane from the existing backend based on measured thresholds.
- Whether React Native demand justifies delivery before native SDKs; native work remains in full programme scope.
- Export technology/licensing for PPTX and accessible PDF.
- Required data-residency/compliance commitments before external beta/GA.

None of these decisions reduces the agreed complete target; they determine safe defaults and delivery order.

## 30. Repository implementation anchors

Current components to extend rather than replace blindly:

- `backend/src/types.ts`: current Journey/JourneyStage contract.
- `backend/src/database.ts`: current journey persistence, bounded versions, AI applications, optimistic concurrency, and application schema.
- `backend/src/app.ts`: current journey CRUD, AI, history, restore, and CSV/JSON routes.
- `backend/src/aiJobs.ts` and `backend/src/aiSchemas.ts`: current hypothesis-safe generation/optimisation.
- `frontend/src/pages/JourneysPage.tsx`: current stage timeline/editor/evidence warning/history.
- `backend/src/knowledgeRepository.ts`, `knowledgeContext.ts`, `knowledgeRoutes.ts`, and `deepAnalysis.ts`: existing evidence and deep-analysis foundation.
- `backend/src/intelligence.ts`: existing cross-source evidence snapshots and citation validation.
- `backend/src/analytics.ts`, surveys, collectors, responses, recovery tickets, social intelligence, assistant actions, and agreements: source adapters and deterministic measures/actions.
- `backend/src/subscriptionEntitlements.ts`, platform admin plan pages, spaces, roles, and audit: entitlement/governance foundation.
- `backend/src/events.ts`: current in-process UI Server-Sent Events bus only; **do not reuse it as customer telemetry ingestion**.
- `scripts` PostgreSQL migration/runtime compatibility tests: required pattern for every schema tranche.

## 31. Research references

- [XEBO.ai Customer Journey Mapping](https://www.xebo.ai/customer-journey-mapping)
- [XEBO.ai AI-powered journey mapping overview](https://www.xebo.ai/blog/transform-customer-experiences-with-ai-powered-journey-mapping-with-xebo-ai)
- [XEBO.ai Experience Management](https://www.xebo.ai/experience-management-solution)
- [Qualtrics XM Directory](https://www.qualtrics.com/support/iq-directory/getting-started-iq-directory/getting-started-with-iq-directory/)
- [Qualtrics Customer Journey Optimizer overview](https://community.qualtrics.com/basecamp-wednesdays-78/understanding-the-customer-journey-optimizer-basecamp-wednesdays-july-19th-2023-24035)
- [Smaply Journey Maps](https://www.smaply.com/tools/journey-maps)
- [Smaply Portfolio Management](https://www.smaply.com/tools/portfolio)
- [UXPressia customer experience mapping platform](https://uxpressia.com/)
