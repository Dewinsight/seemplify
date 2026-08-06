# Seemplify connected-journey dogfood tracking plan

**Status:** Proposed — no production instrumentation is authorised by this file  
**Protocol:** `@seemplify/journey-event-protocol` 1.0  
**Last updated:** 2026-08-04

This plan defines the minimum facts needed to build the first connected
“Seemplify customer activation” journey. It follows the protocol’s lower-snake
event grammar. Local, test, staging, and production use separate event sources
and environments; their data is never combined.

## Collection rules

- A server event is authoritative for durable state changes. Browser events may
  describe starts, navigation, or client-visible failures but never replace the
  matching server completion fact.
- Emit only after the represented transaction commits. Retried emissions reuse
  the same deterministic `messageId` derived from the durable source record and
  event contract.
- `userId`, `anonymousId`, `accountId`, and `sessionId` belong in the envelope;
  do not repeat them in properties.
- Properties contain bounded IDs for non-personal product objects only when
  required for deduplication or stage mapping. Analytics should prefer bounded
  enums and booleans.
- No event in this plan may contain survey responses, prompt or generated AI
  content, document/agreement/email/social text, recipient data, access tokens,
  full URLs, provider payloads, exception stacks, or local paths.
- Browser collection requires the current `experience_analytics` consent state.
  Authoritative essential server facts require a documented lawful-policy basis
  and must not be reused for personalisation or communication without consent.

## Approved activation events

| Event | Authoritative emitter | Allowed properties | Purpose | Owner |
| --- | --- | --- | --- | --- |
| `auth_signup_started` | Browser | `method` enum | Diagnose activation entry | Identity team (unassigned) |
| `auth_signup_completed` | Server | `method` enum | Activation entry | Identity team (unassigned) |
| `auth_email_verified` | Server | none | Verification completion | Identity team (unassigned) |
| `space_created` | Server | `space_kind` enum | Time to first workspace | Spaces team (unassigned) |
| `space_entered` | Server | `membership_kind` enum | Workspace entry | Spaces team (unassigned) |
| `onboarding_started` | Server | `flow_version` string | Onboarding funnel | Experience team (unassigned) |
| `onboarding_step_completed` | Server | `flow_version`, `step_key`, `step_ordinal` | Onboarding progress | Experience team (unassigned) |
| `onboarding_completed` | Server | `flow_version` | Onboarding completion | Experience team (unassigned) |
| `ai_chatgpt_connection_started` | Browser | `entry_point` enum | Connection attempt | AI runtime team (unassigned) |
| `ai_chatgpt_connected` | Server | `provider` enum | Connection conversion | AI runtime team (unassigned) |
| `ai_chatgpt_connection_failed` | Server | `failure_class` enum, `retryable` boolean | Bounded failure analysis | AI runtime team (unassigned) |
| `ai_runtime_selected` | Server | `runtime` enum (`chatgpt_codex`, `local`) | Runtime adoption | AI runtime team (unassigned) |
| `survey_created` | Server | `created_from` enum, `purpose` enum | First artefact | Surveys team (unassigned) |
| `survey_published` | Server | `created_from`, `purpose` | Activation milestone | Surveys team (unassigned) |
| `survey_first_response_received` | Server | `collector_kind` enum | First evidence | Surveys team (unassigned) |
| `intelligence_requested` | Server | `action_key` enum, `source_count` integer | Intelligence funnel | Intelligence team (unassigned) |
| `intelligence_completed` | Server | `action_key`, `runtime` enum, `duration_seconds` number | Time to first value | Intelligence team (unassigned) |
| `intelligence_failed` | Server | `action_key`, `runtime`, `failure_class`, `retryable` | Abandonment/failure | Intelligence team (unassigned) |
| `knowledge_base_created` | Server | `privacy` enum | Knowledge activation | Knowledge team (unassigned) |
| `knowledge_document_indexed` | Server | `mime_category` enum, `page_count_band` enum | First indexed evidence | Knowledge team (unassigned) |
| `journey_created` | Server | `created_from` enum, `map_type` enum | Journey activation | Journey team (unassigned) |
| `journey_published` | Server | `map_type`, `truth_state` enum | Journey value milestone | Journey team (unassigned) |
| `agreement_sent` | Server | `routing_mode` enum, `recipient_count_band` enum | Agreement activation | Agreements team (unassigned) |
| `agreement_completed` | Server | `routing_mode`, `duration_band` enum | Agreement outcome | Agreements team (unassigned) |
| `social_source_connected` | Server | `provider` enum | Social activation | Social team (unassigned) |
| `assistant_mailbox_connected` | Server | `provider` enum | Assistant activation | Assistant team (unassigned) |
| `subscription_requested` | Server | `requested_plan_code` enum | Commercial funnel | Platform team (unassigned) |
| `subscription_activated` | Server | `plan_code` enum, `activation_kind` enum | Plan conversion | Platform team (unassigned) |
| `feature_limit_reached` | Server | `feature_key` enum, `limit_key` enum, `policy` enum | Product friction | Platform team (unassigned) |

“Enum” means a tracking-plan schema allowlist. Free-form provider errors,
feature labels, plan display names, and exception messages are prohibited.

## Initial activation journey

```text
Sign up
→ Verify identity
→ Create or enter a space
→ Choose or connect an AI runtime
→ Create the first experience artefact
→ Collect or connect the first evidence
→ Complete the first intelligence result
→ Share or take an approved action
→ Return and repeat value
```

Stage rules use only committed server facts for completion. Browser start events
may support drop-off analysis but cannot advance a customer beyond a stage.
Multiple artefact types can satisfy “first artefact”; mapping rules must use a
versioned any-of group and explain which event matched.

## Required validation before enabling collection

1. Assign an accountable owner and data steward to every event.
2. Approve JSON Schema for each allowed-property set and classification.
3. Validate that identity/consent/policy-basis fields are present and current.
4. Scan emitted payload fixtures for prohibited keys and content.
5. Reconcile server event counts with the source database transaction counts.
6. Prove retry duplicates do not increase accepted usage or stage metrics.
7. Manually inspect anonymous-to-known aliases and stage explain traces in
   staging shadow mode.
8. Record retention, regional routing, debugger redaction, and deletion lineage.
9. Obtain security/privacy approval before production collection.

## Ratification record

| Role | Approver | Date | Decision/follow-up |
| --- | --- | --- | --- |
| Product/data | Unassigned | — | Pending |
| Engineering owners | Unassigned | — | Pending |
| Security/privacy | Unassigned | — | Pending |
| Operations/support | Unassigned | — | Pending |
