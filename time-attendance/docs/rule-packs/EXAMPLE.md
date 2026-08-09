# Example rule pack

This example is deliberately a draft. Values must be reviewed for the employee's jurisdiction and contract before publication.

```json
{
  "key": "NG-default",
  "name": "Nigeria default",
  "version": 1,
  "status": "draft",
  "jurisdiction": {
    "kind": "country",
    "countryCode": "NG"
  },
  "effectiveFrom": "2026-01-01T00:00:00.000Z",
  "rules": {
    "work": {
      "standardHoursPerDay": 8,
      "standardHoursPerWeek": 40,
      "workDays": [1, 2, 3, 4, 5],
      "defaultStartTime": "09:00",
      "defaultEndTime": "17:00"
    },
    "breaks": {
      "requiredAfterMinutes": 360,
      "minimumBreakMinutes": 30,
      "paid": false
    },
    "overtime": {
      "enabled": true,
      "dailyThresholdHours": 8,
      "weeklyThresholdHours": 40,
      "multiplier": 1.5,
      "requiresApproval": true
    },
    "rounding": {
      "enabled": false,
      "incrementMinutes": 15,
      "mode": "nearest"
    },
    "retention": {
      "attendanceDays": 2555,
      "presenceEventDays": 90
    },
    "exceptions": {
      "lateGraceMinutes": 5,
      "earlyDepartureGraceMinutes": 5,
      "longBreakAfterMinutes": 60
    }
  },
  "sources": [
    {
      "title": "Internal policy review record",
      "url": "https://example.invalid/policy-review",
      "note": "Replace with the approved production source."
    }
  ],
  "reviewRequired": true,
  "changeNotes": "Initial implementation template; not approved for production."
}
```

The seed command is dry-run by default:

```text
npm run rules:seed:dry-run
npm run rules:seed
```

It creates the global fallback, Nigeria, United Kingdom, EU baseline, and data-driven overlays for the 27 EU member states. Seeded packs remain drafts until reviewed.
