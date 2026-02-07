# IDP Employee Onboarding + E-Sign (Internal) Plan

## Summary
Build employee onboarding in the Identity Provider (IDP) so admins can invite members, assign onboarding (general template + custom items), collect employee details, request document uploads, and send contracts for internal e-signatures. Employees see an onboarding banner after login, complete tasks in the IDP, and receive email notifications.

## Goals
- Admins can initiate onboarding for any organization member.
- Onboarding supports:
  - Employee details form(s)
  - Document uploads (Cloudinary)
  - Contract e-signature (internal PDF stamping)
- Employees see a clear onboarding notification after login and can complete tasks in one place.
- Status is tracked (pending/in progress/completed) and visible to admins.

## Non-Goals (v1)
- Deep HRIS integrations (auto-sync to payroll, etc.).
- Complex dynamic forms with nested conditional logic.
- Visual PDF field placement (coordinate entry in v1).

## Assumptions
- E-sign uses internal PDF stamping (no external e-sign provider).
- Cloudinary credentials exist in IDP env (cloud name, API key, API secret).
- IDP remains the central UI for onboarding completion.

## Data Model
### New Models
1. `OnboardingTemplate`
- `organization` (ObjectId)
- `name`, `description`
- `isDefault`
- `items[]`:
  - `type`: `form` | `upload` | `esign`
  - `title`, `description`, `required`
  - `config`:
    - `form`: `fields[]` (label, key, type, required)
    - `upload`: `accept` (file types)
    - `esign`: `document` (Cloudinary url + metadata) + `signatureFields`

2. `OnboardingAssignment`
- `organization`, `member`, `createdBy`
- `template` (optional)
- `status`: `pending` | `in_progress` | `completed`
- `items[]`:
  - `type`, `title`, `description`, `required`, `config`
  - `status`: `pending` | `submitted` | `completed`
  - `data`:
    - `form`: values
    - `upload`: Cloudinary file metadata
    - `esign`: signed document metadata

## API Endpoints (Proposed)
### Admin
- `GET /api/organizations/:orgId/onboarding/templates`
- `POST /api/organizations/:orgId/onboarding/templates`
- `PATCH /api/organizations/:orgId/onboarding/templates/:templateId`
- `DELETE /api/organizations/:orgId/onboarding/templates/:templateId`

- `POST /api/organizations/:orgId/onboarding/assign`
- `GET /api/organizations/:orgId/onboarding/assignments`

- `POST /api/organizations/:orgId/onboarding/documents` (Cloudinary upload for e-sign docs)

### Employee
- `GET /api/onboarding/my`
- `POST /api/onboarding/:assignmentId/items/:itemId/form`
- `POST /api/onboarding/:assignmentId/items/:itemId/upload`
- `POST /api/onboarding/:assignmentId/items/:itemId/esign/complete` (submit signature data URL)

## UI/UX
### Admin
- New page: `/organizations/:orgId/onboarding`
  - Templates list + Create Template modal
  - Assign onboarding to member (use default template + custom items)
  - Assignment list with status

### Employee
- New page: `/onboarding`
  - List active onboarding assignments
  - Inline task completion (form submit, doc upload, internal e-sign modal)

### Notifications
- Banner on IDP home page when user has pending onboarding
- Email on assignment creation with link to `/onboarding`

## Integrations
### Cloudinary (Uploads)
- Use `cloudinary` SDK + `multer` (memory storage).
- Store file metadata in assignment item `data.upload` or `config.document`.

### Internal E-Sign
- Use `pdf-lib` to stamp signature/date/text fields onto the uploaded PDF.
- Capture signature as canvas data URL, store signed PDF in Cloudinary.
- Save signed document metadata in assignment item data.

## Implementation Steps
1. Add new models: `OnboardingTemplate`, `OnboardingAssignment`.
2. Add Cloudinary service + env variables in `.env.example`.
3. Implement onboarding API routes.
4. Add admin onboarding page + member onboarding page (EJS).
5. Add home-page onboarding banner + optional nav link.
6. Wire email notification on assignment creation.

## Open Questions
- Should onboarding be auto-created immediately after invite acceptance (if default template exists)?
- Should HR Manager role be allowed to manage onboarding (default: yes)?
- Should completion trigger a summary email to admins?

## Risks
- Cloudinary missing -> e-sign will be disabled (should surface error cleanly).
- Large file uploads: enforce size limits and allow only PDF for signing.

## Verification
- Create template -> assign -> employee completes all steps.
- Verify pending banner + email.
- Verify internal signing flow updates status.
- Verify admin sees updated status in onboarding admin page.
