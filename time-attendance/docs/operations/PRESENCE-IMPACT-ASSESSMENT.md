# Presence monitoring impact-assessment checklist

Complete and approve this checklist for each organization and jurisdiction before enabling application-presence evidence.

- [ ] Record the specific attendance problem and why less intrusive evidence is insufficient.
- [ ] Identify the lawful basis and complete any required worker consultation.
- [ ] Confirm enabled applications are limited to the approved registry and candidate/public activity is excluded.
- [ ] Verify a captured-event sample contains no field values, typed text, query strings, document content, screenshots, camera images, or biometric data.
- [ ] Set raw retention to the shortest necessary value, never more than 90 days, and define summary retention.
- [ ] Publish an employee notice covering purpose, fields, comparison states, retention, access, export, and deletion rights.
- [ ] Confirm employees can see/export their own evidence and submit a privacy request.
- [ ] Confirm manager scope, HR permission, and all review/export/delete access logging.
- [ ] Confirm stale/unavailable evidence is represented honestly and browser-push denial has a channel fallback.
- [ ] Confirm no automated rule can reduce pay, reject time, discipline a worker, create a productivity score, or alter a performance rating from presence evidence.
- [ ] Test multi-tab, hidden-tab, stale-session, logout, forged identity, employee exit, retention deletion, and incident-response cases.
- [ ] Name the privacy/security approvers, review date, next review date, and rollback owner.

Before enabling the retention job on an upgraded database, run `npm run indexes:modernize:dry-run` and then the approved `npm run indexes:modernize` operation from `time-attendance/backend`. This replaces the legacy fixed TTL index so raw events are summarized before organization-specific deletion.

The live application also exposes this checklist from the presence API so it can be shown beside organization-specific notices and controls.
