# AI maintainer guide for rule packs

An AI-assisted change may prepare a draft, compare versions, generate tests, and identify missing evidence. It must not assert that a rule is legally correct or publish a jurisdiction pack without the configured human reviewer and approval.

## Required behaviour

- Preserve the ownership boundary: Time & Attendance calculates time; Leave owns leave; Payroll owns pay; Performance owns ratings; IDP owns membership and access.
- Use the schema and precedence order documented here. Never add hidden defaults to the calculator.
- Keep dates as UTC instants and retain the applicable IANA timezone.
- Keep the EU baseline separate from each national overlay.
- Treat all seeded values as templates requiring jurisdictional review.
- Record the source, access/review date, proposed change, and affected fields.
- Use simulation before publication and describe changes in plain language.
- Never recalculate an approved timesheet silently. Use a versioned correction run.
- Do not recommend attendance or presence evidence as an automatic disciplinary, pay, or performance-rating input.

## Change checklist

1. Locate the current published pack and its parent chain.
2. Verify the proposed effective date does not create an accidental gap or overlap.
3. Clone to a new draft version.
4. Make the smallest field-level change.
5. Run schema validation and unit tests.
6. Simulate representative employees and compare totals, exceptions, and rule-version evidence.
7. Present the source and impact to a qualified reviewer.
8. Leave the pack in `validated` state unless a human with publication permission approves it.
