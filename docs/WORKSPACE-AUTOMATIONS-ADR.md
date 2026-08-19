# Workspace Automations architecture decision

**Decision date:** 2026-08-19  
**Decision:** Automations is part of Workspace, not a standalone application.

## Product boundary

Workspace owns the Automation Center, workflow definitions and versions, run
state, waits, approvals, audit history, commands, developer applications,
connector references, and orchestration worker. Automations inherits the
Workspace entitlement and organization context. It has no separate app card,
plan toggle, OIDC client, login, frontend, hostname, database, or deployment.

Every Seemplify product remains authoritative for its own consequential state.
Leave records leave decisions, Payroll finalizes payroll, Time & Attendance
records expected absence, and Identity owns membership and access. Workspace
invokes those bounded APIs using per-product HMAC keys, idempotency keys,
replay protection, exact human approval context, and execution-time product
validation.

## Internal automation surface

The shared catalogue covers Messaging and threads, Pages, Notes, Boards and
work items, Calendar events, Identity membership and teams, Leave, Payroll,
Time & Attendance, Recruiter, Performance, and Learning. Native Workspace CRUD
paths publish durable organization-scoped events into the same engine used by
product outboxes.

Messaging is the primary interaction surface. Workflows can post messages and
thread replies, create channels, share Workspace resources, notify Identity
teams, and present approvals. Pages and Notes can be created or updated; Boards
and work items can be created, updated, and commented on; Calendar events can
be created, updated, and cancelled.

The former board-only rule builder and routes are retired. Boards link to the
same Automation Center used by Messages, Pages, Notes, and Calendar.

## External connectors

The workflow engine is provider-neutral. Nango initially supplies OAuth
connection and proxy infrastructure only. Connection records contain provider
and scope metadata, never provider credentials. External actions are
allow-listed per connection and executed by the same durable Workspace run
engine. This boundary can later target another self-hosted connector runtime
without moving workflows out of Workspace.

## Deployment contract

Product outboxes deliver to
`https://api-workspace.seemplifyai.com/api/internal/events`. Identity delivers
automation-eligible lifecycle events to
`https://api-workspace.seemplifyai.com/hooks/identity`. Workspace mounts the
separate Identity, Leave, Payroll, Time, and Recruiter automation keys and the
Nango API key from `/opt/seemplify/secrets/workspace-automation`.

Deployment must preserve exact-main revision verification, signed ingress
tests, target action contract tests, and an authenticated browser acceptance
pass through Workspace `/automations`.
