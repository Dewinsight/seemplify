# Automation Hub implementation acceptance — 2026-08-17

## Result

The implemented Automation Hub foundation passed its source, contract,
integration, build, automated browser, and in-app browser acceptance on the
local Windows development machine.

## Automated evidence

| Check | Result |
|---|---|
| Hub TypeScript typecheck | passed |
| Hub production Vite/API build | passed; 1,806 web modules transformed |
| Hub integration contracts | 7/7 passed, including signed Identity onboarding and replay suppression |
| Identity suite excluding its pre-existing mail-client contract | 72/72 passed |
| Payroll full suite plus automation contracts | 626/626 passed |
| Leave full suite plus automation contract | 29/29 passed |
| Time full suite plus automation contract | 66/66 passed |
| Full Playwright browser journey | 1/1 passed in 37.3 seconds (51.0 seconds total) |
| Hub production dependency audit | 0 vulnerabilities |
| Static deployment and source validation | YAML/JSON parse, JavaScript syntax, diff check, and credential-pattern scan passed |

The full browser journey created and published workflows through the UI,
triggered internal events, enforced maker-checker, approved exact Payroll,
rejected exact Leave, verified the authoritative product states, injected and
retried a safe failure, enabled and connected Gmail and Drive through the Nango
boundary, ran internal and external slash commands, created and invoked an
incoming webhook, created and delivered a signed outgoing subscription, and
checked the audit trail. It then revoked Gmail in Nango and proved the external
command was no longer available. Enabling an unreviewed connector is covered by
a negative integration contract.

The expanded run also delivered a signed, durable Identity membership event to
the Hub, converted it to the canonical activation contract, executed the four
onboarding actions exactly once, and proved that replaying the IdP event did not
repeat any side effect.

## Existing repository findings outside this change

- The complete Identity test invocation has three failures in
  `test/mail-client.test.mjs`; that file expects validation, idempotency headers,
  and error metadata that the existing mail client does not implement. The
  other 72 Identity checks pass, including all automation, webhook, OIDC, and
  authorization tests.
- Production dependency audits report six inherited issues in Identity and 14
  in Time Attendance. Payroll and Leave do not have lockfiles, so npm cannot
  produce a reproducible audit for them. The new Automation Hub itself audits
  cleanly.

## Independent in-app browser acceptance

A second manual-style pass used the Codex in-app browser against a live isolated
runtime. It:

1. signed in as the workflow owner;
2. created, reviewed, and published the Payroll template;
3. triggered the Payroll-ready event;
4. verified the requester was blocked by maker-checker;
5. signed out and signed in as the independent reviewer;
6. approved the exact action and observed the approved state;
7. verified connected Gmail and Drive accounts;
8. invoked `/gmail-send` and received an authoritative provider outcome;
9. inspected the audit sequence; and
10. found no browser console warning or error entries.

After the connector lifecycle changes, a focused second in-app pass also
verified that unreviewed connectors display as unavailable, Gmail traverses the
Nango authorization and return flow, the connected command succeeds, revocation
deletes the Nango connection, and the command disappears with no console errors.

## Deployment-only gates

These were not falsely represented as local passes:

- Docker is not installed on this workstation, so the production compose stack
  was statically validated but not launched here.
- Real Google OAuth requires production client credentials, consent-screen
  configuration, redirect registration, and any required verification.
- Production OIDC acceptance requires deployment at the registered TLS domains.
- Workspace/Boards/Pages is deployed from a different source checkout; its
  signed target adapter must be released before those recipes are enabled in
  production.
- Learning and future catalogue products require the same target-side adapter
  conformance before their actions are production-enabled.

See `automation-hub/README.md` and
`deploy/hostinger/AUTOMATION-NANGO-RUNBOOK.md` for the operating handoff.
