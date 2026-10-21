# Role coverage: full-application HTTP checks

20 October 2026. Hosted proof at source `069a20b0`, CI run `39379560998`; released main `da2e03c3` has the identical source tree. Disposable MongoDB, actual application routes and production indexes. This table is generated from the 709-request proof, with zero mismatched expectations.

Cells show **allowed / denied / boundary** request counts. Allowed means HTTP 2xx/3xx; denied means 401/403; boundary means another deliberately expected status, such as invalid input or missing/deleted data. A count is an exercised request, not a distinct feature or permission grant. Empty cells have no requests in this matrix. The browser/action receipts remain separate.

| API group | Employee | Team lead | Manager | HR manager | Admin | Owner | Dept head | Teamless |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| actions | 2/0/0 | 2/0/0 | 2/0/0 | 2/0/0 | 2/0/0 | 2/0/0 | 2/0/0 | 2/0/0 |
| analytics | 1/1/0 | 2/0/0 | 2/0/0 | 2/0/0 | 2/0/0 | 2/0/0 | 2/0/0 | 1/1/0 |
| appraisals | 39/4/6 | 8/2/0 | 38/2/0 | 10/0/0 | 10/0/0 | 10/0/0 | 8/2/0 | 3/4/0 |
| auth | 1/0/0 | 1/0/0 | 1/0/0 | 1/0/0 | 1/0/0 | 1/0/0 | 1/0/0 | 1/0/0 |
| calibration | 0/1/0 | 0/1/0 | 0/1/0 | 1/0/0 | 1/0/0 | 1/0/0 | 0/1/0 | 0/1/0 |
| check-ins | 4/0/1 | 4/0/1 | 4/0/1 | 4/0/1 | 4/0/1 | 4/0/1 | 4/0/1 | 4/0/1 |
| dashboard | 1/0/0 | 1/0/0 | 1/0/0 | 1/0/0 | 1/0/0 | 1/0/0 | 1/0/0 | 1/0/0 |
| development-plans | 16/3/0 | 4/0/0 | 4/0/0 | 1/0/0 | 1/0/0 | 1/0/0 | 4/0/0 | 1/0/0 |
| feedback | 8/0/0 | 5/0/0 | 5/0/0 | 5/0/0 | 5/0/0 | 5/0/0 | 5/0/0 | 5/0/0 |
| goal-periods | 3/0/0 | 3/0/0 | 3/0/0 | 4/0/0 | 3/0/0 | 3/0/0 | 3/0/0 | 3/0/0 |
| learning | 1/1/0 | 2/0/0 | 2/0/0 | 2/0/0 | 2/0/0 | 2/0/0 | 2/0/0 | 1/1/0 |
| manager-insights | 0/1/0 | 1/0/0 | 1/0/0 | 1/0/0 | 1/0/0 | 1/0/0 | 1/0/0 | 0/1/0 |
| notifications | 3/0/0 | 3/0/0 | 3/0/0 | 3/0/0 | 3/0/0 | 3/0/0 | 3/0/0 | 3/0/0 |
| okrs | 3/1/0 | 3/1/0 | 3/1/0 | 4/0/0 | 4/0/0 | 4/0/0 | 3/1/0 | 3/1/0 |
| one-on-ones | 17/3/0 | 5/0/0 | 5/0/0 | 2/0/0 | 2/0/0 | 2/0/0 | 5/0/0 | 2/0/0 |
| organization-features | 0/1/0 | 0/1/0 | 0/1/0 | 1/0/0 | 1/0/0 | 1/0/0 | 0/1/0 | 0/1/0 |
| performance-projects | 1/0/0 | 3/0/0 | 3/0/0 | 1/0/0 | 1/0/0 | 1/0/0 | 3/0/0 | 1/0/0 |
| recognition | 3/0/0 | 3/0/0 | 3/0/0 | 3/0/0 | 3/0/0 | 3/0/0 | 3/0/0 | 3/0/0 |
| reports | 0/4/0 | 1/3/0 | 1/3/0 | 4/0/0 | 4/0/0 | 4/0/0 | 1/3/0 | 0/4/0 |
| support-plans | 3/1/0 | 1/0/0 | 3/0/0 | 2/0/0 | 1/0/0 | 1/0/0 | 1/0/0 | 1/0/0 |
| talent | 0/3/0 | 2/1/0 | 2/1/0 | 3/0/0 | 3/0/0 | 3/0/0 | 2/1/0 | 0/3/0 |
| user | 6/0/0 | 6/0/0 | 6/0/0 | 6/0/0 | 6/0/0 | 6/0/0 | 6/0/0 | 6/0/0 |

Additional actors/negative contexts: anonymous: 7 requests, foreign: 37 requests, peer: 33 requests.

Functional handoffs include role-scoped goal creation/approval; staff appraisal launch through publication and employee acknowledgement; recognition save/reload/acknowledgement; feedback; development/support-plan progress; calibration decisions/exports; succession nomination; and competency role/assessor/evidence/report actions. The 31 real-API Chrome journeys and UI/fullstack cases verify visible interactions and recovery. The matrix does not certify every production account or external calendar/media provider.

[Final acceptance receipt](ACCEPTANCE_RECEIPT.md) · [Product stories](PRODUCT_STORIES.md)
