# ADR 0003 — Existing identity authority, private evidence and personal AI

Status: proposed, 18 October 2026. Stories: assignments, evidence, oral assessment, AI and reports.

## Context

IdP owns organization membership and hierarchy. Shared AI is already HMAC-proxied by Performance to Recruiter and keyed by stable personal OIDC subject. Evidence can contain private employee data. Occupational role names must not become access roles.

## Decision

Derive organization and actor from verified current session, refresh scope through existing directory authority and deny when unavailable. Enforce action + resource relationship + org + state on every route, worker and download. Keep private bytes behind authorized storage adapter. Reuse existing call/AI adapters with separate consent and retention provenance. New competency AI uses requester-owned account, app allowlist and permitted evidence only; no tenant-wide fallback to an owner's account. Apply upload quarantine/limits and bounded extraction. Separate view/export/finalize/reopen/exception permissions in IdP.

## Consequences and proof

Unavailable identity/provider creates explicit retry/manual UI rather than stale access or switched account. Report/export must intersect source visibility. Contract tests cover wrong organization/body identity, revoked access after job enqueue, foreign evidence link, export download after access revocation, denied personal AI consent, prompt injection and user-to-user account isolation. Operational logs retain identifiers/action codes, not raw employee text or secrets.
