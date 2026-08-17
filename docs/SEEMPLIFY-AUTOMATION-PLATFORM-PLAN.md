# Seemplify Platform Automation Plan

**Status:** Foundation implemented and locally accepted on 2026-08-17; staged product/provider rollout remains
**Scope:** Every Seemplify product, the Workspace surfaces, public developer
integrations, and external providers
**Companion plans:** `AI_AUTOMATION_ROADMAP.md` and the Experience Management
orchestration safety ADR

## Implementation snapshot

The first platform tranche now exists in `automation-hub/` with the catalogue,
semantic compiler, immutable workflow versions, exact approvals, execution
engine, retries/reconciliation, audit, administration UI, signed product
adapters, webhook APIs, command registry, and Nango connection boundary.

Identity, Payroll, Leave, and Time contain the first target-side authorization
and authoritative-action contracts. Gmail and Google Drive are the first
reviewed Nango-backed adapters. The local full browser journey and focused
contract suites are recorded in `AUTOMATION-HUB-ACCEPTANCE-2026-08-17.md`.

The catalogue intentionally describes more of the destination architecture
than is enabled in production. A product or provider is enabled only after its
own target adapter, scopes, conformance tests, deployment secrets, and
authenticated production acceptance are complete.

## 1. Outcome

Build one organization-scoped automation platform in which every Seemplify
product can publish authoritative domain events and expose bounded actions.
Workflows may connect internal products to each other or connect Seemplify to
external services, but a connection is valid only when the sequence represents
a legitimate business process.

The platform must provide:

- native triggers and actions across Messaging, Boards, Notes, Pages, Identity,
  Recruiter, Leave, Performance, Payroll, Time and Attendance, Approver,
  Learning, Experience Management, AI Interview, and future products;
- manual, command, form, schedule, event, and webhook triggers;
- conditions, typed variables, branches, waits, approvals, caps, and outcomes;
- external account connections through a replaceable connector adapter, with
  Nango as the initial candidate;
- public APIs, incoming webhooks, event subscriptions, application installs,
  bot identities, commands, and eventually a developer marketplace;
- simulation, immutable workflow versions, run history, reconciliation,
  auditing, pause controls, and kill switches.

This is not an arbitrary graph that permits any event to invoke any endpoint.
It is a typed and policy-checked business workflow system.

## 2. Non-negotiable model

### 2.1 Domain products remain authoritative

Each product owns its records, state machine, invariants, and final state
transitions. The Automation Hub coordinates work but does not directly mutate a
product database or invent a domain outcome.

Examples:

- Payroll alone decides whether a payroll run satisfies the preconditions for
  finalization.
- Leave alone records whether a leave request is approved.
- Identity alone grants organization membership and application access.
- Recruiter alone changes a candidate's authoritative pipeline stage.
- Boards may track a task associated with a payroll exception, but moving that
  card to Done cannot finalize payroll.
- Messaging may present an approval card, but a message, emoji, or channel
  membership is never itself the authoritative approval record.

### 2.2 Events are facts; actions are requested effects

- A **domain event** is an immutable, past-tense fact such as
  `payroll.run_ready_for_review` or `leave.request_submitted`.
- A **trigger** selects an event, time, manual invocation, form, or webhook that
  may start a workflow.
- A **condition** evaluates typed facts without changing state.
- An **action** requests a bounded operation from the product that owns it,
  such as `payroll.finalize_run` or `workspace.send_message`.
- An **approval** authorizes one exact proposed consequential action; it is not
  a notification and does not itself apply the domain transition.
- A **notification** informs a person or channel. It cannot stand in for an
  action, approval, or confirmed outcome.
- An **outcome event** records what the authoritative product actually did.

### 2.3 Surfaces do not become authorities

Messaging, Boards, Notes, Pages, email, and external chat products are useful
interaction surfaces. They may display status, collect input, and invoke an
authorized command. They do not become alternate systems of record for
Payroll, Leave, Identity, Performance, or other domains.

## 3. Platform architecture

```text
Seemplify products
  -> transactional outboxes
  -> canonical event stream
  -> Automation Hub trigger evaluator
  -> semantic compiler and execution-time policy checks
  -> approval control when required
  -> internal product adapter or external connector adapter
  -> authoritative product/provider outcome
  -> outcome event, run history, audit, and reconciliation

Seemplify Identity
  -> organization, membership, role, application access, service identity
  -> checked at authoring, publication, invocation, and execution
```

The Hub owns workflow definitions, versions, runs, attempts, waits,
suppression, approvals, connection references, and audit. It stores references
to product entities rather than copying their authoritative state unnecessarily.

External connectors never call product databases. They enter through signed
ingress or invoke scoped action APIs through the Hub.

## 4. Typed automation catalogue

Every product publishes versioned trigger and action descriptors to one shared
catalogue.

### 4.1 Event descriptor

An event contract declares at least:

- event name and schema version;
- owning product and environment;
- organization, actor, subject type, subject ID, and subject revision;
- occurrence time, event ID, correlation ID, and causation ID;
- typed payload and data-classification metadata;
- whether the event is eligible for external subscriptions;
- retention, redaction, and volume characteristics;
- conformance fixtures and compatibility policy.

Organization scope comes from trusted service identity and claims, not from an
untrusted request body.

### 4.2 Action descriptor

An action contract declares at least:

- action name, schema version, and owning product;
- typed input and output schemas;
- supported subject types and valid source states;
- required user, service, and application scopes;
- preconditions and authoritative effects;
- risk class and approval policy;
- maker-checker or separation-of-duty requirements;
- idempotency contract and request expiry;
- retry classification and unknown-outcome reconciliation;
- compensating action where a safe one exists;
- data classifications permitted to cross an external boundary;
- test fixtures for success, rejection, stale state, duplicate delivery, and
  unauthorized invocation.

### 4.3 Risk classes

| Class | Typical effect | Default policy |
|---|---|---|
| R0 | Read, search, or private preview | Permission check and audit |
| R1 | Reversible internal update or notification | Bounded automation allowed |
| R2 | Externally visible message, record creation, or broad internal change | Explicit admin enablement, caps, and audit; approval where policy requires |
| R3 | Payroll, identity, employment, leave, performance, money, deletion, or other consequential change | Exact approval, separation of duties where applicable, execution-time revalidation, and immutable audit |

Organizations may impose stricter policies but cannot weaken mandatory platform
controls for R3 actions.

## 5. Semantic workflow compiler

The builder must not offer a flat list of every action after every trigger. It
shows compatible next steps and explains why an incompatible step is
unavailable.

Before publication, the compiler verifies:

1. Trigger outputs satisfy the next step's typed inputs or have an explicit,
   validated mapping.
2. The subject type and current lifecycle state can legally enter the action.
3. Every step remains in the authenticated organization unless a reviewed
   external boundary is explicit.
4. The workflow author and runtime identity hold the necessary product and
   action scopes.
5. R2/R3 actions have the required approval, purpose, caps, recipients, and
   separation of duties.
6. Sensitive data is minimized and permitted for the destination.
7. Every external action has an installed connection with sufficient scopes.
8. Branches have defined fallbacks and waits have expiry behavior.
9. Cycles have explicit bounded termination; self-triggering message or update
   loops are rejected.
10. Duplicate effects are protected by stable idempotency keys.
11. An approval is bound to one exact action payload and entity revision, not
    used as a generic `approved = true` variable.
12. The declared success outcome is emitted by the authoritative target rather
    than inferred from an HTTP acceptance or notification.

Compilation proves structural eligibility, not future authorization. Runtime
checks still fail closed.

## 6. Execution-time policy

Immediately before each effect, the Hub and target adapter recheck:

- active workflow version, entitlement, and all kill switches;
- organization, service identity, user role, delegation, and application access;
- current subject revision and lifecycle state;
- consent, suppression, purpose, recipient scope, quiet hours, and frequency
  caps where applicable;
- connection status and currently granted external scopes;
- approval status, payload hash, subject revision, approver eligibility, and
  expiry;
- idempotency history and any earlier unknown provider outcome;
- quotas and provider rate limits.

An accepted queue request is not treated as a completed business outcome.
Unknown external effects enter reconciliation rather than blind retry.

## 7. Approval semantics

### 7.1 Approval is a control object

Every approval records:

- approval ID, organization, purpose, and risk class;
- exact subject reference and revision;
- exact proposed action and canonical payload hash;
- requester and runtime identity;
- eligible approver policy and separation-of-duty rules;
- evidence and human-readable consequence summary;
- requested, expiry, decision, and superseded timestamps;
- authenticated decision actor, decision, and required rationale;
- status: pending, approved, rejected, expired, superseded, or cancelled.

Approver can provide the shared inbox and decision experience. The target
product still revalidates the approval and applies its own transition.

If the subject or proposed payload changes, the approval becomes stale and a
new request is required.

### 7.2 Messaging approval cards

Messaging may show a private or appropriately scoped card containing the
summary, evidence link, status, and a route to Approver or the owning product.
An inline Approve button is allowed only as an authenticated client for the
same decision endpoint. It must recheck the viewer's organization, role,
delegation, separation of duties, subject revision, and confirmation. High-risk
policy may require step-up authentication or force the user into the full
review screen.

The following never count as approval:

- posting "approved" in a channel;
- an emoji reaction;
- moving a Board card;
- editing a Note or Page;
- an external Slack/Teams response without a verified Seemplify decision;
- a workflow author approving their own protected request where maker-checker
  is required.

### 7.3 Valid payroll example

Use explicit states rather than an ambiguous `payroll complete` event:

```text
payroll.run_calculated
  -> Payroll validates totals, exceptions, period, and employee coverage
payroll.run_ready_for_review
  -> Automation Hub creates approval for the exact run revision and totals hash
approval.requested
  -> Approver inbox plus a private Messaging notification/card
approval.approved
  -> Hub requests payroll.finalize_run with approval ID and idempotency key
  -> Payroll rechecks run revision, totals hash, reviewer authority, and state
payroll.run_finalized
  -> publish payslips and send bounded private notifications
```

If rejected, Payroll returns the run to its defined review/correction state. If
the calculation changes, the previous approval is superseded. A channel
notification never marks the run final.

## 8. Valid cross-product recipes

These are curated starting points, not permission bypasses.

### 8.1 Messaging reaction to Board task

```text
workspace.message_reaction_added(:eyes:)
  -> verify the reactor can create in the selected Board
  -> boards.create_card with message permalink and bounded excerpt
  -> workspace.reply_in_thread with the authoritative card link
```

This is a reversible R1 flow. It must exclude bot-produced reactions or carry a
causation marker to prevent loops.

### 8.2 Board completion to project communication

```text
boards.card_moved(status = done)
  -> verify the card belongs to a configured project mapping
  -> workspace.send_message to the mapped project channel
  -> pages.append_activity only when the page mapping and writer scope exist
```

The Board state is authoritative for the task only, not for an HR, payroll, or
identity record linked to that task.

### 8.3 Employee onboarding

```text
identity.employee_membership_activated
  -> confirm application grants and onboarding template
  -> workspace.create_or_assign_channels
  -> boards.create_onboarding_board
  -> pages.create_onboarding_page
  -> learning.assign_required_courses
  -> notify employee and accountable owners
```

Identity activation must already be authoritative. The workflow cannot create
membership from a chat message without the separate authorized identity action
and its required approval.

### 8.4 Leave request

```text
leave.request_submitted
  -> create or use Leave's exact approval control
  -> notify eligible manager privately
approval.approved
  -> leave.record_decision after current-balance and policy recheck
leave.request_approved
  -> time.block_expected_absence
  -> calendar.create_event when enabled
  -> workspace.send_bounded_team_notice without private leave details
```

Calendar or Messaging failures do not reverse an approved Leave decision. They
are separately retryable side effects.

### 8.5 Candidate hired

```text
recruiter.candidate_marked_hired
  -> require the configured hiring and identity-provisioning policy
  -> create an identity-provisioning request rather than directly granting access
  -> authorized identity action activates membership and app grants
  -> identity.employee_membership_activated starts onboarding
```

This preserves Recruiter as hiring-record authority and Identity as access
authority.

### 8.6 Page publication to external knowledge system

```text
pages.page_published
  -> verify publication classification permits external transfer
  -> select an installed Google Drive or Notion connection
  -> create/update the mapped external document using an idempotent mapping
  -> store provider reference and emit sync outcome
```

Private, restricted, or HR-sensitive Pages fail closed unless an explicit
policy permits that destination.

## 9. Invalid flows the platform must reject

- `message.posted("approved") -> payroll.finalize_run`
- `reaction_added(:white_check_mark:) -> leave.record_decision`
- `boards.card_moved(done) -> identity.terminate_employee`
- `external.slack_message -> performance.publish_rating`
- `pages.page_updated -> identity.grant_application_access`
- `payroll.run_finalized -> request approval for that same finalization`
- any flow that copies private message or employee content to an external
  provider without an allowed purpose and data classification;
- any flow whose own output immediately retriggers itself without a bounded,
  explicit loop policy.

The builder displays the rejection reason and the valid control that would be
required; it does not silently alter the workflow.

## 10. Invocation surfaces and commands

All surfaces call the same action catalogue and policy engine:

- slash commands and Messaging message actions;
- buttons, forms, workflow cards, and contextual menus;
- Board, Note, and Page automation panels;
- schedules and domain events;
- incoming webhooks and public API calls;
- external provider triggers;
- approved assistant proposals.

Core Seemplify commands are registered by default and remain role-scoped.
External commands appear only after an administrator installs the application,
approves scopes, selects allowed users/channels, and a user or organization
connects the provider.

A sensitive command such as `/finalize-payroll` does not bypass the workflow.
It can open the authoritative review, request approval, or invoke the exact
protected action when all controls are already satisfied.

## 11. External connections

Use a provider-neutral `ConnectionAdapter` contract. Nango is the initial
candidate for external OAuth, token refresh, API proxying, syncs, webhooks, and
actions, but workflows store Seemplify action/trigger IDs rather than Nango
implementation IDs.

Connection records distinguish:

- user-delegated versus organization/service connections;
- provider account, owner, organization, environment, and granted scopes;
- permitted actions, subjects, destinations, and data classifications;
- connection state, expiry/revocation, and last verified time;
- secret reference only; plaintext credentials never enter product databases,
  workflow definitions, logs, or chat.

Gmail connection is for a user's or organization's mailbox automation. It does
not replace Seemplify's transactional mail server.

Zapier and Pipedream may later consume the same public APIs and event
subscriptions. They are bridges and distribution channels, not the source of
truth for workflow policy or audit.

## 12. Native developer platform

The platform foundation precedes the marketplace UI and includes:

- versioned public action/resource APIs with idempotency;
- channel- or application-bound incoming webhooks with opaque credentials,
  rotation, revocation, quotas, and audit;
- signed event subscriptions with subscribe/unsubscribe lifecycle, retries,
  dead letters, and replay protection;
- application registration, OAuth clients, redirect URIs, scopes, installations,
  bot/service identities, commands, and interactive callbacks;
- developer test organizations, sample payloads, conformance fixtures,
  webhook debugger, delivery history, and OpenAPI/SDK publication.

A marketplace later adds discovery, review, approval, distribution, plans, and
possibly billing. It is not a prerequisite for the underlying app model.

## 13. Delivery phases

### Phase 0: Semantic catalogue and state machines

1. Name a domain owner for every participating product.
2. Inventory each product's authoritative state machine.
3. Select the first versioned events and actions with schemas, preconditions,
   effects, scopes, risk, approval, idempotency, and tests.
4. Record the mandatory approval and data-boundary matrices.
5. Select a small set of curated end-to-end recipes with product-owner signoff.

Exit gate: no event or action enters the shared catalogue without an owner,
contract, risk class, and conformance fixtures.

### Phase 1: Platform foundation

1. Build the canonical event envelope and shared transactional-outbox adapter.
2. Build the Automation Hub catalogue, compiler, immutable workflow versions,
   runs, attempts, waits, and outcome ledger.
3. Implement Identity-derived service authorization and organization binding.
4. Implement the exact approval object, Approver adapter, maker-checker rules,
   stale-decision handling, and execution-time revalidation.
5. Implement internal signed ingress and bounded product action adapters.

Exit gate: crash-boundary tests, duplicate delivery, stale approval,
cross-tenant denial, unauthorized action, invalid state, and loop rejection pass.

### Phase 2: Curated internal automation

1. Ship native adapters for Messaging, Boards, Notes, Pages, Identity, and the
   first selected business products.
2. Release only reviewed templates such as reaction-to-task, onboarding, Leave,
   and Payroll review/finalization.
3. Add run history, pause, retry/reconcile, and platform/product kill switches.
4. Verify each real business action in authenticated browser acceptance, not
   only transport tests.

Exit gate: product owners confirm that successful runs match authoritative
domain state and that partial side-effect failures remain truthful.

### Phase 3: Native builder and surfaces

1. Add trigger/action discovery with compatibility filtering and explanations.
2. Add forms, buttons, branches, waits, approvals, schedules, variables,
   simulation, draft/publish, versioning, and rollback.
3. Add Messaging commands and contextual actions plus automation panels in
   Boards, Notes, and Pages.
4. Add admin controls for authors, publishers, actions, connections, quotas,
   and data boundaries.

Exit gate: nontechnical users can build only semantically valid workflows and
can understand every suppressed, pending, rejected, or failed step.

### Phase 4: External connections

1. Prove the replaceable connection contract with Nango in development.
2. Start with narrowly scoped Gmail, Google Calendar/Drive, Slack, Teams, and
   Notion connections based on customer demand.
3. Complete provider OAuth verification and least-privilege review.
4. Add external trigger normalization, action reconciliation, provider caps,
   redaction, and connection administration.

Exit gate: provider revocation, rate limits, duplicate callbacks, unknown
outcomes, data-boundary denial, and connection-owner removal are tested.

### Phase 5: Public developer platform and marketplace

1. Publish stable APIs, event subscriptions, app registration, scopes, bot
   identities, commands, test tools, and documentation.
2. Publish official Zapier/Pipedream integrations only against those contracts.
3. Add marketplace discovery and review after installation and permission
   governance are proven.

Exit gate: an external developer can build, test, install, rotate, revoke, and
operate an app without privileged database or infrastructure access.

## 14. Verification matrix

Every release tranche must include:

- schema and compatibility contract tests;
- valid and invalid workflow compilation fixtures;
- every domain state transition's positive and negative precondition tests;
- organization isolation and application-scope tests;
- maker-checker, stale approval, expired approval, superseded payload, and
  unauthorized inline-decision tests;
- duplicate event/action and crash-at-every-boundary failure injection;
- event causation and infinite-loop prevention tests;
- external revocation, throttling, timeout, malformed callback, and unknown
  outcome reconciliation;
- PII/data-classification redaction and external-boundary negative tests;
- simulation-versus-live policy parity;
- authenticated browser acceptance of the real product action and authoritative
  resulting state;
- queue, latency, failure, suppression, approval-age, and dead-letter
  observability with no sensitive content in telemetry.

## 15. Definition of done for a workflow recipe

A recipe is not complete merely because every HTTP call returns success. It is
complete only when:

1. Product owners approve the business sequence and state names.
2. Every trigger is an authoritative fact or explicit invocation.
3. Every action has valid preconditions, scopes, risk, approval, idempotency,
   and a defined owner.
4. Messaging, Boards, Notes, Pages, and external tools are used only for the
   authority they actually possess.
5. Partial failure and rejection preserve truthful domain state.
6. The final outcome is confirmed by the authoritative product/provider event.
7. Audit can explain who or what caused every decision and effect.
8. Simulation, automated contracts, failure injection, and authenticated
   acceptance all pass.

## 16. Decisions and gates remaining for staged rollout

- Name the platform owner and domain owner for each product adapter.
- Approve the first event/action catalogue and curated recipes.
- Decide which existing product approvals standardize through Approver first.
- Ratify the R0-R3 matrix, mandatory maker-checker rules, and step-up policy.
- Select the first external providers after an OAuth/security review.
- Ratify self-hosted Nango for the initial production connector boundary after
  the deployment proof of isolation, revocation, action coverage, maintenance,
  and cost. The implementation keeps this adapter replaceable.
- Approve the public developer platform and marketplace as separate releases.
