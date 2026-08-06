# Connected Journey event naming guide

This guide governs protocol `1.0` event names and properties. A tracking plan
must approve names and schemas before production use. Defining a name here does
not mean an ingestion service is deployed or that collecting the data is lawful.

## Event-name grammar

Event names are durable machine contracts, not display labels. They must:

- match `^[a-z][a-z0-9_]*$`;
- use lower `snake_case`, with at most 128 characters;
- describe a completed fact in past tense where possible;
- include a bounded domain prefix when it prevents ambiguity;
- exclude IDs, email addresses, customer names, tenant names and other data;
- exclude environment, schema version and implementation technology;
- avoid leading `_`, `$`, `seemplify_`, `internal_` and other reserved prefixes.

Good examples:

```text
auth_signup_started
auth_signup_completed
onboarding_step_completed
survey_published
survey_first_response_received
intelligence_completed
agreement_completed
feature_limit_reached
```

Do not use `Button Clicked`, `signup-v2`, `michael_created_workspace`,
`prod_survey_published`, or `Auth.Signup.Completed`. Namespaced dots are not part
of protocol v1; use an underscore between domain and fact.

## Call selection

- Use `track` for behavioural or business facts.
- Use `identify` for an approved identity association, never an `identified`
  track event that duplicates identity semantics.
- Use `alias` only for deterministic anonymous-to-known association.
- Use `group` for profile/account membership.
- Use `page` and `screen` for privacy-minimised navigation observations.
- Use `consent` for purpose-specific state changes.
- Use `metric` only from an authorised server for approved operational values.

## Property names and values

Use lower `snake_case` property names, stable business vocabulary and explicit
units. Prefer `duration_seconds` over `duration`; prefer a bounded `plan_code` over
the plan display name. Boolean names should read naturally, such as
`used_template`. Arrays and nested objects require a demonstrated query need.

Never put the following into ordinary event properties:

- passwords, tokens, cookies, API keys or authorisation headers;
- card, bank or payment credentials;
- survey answers, prompts, generated reports, email bodies or document text;
- complete URLs containing query strings or fragments;
- raw exception stacks, local paths or provider payloads;
- email, phone or government identifiers unless an approved classified schema
  explicitly permits them.

Use opaque approved subject references in envelope identity fields. Do not copy
those identifiers into properties.

## Versions and compatibility

`eventVersion` versions the schema, not the event name. Keep the same version for
backward-compatible clarification or relaxed optionality. Increment it when a
consumer needs a different required field, type, meaning, unit or enumeration.
Never silently reuse a property with a new meaning.

Renaming a fact creates a new event contract. During a bounded migration window,
emit both only when the tracking plan explicitly permits it and analytics avoid
double counting. Deprecation records must state replacement, last accepted date,
owner and affected stage rules.

## Review checklist

1. Is this a durable business fact rather than a UI implementation detail?
2. Does an existing event already represent it?
3. Is the authoritative emitter Browser, mobile or server?
4. Are identity and consent prerequisites explicit?
5. Are every property, type, unit, classification and bound declared?
6. Could a smaller or less sensitive payload answer the same question?
7. Are stage rules and metrics resilient to retries and late arrival?
8. Is the owner responsible for schema evolution and deprecation recorded?
