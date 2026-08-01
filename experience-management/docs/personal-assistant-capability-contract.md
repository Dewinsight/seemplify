# Personal Assistant capability contract

This document maps the 6 July 2026 management memo to the implemented Experience Management Personal Assistant. It is the acceptance contract for the governed Phase 1 workspace.

## Operating model

- The assistant is advisory and human-in-the-loop. It prepares evidence-grounded work; it does not approve, send, publish, or change an external system.
- Mail and calendar provider access is read-only. A person reviews outputs and uses the organisation's approved process for any external action.
- Assistant runs are durable, idempotent, private to the requesting user and active space, and retain their frozen evidence snapshot and runtime record.
- Generated work products remain editable. Saving a revision never changes the original generated result.
- Proposed actions become tracked actions only after an explicit human click.
- Terra is the managed model used by Experience Management. This replaces the memo's proposed DeepSeek runtime in accordance with the product's current approved runtime decision.

## Memo coverage

| Memo capability | Experience Management workflow | Phase 1 status |
| --- | --- | --- |
| Intelligent email drafting and summarisation | Search and open a complete connected-mail thread, then **Summarise thread** or **Prepare reply draft** in the mailbox assistant | Implemented |
| Executive and senior correspondence | **Work products → Correspondence**, grounded in selected approved evidence | Implemented |
| Memo generation | **Work products → Memo** | Implemented |
| Report, board paper and document summarisation | **Report**, **Board paper**, **Executive document**, and **Cross-document summary** work products | Implemented |
| Meeting preparation packs and briefing notes | Select a read-only calendar event and prepare a **Meeting pack** or create a **Briefing note** | Implemented |
| Meeting minutes summarisation | **Work products → Meeting minutes** using selected intelligence, knowledge-base, mailbox, or calendar evidence | Implemented |
| Action tracking and follow-up reminders | Explicitly promote a proposed action, assign an owner, priority, due date and status, then add or update durable reminders | Implemented |
| Enterprise knowledge retrieval | Select ready knowledge bases; retrieval uses the local graph-and-vector knowledge pipeline before the Terra request is queued | Implemented |
| Policy and procedure lookup | **Work products → Policy lookup**, grounded in approved knowledge bases or saved intelligence | Implemented |
| Conversational search | **Workspace knowledge** answers from user-selected saved evidence and/or approved graph-and-vector knowledge bases, with frozen excerpts and displayed citations | Implemented |
| Calendar management and scheduling assistance | Browse connected calendars and events; create a human-reviewed **Scheduling proposal** | Implemented as read-only assistance |
| Task management and reminders | **Actions** workspace with optimistic revisions and durable reminders | Implemented |
| Executive document preparation | Twelve structured work-product choices with editable drafts and durable history | Implemented |
| Information aggregation and executive briefings | **Executive document**, **Briefing note**, **Meeting pack**, and **Cross-document summary** | Implemented |
| Historical decision retrieval | **Historical decision brief**, grounded in selected repositories and saved reports | Implemented |
| Cross-document summarisation | **Cross-document summary** with frozen sources and citations | Implemented |
| Human review and approval | No send or provider-write controls; every draft and proposed action requires a person to review or promote it | Implemented |
| Full auditability | Queue, completion, failure, draft revision, action, reminder, calendar-read, and related assistant events are retained in **Audit** | Implemented |
| Access, privacy and security boundaries | Encrypted provider grants and evidence snapshots, user-and-space isolation, single-use OAuth state, strict schemas, grounding validation, and read-only scopes | Implemented |

## Mailbox experience

The Mailbox workspace follows a familiar three-pane inbox model:

1. connected accounts and mailbox context;
2. searchable, cursor-paginated conversations with unread, starred, attachment and message-count signals;
3. a complete chronological conversation reader with safe plain text and attachment metadata.

The contextual assistant opens alongside the selected conversation. Switching accounts or threads invalidates stale requests so one mailbox cannot display another mailbox's result.

## Work-product evidence

A work product can use any authorised combination of:

- saved survey intelligence;
- saved social-listening intelligence;
- ready graph-and-vector knowledge bases;
- the currently selected mailbox thread;
- a selected calendar event.

The exact source set and excerpts are frozen before generation. Terra must return schema-valid output and may cite only that frozen evidence. Unsupported or unlinked citations fail the job rather than appearing as grounded facts.

## Deliberate Phase 1 boundaries

The following are not silently automated:

- sending, replying to, moving, deleting, starring, or marking provider mail;
- creating, rescheduling, cancelling, or inviting attendees to provider calendar events;
- delivering reminders through email, SMS, push, or another external channel;
- making an executive decision or recording an approval on a person's behalf;
- assigning a human Personal Assistant to impersonate or operate as another user.

Those capabilities require a separate Phase 2 approval workflow, provider write scopes, role/delegation rules, maker-checker controls, notification delivery, and additional audit acceptance tests. The Phase 1 user interface must not imply that any of them occurred.

## Acceptance tests

Release acceptance requires:

- backend type checking and the complete backend suite;
- frontend type checking, unit tests, and production build;
- Playwright desktop and mobile mailbox tests;
- Playwright work-product, evidence, action, reminder, calendar, audit, and no-send tests;
- isolated PostgreSQL migration and runtime-contract verification;
- an authenticated production smoke test after deployment.
