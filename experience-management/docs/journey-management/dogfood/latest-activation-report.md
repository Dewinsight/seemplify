# Seemplify activation dogfood reconciliation report

Generated at: 2026-08-06T21:56:53.076Z

## Summary

- Accounts: 91
- Email verified: 78
- Onboarding completed: 61
- Owned space created: 89
- ChatGPT connected (audited): 1
- ChatGPT selected (audited): 1
- ChatGPT connected (current runtime): 1
- ChatGPT selected (current runtime): 1
- Stored ChatGPT runtime preference: 0
- Codex runtime home present: 2
- Codex auth file present: 1
- Survey created in owned space: 7
- Journey created in owned space: 1
- Subscription requested: 3
- Subscription activated: 0

## Caveats

- Survey and journey milestones are reconciled at the owned-space level where legacy tables do not retain a direct creator user for every artifact.
- ChatGPT connection and runtime-selection proof depends on platform_audit_events actions emitted by current AI runtime routes; older connections made before this audit hook may be absent.
- Current runtime-connected signals come from live getAiProviderState resolution and may diverge from the audited event trail when a different ChatGPT gateway instance handled sign-in.
- Stored runtime preferences and Codex runtime-home/auth-file presence are supportive local signals only; they are not treated as equivalent to a fresh audited ChatGPT connection event.
- Onboarding and explicit workspace-creation milestones prefer authoritative platform_audit_events when present and fall back to durable account/space records for older histories.
- This artifact is for internal Seemplify dogfood evidence only and is not customer telemetry ingestion.

## Per-account evidence

### Fair A <fair-a@example.test>

- User ID: fair-a
- Owned space: None
- Account created: 2026-07-01T09:00:00.000Z
- Email verified: —
- Onboarding completed: —
- Space created: —
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Fair B <fair-b@example.test>

- User ID: fair-b
- Owned space: None
- Account created: 2026-07-01T09:00:00.000Z
- Email verified: —
- Onboarding completed: —
- Space created: —
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Workspace admin <admin@seemplify.local>

- User ID: 427cb98d-583d-439a-ad85-f1d1f3fb5db0
- Owned space: Workspace's space (7fd9298b-4fc9-4836-8195-38ccc95e00d7)
- Account created: 2026-07-29T08:54:03.902Z
- Email verified: 2026-07-29T08:54:03.902Z
- Onboarding completed: 2026-07-29T08:54:03.902Z
- Space created: 2026-07-30T01:03:38.241Z
- ChatGPT login started (audited): 2026-08-06T19:19:08.333Z
- ChatGPT connected (audited): 2026-08-06T21:33:49.416Z
- ChatGPT selected (audited): 2026-08-06T21:49:12.139Z
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: yes
- Codex auth file present: yes
- Survey created (space scope): 2026-07-29T14:19:48.779Z
- Survey published (space scope): 2026-07-29T17:38:33.399Z
- Journey created (space scope): 2026-07-29T14:24:37.551Z
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 5

### Obiageli Egbo <michaelegbo@gmail.com>

- User ID: 5f2236a7-9f22-4e23-9fab-d9f80a2de036
- Owned space: Obiageli's space (e930f451-8658-46b2-a962-04314a9be1d4)
- Account created: 2026-07-29T22:30:12.936Z
- Email verified: 2026-07-29T22:30:12.936Z
- Onboarding completed: 2026-07-29T22:30:12.936Z
- Space created: 2026-07-30T01:03:38.242Z
- ChatGPT login started (audited): 2026-08-06T20:58:09.344Z
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): 2026-08-06T20:58:02.248Z
- Stored runtime provider: codex
- Stored runtime choice: local
- Stored runtime preference updated: 2026-08-06T20:58:02.242Z
- Codex runtime home present: yes
- Codex auth file present: no
- Survey created (space scope): 2026-07-30T15:42:21.845Z
- Survey published (space scope): 2026-07-30T15:42:39.239Z
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 2

### Okechukwu Samuel Omeh <okechukwuomeh3@gmail.com>

- User ID: c3c1e700-b1d8-499e-82d0-dbe12bc8f6bb
- Owned space: Okechukwu Samuel Omeh (f3fc1249-72b5-44b8-a8f1-b8dfaea1865f)
- Account created: 2026-07-30T15:44:15.582Z
- Email verified: 2026-07-30T15:44:33.871Z
- Onboarding completed: 2026-07-30T15:44:42.535Z
- Space created: 2026-07-30T15:44:15.632Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### pin-owner user <pin-owner-1@example.com>

- User ID: b4bf9c25-e3fe-4727-87b0-fe3a2d0b7a87
- Owned space: pin-owner's space (083dfd9e-bc36-409e-8b4f-c8be4d5f3ded)
- Account created: 2026-08-03T17:43:57.700Z
- Email verified: 2026-08-03T17:43:58.230Z
- Onboarding completed: 2026-08-03T17:43:58.282Z
- Space created: 2026-08-03T17:43:57.771Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### anonymous-library-owner user <anonymous-library-owner-1@example.com>

- User ID: d4c77b6a-104e-4873-bcf1-08722775d065
- Owned space: anonymous-library-owner's space (4e7fbb1b-1979-4fdc-a94b-43fe7b162a34)
- Account created: 2026-08-03T17:43:58.067Z
- Email verified: 2026-08-03T17:43:58.582Z
- Onboarding completed: 2026-08-03T17:43:58.625Z
- Space created: 2026-08-03T17:43:58.156Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Shared Network User 0 <shared-network-0@example.test>

- User ID: 8b971730-447f-4792-9acc-fc9b10b47919
- Owned space: Shared's space (67954b90-8826-445a-ad0b-104b023e1aad)
- Account created: 2026-08-03T17:43:58.084Z
- Email verified: —
- Onboarding completed: —
- Space created: 2026-08-03T17:43:58.159Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Retry Owner <ai-retry@example.test>

- User ID: 81ddf0bc-e066-4469-b2c4-88b220530d7e
- Owned space: Retry's space (8b601e5d-f5b1-4776-90c1-cf94f65d1ed7)
- Account created: 2026-08-03T17:43:58.124Z
- Email verified: 2026-08-03T17:43:58.630Z
- Onboarding completed: 2026-08-03T17:43:58.677Z
- Space created: 2026-08-03T17:43:58.196Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Envelope Owner <owner@example.com>

- User ID: 88315134-10e7-419f-9004-8a55995c95ba
- Owned space: Envelope's space (49f8f9b8-7994-48bb-9bf8-7ed8e34de6db)
- Account created: 2026-08-03T17:43:58.163Z
- Email verified: 2026-08-03T17:43:58.677Z
- Onboarding completed: 2026-08-03T17:43:58.730Z
- Space created: 2026-08-03T17:43:58.231Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Delivery Failure <delivery-failure@example.test>

- User ID: 8307b22b-4ef4-452b-8f3c-e4eb6a09b44d
- Owned space: Delivery's space (032ab7c2-98d8-4a4d-85ce-1ef53601877a)
- Account created: 2026-08-03T17:43:58.213Z
- Email verified: 2026-08-03T17:43:58.930Z
- Onboarding completed: 2026-08-03T17:43:58.985Z
- Space created: 2026-08-03T17:43:58.274Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Research Owner <researcher@example.com>

- User ID: cf9a496f-8558-4056-a660-fec2e009e1f4
- Owned space: Research's space (9610891c-d981-4a58-9d21-e8ced85ddf56)
- Account created: 2026-08-03T17:43:58.229Z
- Email verified: 2026-08-03T17:43:58.752Z
- Onboarding completed: 2026-08-03T17:43:58.800Z
- Space created: 2026-08-03T17:43:58.286Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Assistant Owner <assistant-owner@example.test>

- User ID: 24ca8f97-ee6f-41c6-8593-a9a5bd890ef9
- Owned space: Assistant research (a9a142d7-eaf9-476b-af24-dd746359f921)
- Account created: 2026-08-03T17:43:58.254Z
- Email verified: 2026-08-03T17:43:58.772Z
- Onboarding completed: 2026-08-03T17:43:58.818Z
- Space created: 2026-08-03T17:43:58.315Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Workspace admin <campaign-sender-admin@example.test>

- User ID: 322674b4-a44f-4955-84f3-1aeaae31e458
- Owned space: Workspace's space (a4179466-b1a9-40f5-817b-d0fffc378aa5)
- Account created: 2026-08-03T17:43:58.280Z
- Email verified: 2026-08-03T17:43:58.280Z
- Onboarding completed: 2026-08-03T17:43:58.280Z
- Space created: 2026-08-03T17:43:58.332Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): 2026-08-03T17:43:58.455Z
- Survey published (space scope): 2026-08-03T17:43:58.486Z
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### pin-outsider user <pin-outsider-2@example.com>

- User ID: 55633442-4a67-455d-8ad9-2b6a71521323
- Owned space: pin-outsider's space (35ccaddf-465d-47c1-b95e-aba29613b3e5)
- Account created: 2026-08-03T17:43:58.308Z
- Email verified: 2026-08-03T17:43:58.828Z
- Onboarding completed: 2026-08-03T17:43:58.854Z
- Space created: 2026-08-03T17:43:58.361Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Workspace admin <journeys@seemplify.local>

- User ID: 75cb0156-b802-430a-acb5-d6e4d2e566c5
- Owned space: Workspace's space (520216c3-3276-4beb-9228-8ad85dfe4a69)
- Account created: 2026-08-03T17:43:58.449Z
- Email verified: 2026-08-03T17:43:58.449Z
- Onboarding completed: 2026-08-03T17:43:58.449Z
- Space created: 2026-08-03T17:43:58.500Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Research Owner <intelligence@seemplify.local>

- User ID: 7360a4b6-0764-41c8-82d2-c23cdde681b1
- Owned space: Research's space (f2af0867-d2cc-4ba5-908c-b55e17aaa555)
- Account created: 2026-08-03T17:43:58.458Z
- Email verified: 2026-08-03T17:43:58.991Z
- Onboarding completed: 2026-08-03T17:43:59.043Z
- Space created: 2026-08-03T17:43:58.507Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): 2026-08-03T17:43:59.167Z
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Shared Network User 1 <shared-network-1@example.test>

- User ID: 74efeb6a-70c2-4a90-838c-1d92ca484631
- Owned space: Shared's space (24dc1f90-193d-4857-b774-da42b17a241c)
- Account created: 2026-08-03T17:43:58.593Z
- Email verified: —
- Onboarding completed: —
- Space created: 2026-08-03T17:43:58.643Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Other Tenant <ai-retry-outsider@example.test>

- User ID: 904664ee-4cc3-4759-bfdf-b5383e6c8967
- Owned space: Other's space (5fd9b5fd-db97-46c6-a4f3-3bea182d2c07)
- Account created: 2026-08-03T17:43:58.921Z
- Email verified: 2026-08-03T17:43:59.451Z
- Onboarding completed: 2026-08-03T17:43:59.485Z
- Space created: 2026-08-03T17:43:58.975Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Workspace admin <qa@seemplify.local>

- User ID: 8655072a-083b-401d-9182-34a70d8db99d
- Owned space: Workspace's space (e09d6d3f-71e8-4d0f-a6fa-aa5fbc439586)
- Account created: 2026-08-03T17:43:58.938Z
- Email verified: 2026-08-03T17:43:58.938Z
- Onboarding completed: 2026-08-03T17:43:58.938Z
- Space created: 2026-08-03T17:43:58.995Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): 2026-08-03T17:43:59.114Z
- Survey published (space scope): 2026-08-03T17:43:59.153Z
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Delivery Invitee <delivery-invitee@example.test>

- User ID: f687f833-304f-4900-93d3-df6a009e6c10
- Owned space: Delivery's space (95ee78db-8221-42d3-b230-c52e5ead5efa)
- Account created: 2026-08-03T17:43:59.042Z
- Email verified: 2026-08-03T17:43:59.560Z
- Onboarding completed: —
- Space created: 2026-08-03T17:43:59.101Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Shared Network User 2 <shared-network-2@example.test>

- User ID: 40b32f40-7d8b-48d2-85f0-8a2aa6d156cc
- Owned space: Shared's space (ac4e0846-bdc7-40f5-98f6-a185d25789f1)
- Account created: 2026-08-03T17:43:59.100Z
- Email verified: —
- Onboarding completed: —
- Space created: 2026-08-03T17:43:59.153Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Knowledge Owner <knowledge-owner@example.test>

- User ID: 8e7c786a-2cc9-4dca-967a-e77706702c74
- Owned space: Research space (91fc3789-a1d7-4bde-bea1-4b2b9d847efc)
- Account created: 2026-08-03T17:43:59.345Z
- Email verified: 2026-08-03T17:43:59.897Z
- Onboarding completed: 2026-08-03T17:43:59.980Z
- Space created: 2026-08-03T17:43:59.406Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Recovery Outsider <recovery-outsider-1785779039549@example.com>

- User ID: d01f3f2d-c82c-401c-8199-4dc98eb6af30
- Owned space: Separate recovery space (45ddff8c-678d-438f-a9be-54ae3bda8e15)
- Account created: 2026-08-03T17:43:59.555Z
- Email verified: 2026-08-03T17:44:00.186Z
- Onboarding completed: 2026-08-03T17:44:00.355Z
- Space created: 2026-08-03T17:43:59.613Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Shared Network User 3 <shared-network-3@example.test>

- User ID: 10f5ef1d-119a-4e5b-b30f-20c58af81d01
- Owned space: Shared's space (596ff7e3-da0b-49d4-ae0f-931a6f1db7fb)
- Account created: 2026-08-03T17:43:59.618Z
- Email verified: —
- Onboarding completed: —
- Space created: 2026-08-03T17:43:59.675Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Delivery Success <delivery-success@example.test>

- User ID: 45fb3719-9cd6-4be3-995a-29694ce3af7e
- Owned space: Delivery's space (1c7c02c3-9ab5-4d20-bb8e-1c9a8f36928a)
- Account created: 2026-08-03T17:43:59.619Z
- Email verified: 2026-08-03T17:44:00.655Z
- Onboarding completed: —
- Space created: 2026-08-03T17:43:59.677Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Knowledge Collaborator <knowledge-collaborator@example.test>

- User ID: e3481990-13cb-4ec8-a680-ebfba6de5f48
- Owned space: Knowledge's space (7e504665-bfdf-4f4b-9dcb-cf56947288aa)
- Account created: 2026-08-03T17:44:00.077Z
- Email verified: 2026-08-03T17:44:00.890Z
- Onboarding completed: 2026-08-03T17:44:01.225Z
- Space created: 2026-08-03T17:44:00.206Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Shared Network User 4 <shared-network-4@example.test>

- User ID: ac021663-953a-4c86-acb0-fd13646b0712
- Owned space: Shared's space (54c611cf-f0c4-40dc-814e-ac4b51ab5e68)
- Account created: 2026-08-03T17:44:00.185Z
- Email verified: —
- Onboarding completed: —
- Space created: 2026-08-03T17:44:00.302Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### send-owner user <send-owner-3@example.com>

- User ID: 7c78e710-d9f8-4c1e-ae64-8bcda6da8728
- Owned space: send-owner's space (72c05617-2d3e-418c-a15b-7e3f138b7742)
- Account created: 2026-08-03T17:44:00.437Z
- Email verified: 2026-08-03T17:44:01.480Z
- Onboarding completed: 2026-08-03T17:44:01.726Z
- Space created: 2026-08-03T17:44:00.792Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Shared Network User 5 <shared-network-5@example.test>

- User ID: 17914706-3730-4837-ad9a-e3e64942d78d
- Owned space: Shared's space (64df09fb-bcf5-4484-93cd-ca51805b60f2)
- Account created: 2026-08-03T17:44:00.791Z
- Email verified: —
- Onboarding completed: —
- Space created: 2026-08-03T17:44:00.980Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Single Resend Exemption <single-resend-exemption@example.test>

- User ID: 2c7b2d00-ab2f-4850-8616-6a6eb9379ffb
- Owned space: Single's space (edc92726-4008-4101-8ba5-40a9e0abbb88)
- Account created: 2026-08-03T17:44:01.226Z
- Email verified: 2026-08-03T17:44:02.065Z
- Onboarding completed: —
- Space created: 2026-08-03T17:44:01.376Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Shared Network User 6 <shared-network-6@example.test>

- User ID: 99c06380-b85a-4023-81d5-e49048a07661
- Owned space: Shared's space (5b1685dd-40bb-4a84-8463-40a7fad13442)
- Account created: 2026-08-03T17:44:01.454Z
- Email verified: —
- Onboarding completed: —
- Space created: 2026-08-03T17:44:01.583Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### pin-library-owner user <pin-library-owner-2@example.com>

- User ID: 7ca1348e-fccc-495b-ae8d-f536322359b8
- Owned space: pin-library-owner's space (3ceaa6fc-4266-48e7-9ff5-6734cc045da5)
- Account created: 2026-08-03T17:44:01.773Z
- Email verified: 2026-08-03T17:44:02.502Z
- Onboarding completed: 2026-08-03T17:44:02.786Z
- Space created: 2026-08-03T17:44:01.900Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Alice Researcher <alice@example.test>

- User ID: 81dab725-a739-4018-a891-9a1db199872d
- Owned space: Alice Experience Lab (bb9bd2f0-e6e3-4d99-81f4-41bc092d664a)
- Account created: 2026-08-03T17:44:01.938Z
- Email verified: 2026-08-03T17:44:02.708Z
- Onboarding completed: 2026-08-03T17:44:03.025Z
- Space created: 2026-08-03T17:44:02.035Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Workspace admin <platform-admin@seemplify.local>

- User ID: c5eeec4a-1bb6-480b-8d14-c7fee8a98a56
- Owned space: Workspace's space (a835ad05-8bb2-48ac-9051-fca186fbac71)
- Account created: 2026-08-03T17:44:02.132Z
- Email verified: 2026-08-03T17:44:02.132Z
- Onboarding completed: 2026-08-03T17:44:02.132Z
- Space created: 2026-08-03T17:44:02.291Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: 2026-08-03T17:44:03.357Z
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### First Space Owner <first-space-owner@example.test>

- User ID: 5dcdebfb-0722-4b70-b12c-6af48c4e768d
- Owned space: First invitation space (9a9043ad-c00c-4039-a54a-ddcc51c523d7)
- Account created: 2026-08-03T17:44:02.279Z
- Email verified: 2026-08-03T17:44:02.827Z
- Onboarding completed: 2026-08-03T17:44:03.078Z
- Space created: 2026-08-03T17:44:02.446Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Current Space Owner <current-space-owner@example.test>

- User ID: 2404b4d5-e3a0-43d6-a874-43844c0d33c2
- Owned space: Current invitation space (2211ccaa-a393-44c0-892e-43d331aaf732)
- Account created: 2026-08-03T17:44:03.271Z
- Email verified: 2026-08-03T17:44:03.817Z
- Onboarding completed: 2026-08-03T17:44:03.850Z
- Space created: 2026-08-03T17:44:03.335Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Bob Analyst <bob@example.test>

- User ID: e42d2279-7c9c-410f-af25-015461c92e28
- Owned space: Bob's space (625072db-b4c0-411b-90bf-f41eab7d4824)
- Account created: 2026-08-03T17:44:03.331Z
- Email verified: 2026-08-03T17:44:03.866Z
- Onboarding completed: 2026-08-03T17:44:03.901Z
- Space created: 2026-08-03T17:44:03.427Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Owner Alpha <owner-a@example.test>

- User ID: 390a42eb-1e4a-403a-bdfe-95a52dcad5ef
- Owned space: Alpha research (89136b34-0547-44cb-b884-67e6e6f02456)
- Account created: 2026-08-03T17:44:03.627Z
- Email verified: 2026-08-03T17:44:04.143Z
- Onboarding completed: 2026-08-03T17:44:04.189Z
- Space created: 2026-08-03T17:44:03.720Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): 2026-08-03T17:44:04.801Z
- Survey published (space scope): 2026-08-03T17:44:05.175Z
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### session-cap-owner user <session-cap-owner-4@example.com>

- User ID: f647d3f6-b7a2-4068-b2e3-6423705b99e3
- Owned space: session-cap-owner's space (e0cc8608-daed-4ccd-9031-0afeb704a6af)
- Account created: 2026-08-03T17:44:03.680Z
- Email verified: 2026-08-03T17:44:04.197Z
- Onboarding completed: 2026-08-03T17:44:04.221Z
- Space created: 2026-08-03T17:44:03.795Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Billing Admin <billing-admin@example.test>

- User ID: ffb57928-433d-4a7e-81d8-33c60b3e6c3f
- Owned space: Billing Admin workspace (4c187e1d-b9da-44a7-b1bb-4a27f1bb9639)
- Account created: 2026-08-03T17:44:03.829Z
- Email verified: 2026-08-03T17:44:03.829Z
- Onboarding completed: —
- Space created: 2026-08-03T17:44:03.836Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: 2026-08-03T17:44:04.191Z
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Support Admin <support-admin@example.test>

- User ID: 117de28a-6bf4-4064-953e-435359e264bf
- Owned space: Support Admin workspace (dda6170b-24b8-40b6-8cc8-6f8f70cc5a26)
- Account created: 2026-08-03T17:44:03.864Z
- Email verified: 2026-08-03T17:44:03.864Z
- Onboarding completed: —
- Space created: 2026-08-03T17:44:03.874Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Analyst Admin <analyst-admin@example.test>

- User ID: dcb1e4c9-9d7f-4ae0-951a-9027e0ed4e52
- Owned space: Analyst Admin workspace (5c1cf81e-7809-4bdb-b1a7-30a5839fe053)
- Account created: 2026-08-03T17:44:03.894Z
- Email verified: 2026-08-03T17:44:03.894Z
- Onboarding completed: —
- Space created: 2026-08-03T17:44:03.902Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Mailbox Owner <preclaimed@example.test>

- User ID: 36c97c50-6017-4daa-aa54-9d07637dd68e
- Owned space: Mailbox's space (f3962a64-3fa4-4a90-8512-c5b4f63b47a8)
- Account created: 2026-08-03T17:44:03.950Z
- Email verified: 2026-08-03T17:44:06.015Z
- Onboarding completed: —
- Space created: 2026-08-03T17:44:04.006Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Carol Owner <carol@example.test>

- User ID: 3bad4d7f-ce2e-490a-a518-a0cb0d27973f
- Owned space: Carol's space (ad5e0bf7-c905-4b39-99a8-766fca38d8d5)
- Account created: 2026-08-03T17:44:03.961Z
- Email verified: 2026-08-03T17:44:04.583Z
- Onboarding completed: —
- Space created: 2026-08-03T17:44:04.030Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### account-library-sender user <account-library-sender-3@example.com>

- User ID: 2baa4a5c-1031-41ef-8c79-278706877bce
- Owned space: account-library-sender's space (3d5665fe-6b9a-453f-889b-7073b683a841)
- Account created: 2026-08-03T17:44:04.212Z
- Email verified: 2026-08-03T17:44:04.733Z
- Onboarding completed: 2026-08-03T17:44:04.760Z
- Space created: 2026-08-03T17:44:04.263Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Owner Beta <owner-b@example.test>

- User ID: f4d0333b-92d2-4593-868d-937fda73da72
- Owned space: Owner's space (de4b01d5-ee06-4ccd-8446-c15c2da704f9)
- Account created: 2026-08-03T17:44:04.212Z
- Email verified: 2026-08-03T17:44:04.727Z
- Onboarding completed: 2026-08-03T17:44:04.757Z
- Space created: 2026-08-03T17:44:04.261Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): 2026-08-03T17:44:04.937Z
- Survey published (space scope): 2026-08-03T17:44:04.990Z
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Terms Owner <terms-owner@example.test>

- User ID: 0cb43eed-edc0-4ba5-b07b-1fe2c3bbb748
- Owned space: Terms Owner workspace (5244d32e-08b6-43b5-b692-46fa9c0dc56c)
- Account created: 2026-08-03T17:44:04.511Z
- Email verified: 2026-08-03T17:44:04.511Z
- Onboarding completed: —
- Space created: 2026-08-03T17:44:04.517Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: 2026-08-03T17:44:04.630Z
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Terms Member <terms-member@example.test>

- User ID: 35b4c9b9-3816-4c07-a07e-3f65cfd11dd0
- Owned space: Terms Member workspace (fb21bb37-560e-41b9-8192-cd8b782deb87)
- Account created: 2026-08-03T17:44:04.528Z
- Email verified: 2026-08-03T17:44:04.528Z
- Onboarding completed: —
- Space created: 2026-08-03T17:44:04.533Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Replay Researcher <replay@example.test>

- User ID: a7510e2a-98b1-460a-96ff-892903075519
- Owned space: Replay's space (160ccb00-8dc5-47a4-ad68-a5021b00a010)
- Account created: 2026-08-03T17:44:04.657Z
- Email verified: 2026-08-03T17:44:05.175Z
- Onboarding completed: —
- Space created: 2026-08-03T17:44:04.709Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Restricted Space <restricted-space@example.test>

- User ID: 0c2097c0-5a9c-4924-97d8-0745d2ab5a92
- Owned space: Restricted Space workspace (7657564e-5a26-4ec8-b6a4-f86ca4936abe)
- Account created: 2026-08-03T17:44:04.766Z
- Email verified: 2026-08-03T17:44:04.766Z
- Onboarding completed: —
- Space created: 2026-08-03T17:44:04.774Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### account-recipient user <account-recipient-0f827cc1-7876-4afb-883a-963d7594fb6e@example.com>

- User ID: ffe645b1-2e3f-4cd0-9bce-7ee7574f5c73
- Owned space: account-recipient's space (9e05b9cc-2771-4d7e-92f7-6bcc837dd800)
- Account created: 2026-08-03T17:44:04.785Z
- Email verified: 2026-08-03T17:44:05.296Z
- Onboarding completed: —
- Space created: 2026-08-03T17:44:04.840Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Restricted Verify <restricted-verify@example.test>

- User ID: 28c3201f-9c57-41b5-933f-044bdedece68
- Owned space: Restricted Verify workspace (2928cc0c-ec5d-4f53-a740-f0ae22630241)
- Account created: 2026-08-03T17:44:04.893Z
- Email verified: —
- Onboarding completed: —
- Space created: 2026-08-03T17:44:04.898Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### completion-owner user <completion-owner-5@example.com>

- User ID: 06710f0b-7241-494d-99a1-85c0911a090e
- Owned space: completion-owner's space (e03d73aa-ad9c-42ca-9fb3-01414a3f2933)
- Account created: 2026-08-03T17:44:04.896Z
- Email verified: 2026-08-03T17:44:05.420Z
- Onboarding completed: 2026-08-03T17:44:05.442Z
- Space created: 2026-08-03T17:44:04.947Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Restricted Reset <restricted-reset@example.test>

- User ID: 5c8224af-a165-4427-b731-10dfa53eada7
- Owned space: Restricted Reset workspace (cada4159-1d6b-46ae-95f1-9ee2808e5c1b)
- Account created: 2026-08-03T17:44:04.927Z
- Email verified: 2026-08-03T17:44:04.927Z
- Onboarding completed: —
- Space created: 2026-08-03T17:44:04.935Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### other-recipient user <other-recipient-5@example.com>

- User ID: 34aef12a-9747-4d8e-a8d4-49b03da6480d
- Owned space: other-recipient's space (2166c678-c0fd-4989-870f-6d6cec3a9504)
- Account created: 2026-08-03T17:44:05.318Z
- Email verified: 2026-08-03T17:44:05.850Z
- Onboarding completed: —
- Space created: 2026-08-03T17:44:05.362Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### completion-outsider user <completion-outsider-6@example.com>

- User ID: 1fcf2d56-ac74-4069-a37a-9e0330d39ad0
- Owned space: completion-outsider's space (7127b0ab-72f0-40fb-a38a-c493dd6b8920)
- Account created: 2026-08-03T17:44:05.461Z
- Email verified: 2026-08-03T17:44:05.985Z
- Onboarding completed: 2026-08-03T17:44:06.018Z
- Space created: 2026-08-03T17:44:05.508Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Expected Recipient <expected@example.test>

- User ID: 29084ed5-07f4-4482-aee1-aa4a9b559f42
- Owned space: Expected private (e0e6f7a4-f5ec-4da6-b121-73f27c18c6ac)
- Account created: 2026-08-03T17:44:05.978Z
- Email verified: 2026-08-03T17:44:06.497Z
- Onboarding completed: —
- Space created: 2026-08-03T17:44:06.046Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Mail Limit Owner <mail-limit@example.test>

- User ID: 7a03cc38-6f9a-4aa0-9fb2-3cfe3b7469c8
- Owned space: Mail's space (d41942bc-9a9d-42d8-bf1f-1d6492ce9926)
- Account created: 2026-08-03T17:44:06.364Z
- Email verified: —
- Onboarding completed: —
- Space created: 2026-08-03T17:44:06.436Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Onboarding Invitee <onboarding-invitee@example.test>

- User ID: 125ad908-4217-4c7e-ac18-3f7aab9cd30e
- Owned space: Onboarding's space (7154b3bf-857e-48b8-8c76-7b62aba18316)
- Account created: 2026-08-03T17:44:06.667Z
- Email verified: 2026-08-03T17:44:07.184Z
- Onboarding completed: —
- Space created: 2026-08-03T17:44:06.721Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### decline-owner user <decline-owner-7@example.com>

- User ID: 70776e3f-84f7-4251-894b-fe8911c63c3b
- Owned space: decline-owner's space (9e236d5a-dd28-4b93-a6b1-e69360925625)
- Account created: 2026-08-03T17:44:06.844Z
- Email verified: 2026-08-03T17:44:07.355Z
- Onboarding completed: 2026-08-03T17:44:07.373Z
- Space created: 2026-08-03T17:44:06.890Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Alice Tutorial <alice-tutorial@example.test>

- User ID: e96736a9-8367-4f55-95dc-6c5635c767f4
- Owned space: Alice's space (9e66949c-8fa5-4525-a48c-cc874dd32bac)
- Account created: 2026-08-03T17:44:07.057Z
- Email verified: 2026-08-03T17:44:07.573Z
- Onboarding completed: 2026-08-03T17:44:07.606Z
- Space created: 2026-08-03T17:44:07.103Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### parallel-library-owner user <parallel-library-owner-6@example.com>

- User ID: 80a23191-7fb6-4262-9d49-584173d3e6f9
- Owned space: parallel-library-owner's space (34e612a3-fe77-400b-a5d0-b56d2b8ce015)
- Account created: 2026-08-03T17:44:07.111Z
- Email verified: 2026-08-03T17:44:07.635Z
- Onboarding completed: 2026-08-03T17:44:07.653Z
- Space created: 2026-08-03T17:44:07.155Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Incremental Owner <x-incremental-owner@example.test>

- User ID: 7b2e2dc0-e1ab-4883-9e7c-d36b654b234c
- Owned space: Incremental's space (d34f646d-f0d7-4e3b-b934-6558008b5254)
- Account created: 2026-08-03T17:44:07.177Z
- Email verified: 2026-08-03T17:44:07.699Z
- Onboarding completed: 2026-08-03T17:44:07.732Z
- Space created: 2026-08-03T17:44:07.222Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Workspace admin <fresh-admin@example.com>

- User ID: ff5706be-a6da-4882-bab3-3545abb54f93
- Owned space: Workspace's space (afea8795-fdab-4079-935f-74a871644db4)
- Account created: 2026-08-03T17:44:07.272Z
- Email verified: 2026-08-03T17:44:07.272Z
- Onboarding completed: 2026-08-03T17:44:07.272Z
- Space created: 2026-08-03T17:44:07.325Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### X Workspace Owner <x-owner@example.test>

- User ID: 56dda394-fdd8-4c7d-872b-18da28962b4b
- Owned space: X's space (1353cece-7e50-4c66-a442-3efaee86873d)
- Account created: 2026-08-03T17:44:07.495Z
- Email verified: 2026-08-03T17:44:08.009Z
- Onboarding completed: 2026-08-03T17:44:08.043Z
- Space created: 2026-08-03T17:44:07.537Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Bob Tutorial <bob-tutorial@example.test>

- User ID: 466fd213-b905-40c0-ad18-cb53adefbc6d
- Owned space: Bob's space (c4b31d71-41f7-44a8-803e-13467344e422)
- Account created: 2026-08-03T17:44:07.626Z
- Email verified: 2026-08-03T17:44:08.146Z
- Onboarding completed: 2026-08-03T17:44:08.167Z
- Space created: 2026-08-03T17:44:07.666Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### space-owner user <space-owner-8@example.com>

- User ID: 53b77ec2-0796-49e4-8544-688a1c3a7e4a
- Owned space: space-owner's space (e88ac59f-6afe-400b-9ba7-bd1d29dc9fbc)
- Account created: 2026-08-03T17:44:07.713Z
- Email verified: 2026-08-03T17:44:08.226Z
- Onboarding completed: 2026-08-03T17:44:08.246Z
- Space created: 2026-08-03T17:44:07.753Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Read-only Member <x-incremental-member@example.test>

- User ID: 2ead43ce-bfd1-4470-ba28-20daa6201db5
- Owned space: Read-only's space (735e7ba0-8bb9-46ad-8e03-bbe2298b69ce)
- Account created: 2026-08-03T17:44:07.750Z
- Email verified: 2026-08-03T17:44:08.270Z
- Onboarding completed: 2026-08-03T17:44:08.290Z
- Space created: 2026-08-03T17:44:07.789Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### X Workspace Member <x-member@example.test>

- User ID: c84df889-1939-469f-abfb-ffe7e75fc303
- Owned space: X's space (f750566b-7508-4c4f-8c92-32bd1fb988ab)
- Account created: 2026-08-03T17:44:08.061Z
- Email verified: 2026-08-03T17:44:08.582Z
- Onboarding completed: 2026-08-03T17:44:08.606Z
- Space created: 2026-08-03T17:44:08.100Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### space-member user <space-member-9@example.com>

- User ID: 76d268d3-a729-46b9-9794-0b099796395d
- Owned space: space-member's space (ef0d8adf-c5b5-4403-aa01-2cdb2f0c8582)
- Account created: 2026-08-03T17:44:08.265Z
- Email verified: 2026-08-03T17:44:08.781Z
- Onboarding completed: 2026-08-03T17:44:08.799Z
- Space created: 2026-08-03T17:44:08.304Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### space-outsider user <space-outsider-10@example.com>

- User ID: c8157ef0-30ac-40ab-b4c7-d12139b96555
- Owned space: space-outsider's space (0aca2b0a-e1f4-4c25-814d-32b760b4daac)
- Account created: 2026-08-03T17:44:09.116Z
- Email verified: 2026-08-03T17:44:09.637Z
- Onboarding completed: 2026-08-03T17:44:09.658Z
- Space created: 2026-08-03T17:44:09.157Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### storage-owner user <storage-owner-11@example.com>

- User ID: fa6c3a00-2e94-46eb-8504-3bc1ddc81976
- Owned space: storage-owner's space (14c61f6c-a420-4c94-9c85-f19256e39612)
- Account created: 2026-08-03T17:44:09.685Z
- Email verified: 2026-08-03T17:44:10.208Z
- Onboarding completed: 2026-08-03T17:44:10.229Z
- Space created: 2026-08-03T17:44:09.736Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### IP Bucket Owner <ip-login-bucket@example.test>

- User ID: eab652d6-c899-4e6a-9bde-8fce92e6bbe9
- Owned space: IP login bucket (41055f8e-7dcf-4645-8446-8a51163ca43e)
- Account created: 2026-08-03T17:44:10.453Z
- Email verified: 2026-08-03T17:44:10.970Z
- Onboarding completed: 2026-08-03T17:44:10.989Z
- Space created: 2026-08-03T17:44:10.493Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Account Bucket Owner <account-login-bucket@example.test>

- User ID: c17cdd77-7b7d-40b0-a5b4-df281922ee1e
- Owned space: Account login bucket (849828e6-771d-49db-a910-f80e7a1d5442)
- Account created: 2026-08-03T17:44:11.410Z
- Email verified: 2026-08-03T17:44:11.929Z
- Onboarding completed: 2026-08-03T17:44:11.947Z
- Space created: 2026-08-03T17:44:11.449Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Forgot Timing Owner <forgot-timing@example.test>

- User ID: 5d06d2c8-20d9-4a79-ac1b-3d507496ab8e
- Owned space: Forgot's space (2e9de291-33d3-42e4-9f49-629b91c5fe73)
- Account created: 2026-08-03T17:44:12.814Z
- Email verified: —
- Onboarding completed: —
- Space created: 2026-08-03T17:44:12.849Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Inflight Reset Owner <inflight-reset@example.test>

- User ID: 26486e23-e2ac-403e-9db8-b3959a29657f
- Owned space: Inflight reset (c512c42f-5544-4d59-aeed-2f11e7602520)
- Account created: 2026-08-03T17:44:13.579Z
- Email verified: 2026-08-03T17:44:14.100Z
- Onboarding completed: 2026-08-03T17:44:14.119Z
- Space created: 2026-08-03T17:44:13.614Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Reset Mail Cap Owner <reset-mail-cap@example.test>

- User ID: b757036a-a664-416d-bbe7-cc40f07d6817
- Owned space: Reset mail cap (a39761e5-8abc-4ccb-8f26-af0aa530b3ba)
- Account created: 2026-08-03T17:44:14.736Z
- Email verified: 2026-08-03T17:44:15.248Z
- Onboarding completed: 2026-08-03T17:44:15.267Z
- Space created: 2026-08-03T17:44:14.774Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Reset Replacement Owner <reset-replacement@example.test>

- User ID: 0a8465e2-e413-4a91-bd25-066e72b211ba
- Owned space: Reset replacement (cfd670e9-b6e1-402a-823e-d45a02331ef4)
- Account created: 2026-08-03T17:44:16.327Z
- Email verified: 2026-08-03T17:44:16.846Z
- Onboarding completed: 2026-08-03T17:44:16.864Z
- Space created: 2026-08-03T17:44:16.364Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Fresh Mailbox <provider-outage@example.test>

- User ID: 6f425f29-13e0-45d7-ab86-bb090b7f437e
- Owned space: Fresh's space (fdc1040e-198c-4083-89ea-fef5b5c88a72)
- Account created: 2026-08-03T17:44:17.725Z
- Email verified: —
- Onboarding completed: —
- Space created: 2026-08-03T17:44:17.768Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### send-owner user <send-owner-2@example.com>

- User ID: 69ace28d-7b22-462e-a2fe-c3d4ed335ae8
- Owned space: send-owner's space (43d914f5-40f9-474c-9810-1350e6b9df01)
- Account created: 2026-08-03T17:45:53.202Z
- Email verified: 2026-08-03T17:45:53.704Z
- Onboarding completed: 2026-08-03T17:45:53.782Z
- Space created: 2026-08-03T17:45:53.275Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### session-cap-owner user <session-cap-owner-3@example.com>

- User ID: 20007854-aa6c-46ff-9161-8f3d2e12e95a
- Owned space: session-cap-owner's space (405917cf-f855-44d5-8a6d-c9ee730a4a9f)
- Account created: 2026-08-03T17:45:54.377Z
- Email verified: 2026-08-03T17:45:54.916Z
- Onboarding completed: 2026-08-03T17:45:54.969Z
- Space created: 2026-08-03T17:45:54.445Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### Recovery Outsider <recovery-outsider-1785779154957@example.com>

- User ID: 917a5f10-03ee-490f-866f-eaceaef3d26d
- Owned space: Separate recovery space (c69649eb-bd4f-45f8-83c2-1b5351023412)
- Account created: 2026-08-03T17:45:54.967Z
- Email verified: 2026-08-03T17:45:55.496Z
- Onboarding completed: 2026-08-03T17:45:55.543Z
- Space created: 2026-08-03T17:45:55.031Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### completion-owner user <completion-owner-4@example.com>

- User ID: bcfdfd7a-d3c6-437b-8332-d5b7ce11253d
- Owned space: completion-owner's space (006a02c2-d64d-43c5-813c-3e3a168eaf60)
- Account created: 2026-08-03T17:45:56.337Z
- Email verified: 2026-08-03T17:45:56.883Z
- Onboarding completed: 2026-08-03T17:45:56.947Z
- Space created: 2026-08-03T17:45:56.430Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### completion-outsider user <completion-outsider-5@example.com>

- User ID: eee05167-9705-45a5-8aa6-01d560cdad6e
- Owned space: completion-outsider's space (22008e69-5292-4343-a9ac-f4c9a2e24461)
- Account created: 2026-08-03T17:45:56.978Z
- Email verified: 2026-08-03T17:45:57.508Z
- Onboarding completed: 2026-08-03T17:45:57.562Z
- Space created: 2026-08-03T17:45:57.067Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### decline-owner user <decline-owner-6@example.com>

- User ID: a03a4fd9-33b2-4d2e-8019-d53689380b93
- Owned space: decline-owner's space (fbf4551b-3de8-4f66-af9e-43f96c524fae)
- Account created: 2026-08-03T17:45:59.300Z
- Email verified: 2026-08-03T17:45:59.820Z
- Onboarding completed: 2026-08-03T17:45:59.887Z
- Space created: 2026-08-03T17:45:59.358Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### space-owner user <space-owner-7@example.com>

- User ID: 12a7cdde-eaaf-4129-8a23-8705b6dd7046
- Owned space: space-owner's space (01bc4599-f5a4-4f21-9a0f-aa3081bc6c66)
- Account created: 2026-08-03T17:46:00.760Z
- Email verified: 2026-08-03T17:46:01.275Z
- Onboarding completed: 2026-08-03T17:46:01.298Z
- Space created: 2026-08-03T17:46:00.820Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### space-member user <space-member-8@example.com>

- User ID: c889ddc6-8a51-4393-ab8a-c152e4cde54b
- Owned space: space-member's space (f805d4fc-e9f4-4e0e-83dd-70e1cf44fa6d)
- Account created: 2026-08-03T17:46:01.321Z
- Email verified: 2026-08-03T17:46:01.836Z
- Onboarding completed: 2026-08-03T17:46:01.863Z
- Space created: 2026-08-03T17:46:01.368Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### space-outsider user <space-outsider-9@example.com>

- User ID: c5f41ce2-9f9f-4e97-93a2-15f189cd5476
- Owned space: space-outsider's space (039a42ef-b454-4e88-ae23-4492f23cdeb5)
- Account created: 2026-08-03T17:46:02.283Z
- Email verified: 2026-08-03T17:46:02.797Z
- Onboarding completed: 2026-08-03T17:46:02.817Z
- Space created: 2026-08-03T17:46:02.327Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### storage-owner user <storage-owner-10@example.com>

- User ID: d8dddc86-169b-4d75-b9fd-102d53230678
- Owned space: storage-owner's space (3f49e837-1f69-42db-b8d7-eeeff01fefda)
- Account created: 2026-08-03T17:46:02.844Z
- Email verified: 2026-08-03T17:46:03.373Z
- Onboarding completed: 2026-08-03T17:46:03.398Z
- Space created: 2026-08-03T17:46:02.887Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

### parallel-library-owner user <parallel-library-owner-4@example.com>

- User ID: 430ba4c3-dd61-461d-a52a-8529d855290c
- Owned space: parallel-library-owner's space (ce2b910a-a7ca-4f11-a6ce-496fe83a92ae)
- Account created: 2026-08-03T17:46:22.246Z
- Email verified: 2026-08-03T17:46:22.764Z
- Onboarding completed: 2026-08-03T17:46:22.806Z
- Space created: 2026-08-03T17:46:22.286Z
- ChatGPT login started (audited): —
- ChatGPT connected (audited): —
- ChatGPT selected (audited): —
- ChatGPT gateway selected (audited): —
- Stored runtime provider: —
- Stored runtime choice: —
- Stored runtime preference updated: —
- Codex runtime home present: no
- Codex auth file present: no
- Survey created (space scope): —
- Survey published (space scope): —
- Journey created (space scope): —
- Journey published (space scope): —
- Subscription requested: —
- Subscription activated: —
- Activation audit events: 0
- AI runtime audit events: 0

