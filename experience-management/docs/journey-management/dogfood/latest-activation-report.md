# Seemplify activation dogfood reconciliation report

Generated at: 2026-08-06T01:23:53.707Z

## Summary

- Accounts: 2
- Email verified: 2
- Onboarding completed: 2
- Owned space created: 2
- ChatGPT connected: 0
- ChatGPT selected: 0
- Survey created in owned space: 1
- Journey created in owned space: 0
- Subscription requested: 0
- Subscription activated: 0

## Caveats

- Survey and journey milestones are reconciled at the owned-space level where legacy tables do not retain a direct creator user for every artifact.
- ChatGPT connection and runtime-selection proof depends on platform_audit_events actions emitted by current AI runtime routes; older connections made before this audit hook may be absent.
- Onboarding and explicit workspace-creation milestones prefer authoritative platform_audit_events when present and fall back to durable account/space records for older histories.
- This artifact is for internal Seemplify dogfood evidence only and is not customer telemetry ingestion.

## Per-account evidence

### Workspace admin <admin@seemplify.local>

- User ID: 427cb98d-583d-439a-ad85-f1d1f3fb5db0
- Owned space: Workspace's space (7fd9298b-4fc9-4836-8195-38ccc95e00d7)
- Account created: 2026-07-29T08:54:03.902Z
- Email verified: 2026-07-29T08:54:03.902Z
- Onboarding completed: 2026-07-29T08:54:03.902Z
- Space created: 2026-07-30T01:03:38.241Z
- ChatGPT login started: —
- ChatGPT connected: —
- ChatGPT selected: —
- Local runtime selected: —
- Survey created (space scope): 2026-07-29T14:19:48.779Z
- Survey published (space scope): 2026-07-29T17:38:33.399Z
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Obiageli Egbo <michaelegbo@gmail.com>

- User ID: 5f2236a7-9f22-4e23-9fab-d9f80a2de036
- Owned space: Obiageli's space (e930f451-8658-46b2-a962-04314a9be1d4)
- Account created: 2026-07-29T22:30:12.936Z
- Email verified: 2026-07-29T22:30:12.936Z
- Onboarding completed: 2026-07-29T22:30:12.936Z
- Space created: 2026-07-30T01:03:38.242Z
- ChatGPT login started: —
- ChatGPT connected: —
- ChatGPT selected: —
- Local runtime selected: —
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

