# Extending and reviewing rule packs

## Safe publication workflow

1. Clone the closest published or seeded pack in Rule Pack Studio.
2. Set its jurisdiction, scope, effective date, sources, and change notes.
3. Edit only rules supported by the schema. Do not place organization-specific exceptions in a country baseline.
4. Validate the draft and resolve every error.
5. Run the impact preview against representative employees and timesheets, including overnight, multiple-break, overtime, leave, and daylight-saving cases where relevant.
6. Have an authorized jurisdictional reviewer confirm sources and values.
7. Publish the reviewed version. The previous published version is superseded only for future/effective calculations.
8. If approved history must change, launch a correction run and retain its reason, initiator, source version, and output adjustments.

## Adding a jurisdiction

- Use ISO country/subdivision codes and an IANA timezone; do not encode UTC offsets as timezones.
- Add a regional parent only when it is a true baseline. EU national overlays inherit from the EU baseline and must contain national detail separately.
- Keep membership catalogs data-driven. Do not hard-code EU membership logic in the calculator.
- Add source references and a `lastReviewedAt` date.
- Add tests for precedence, effective boundaries, overnight work, and invalid publication.
- Update the seed catalog rather than bypassing Rule Pack Studio with direct database writes.

## Rollback

Publishing a replacement never mutates the previous document. To roll back, select the known-good version in Rule Pack Studio and publish a new version based on it. Do not reactivate an old document in place, because that makes calculation history ambiguous.
