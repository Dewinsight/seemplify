# Payroll to Leave unpaid-leave integration

Payroll reads approved unpaid leave from Leave Management through:

`POST /api/internal/payroll/unpaid-leave-summary`

The JSON body contains `organizationId`, `userId`, `startDate`, and `endDate`.
Dates use `YYYY-MM-DD` and the requested range is inclusive. The Leave service
always applies the organization and employee scope itself, selects only
approved `unpaid` requests, clips requests to the requested range, and applies
the organization leave policy's timezone, working days, and holidays.
The response includes both approved `unpaidDays` and `workingDaysInPeriod`.
Payroll divides the employee's earned basic pay for that period by the latter,
so it does not assume a fixed 30-day month or deduct a full-month daily rate
from a prorated joiner or terminator.

## Authentication

The endpoint does not accept a browser session or the legacy generic internal
API key. Payroll signs the exact UTF-8 request bytes using HMAC-SHA-256 and a
service-specific secret. Configure the same strong random value (at least 32
bytes) as `PAYROLL_LEAVE_SHARED_SECRET` in both services. Generate it in a
secret manager or with a cryptographically secure generator such as
`openssl rand -hex 32`; do not commit the value.
Both production services refuse to start when this secret is missing, short,
an obvious placeholder, or low-diversity.

The v2 canonical request is the concatenation of these values, separated by a
newline, followed immediately by the unmodified request bytes:

1. `v2`
2. service ID
3. Unix timestamp in milliseconds
4. random nonce
5. uppercase HTTP method
6. exact path
7. raw JSON body

Payroll sends `x-seemplify-service-id`, `x-seemplify-timestamp`,
`x-seemplify-nonce`, and `x-seemplify-signature` (`v2=<hex digest>`). Leave
allows five minutes of clock skew and atomically records a hash of each nonce
in MongoDB. The unique index is the cross-instance replay boundary; its TTL is
only cleanup. If signature verification, nonce storage, policy lookup, or leave
data fails, payroll calculation fails closed for the affected employee.

Keep both service clocks synchronized. Do not configure redirects between
Payroll and the internal endpoint because the HTTP path is part of the
signature.
