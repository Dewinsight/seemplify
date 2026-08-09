# Versioned rule-pack schema

Rule packs are immutable once published. Changes are made by cloning a version, validating it, reviewing its impact, and publishing the new version.

## Identity and lifecycle

| Field | Meaning |
| --- | --- |
| `key`, `version` | Stable logical key and monotonically increasing version. The pair is unique. |
| `status` | `draft`, `validated`, `published`, `retired`, or `superseded`. |
| `jurisdiction.kind` | `global`, `regional`, `country`, or `subdivision`. |
| `jurisdiction.regionCode` | Region identifier such as `EU`. |
| `jurisdiction.countryCode` | ISO 3166-1 alpha-2 country code. |
| `jurisdiction.subdivisionCode` | ISO 3166-2 subdivision code when needed. |
| `scope` | Optional organization, location, team, or employee restriction. |
| `effectiveFrom`, `effectiveTo` | UTC instants defining when the version can apply. |
| `parent` | Parent pack key and version for a regional or national overlay. |
| `sources` | Source title, URL, review date, and notes. |
| `lastReviewedAt`, `reviewedBy`, `changeNotes` | Human review evidence. |

## Rules

- `work`: standard daily/weekly hours, maximum weekly hours, work days, and default shift times.
- `breaks`: when a break is required, its minimum duration, and whether it is paid.
- `rest`: minimum daily and weekly rest.
- `overtime`: daily and weekly thresholds, multiplier, and approval requirement.
- `nightWork`: local night window and average-hours limit.
- `rounding`: enablement, increment, and nearest/up/down mode.
- `retention`: attendance retention and raw presence evidence retention. Presence evidence is capped at 90 days.
- `exceptions`: grace periods and excessive-break threshold.

The checked-in Mongoose schema is in `backend/models/AttendanceRulePack.js`. API validation is authoritative and rejects invalid effective ranges, incomplete jurisdiction identifiers, unsafe presence retention, and publication without review evidence.

## Precedence

The calculation service resolves all eligible, effective packs in this order, from least to most specific:

1. Global fallback.
2. Jurisdiction: regional baseline, country, then subdivision.
3. Organization.
4. Location or team.
5. Employee contract override.

More-specific defined values override less-specific values; omitted values inherit. Every timesheet calculation stores the selected pack keys and versions. Times are stored in UTC and interpreted with the employee or work-site IANA timezone.

Published changes do not alter approved history. To apply a newer rule to an approved period, an authorized administrator must launch a correction run. The run preserves the approved source version and creates an audited adjustment version.
