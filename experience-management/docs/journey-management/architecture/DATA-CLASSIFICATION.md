# Journey Management data classification

**State:** Draft for security/privacy ratification  
**Default:** Deny collection or display unless the field has an approved purpose,
source policy, retention, access capability, and deletion path.

| Class | Examples | Storage and access default | Logging/debug default |
| --- | --- | --- | --- |
| Public product metadata | Published template name, SDK version, protocol version | Ordinary protected application storage | Allowed when content-free |
| Internal operational metadata | Receipt ID, source ID, schema name/version, queue state, counts, latency | Space-scoped; support access audited | Allowed without customer content/identifiers |
| Customer configuration | Journey/map metadata, source settings, schemas, workflow definitions | Encrypted transport/storage controls; role/capability scoped | IDs and state only |
| Research/customer content | Map cards, survey answers, excerpts, social/email/agreement/ticket content | Source permission plus journey permission; bounded copies only | Prohibited in ordinary logs; redacted short-retention debugger only |
| Pseudonymous interaction data | Anonymous ID, event properties, session/device context, journey instances | Purpose/consent/retention scoped; public key write only | Routing hashes/receipt IDs only |
| Direct identifiers | Email, phone, external customer ID, name, address | Disabled unless approved; keyed hash for equality and encryption only when retrieval is required | Prohibited |
| Sensitive/special-category content | Health, biometrics, precise location, government identifiers, protected traits | Default prohibited; requires explicit product, security/privacy, purpose, residency, retention, and access approval | Prohibited, including debugger |
| Credentials and secrets | Passwords, OAuth codes/tokens, public/server secret material, signing secrets | Never event properties; secrets protected and shown once where applicable | Prohibited; fingerprints/prefixes only |
| Payment/security authentication data | Card details, CVV, bank credentials, MFA/recovery material | Prohibited from journey event/evidence payloads | Prohibited |

## Tracking-plan field policy

Every approved event property records:

- Name, type, meaning, owner, schema version, and example containing no real
  personal data.
- Data class, purpose, consent/lawful-policy condition, allowed sources, and
  whether it may identify, segment, display, export, or trigger action.
- Maximum length/cardinality/nesting and whether it may be promoted for query.
- Retention, redaction, debugger visibility, regional restriction, and deletion
  lineage.
- Compatibility and deprecation rules.

Undeclared direct identifiers, content-bearing free text, query strings,
fragments, credentials, payment fields, and prototype-pollution keys are denied.
IP, raw user-agent, and geolocation collection are disabled/truncated unless an
approved purpose and retention explicitly requires them.

## Seemplify dogfood prohibitions

The initial internal tracking plan must never include passwords, verification
or OAuth tokens, AI prompts or generated reports, survey questions/answers,
document or agreement contents, email/social bodies, recipient PII, raw provider
exceptions, billing credentials, or attempted content that hit a feature limit.

## Derived data

Inferences, persona assignments, segment memberships, risk indicators, and AI
interpretations retain their source/version/confidence and are visually/API
distinct from observed or verified facts. Derived data inherits the most
restrictive applicable purpose, access, retention, suppression, and deletion
policy of its inputs.

