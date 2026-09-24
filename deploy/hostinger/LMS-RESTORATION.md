# Stanbic Frappe LMS restoration

Canonical URL: https://lms.seemplifyai.com

Identity's existing LMS hub tile points here through `SIMPLE_LMS_URL`; the
separate Seemplify Learning tile retains its own URL.

This is the original Frappe LMS, separate from `learning.seemplifyai.com`.
It runs as the `seemplify-lms` Compose project on Hostinger, routed through the
existing Dokploy Traefik. Production deployment is owned by the main-branch
workflow, consistently with the other Seemplify production applications.

## Recovery source

`lms/docker/lms-prod-restore.sql` was created on 13 February 2026. It contains
17 courses, 80 chapters, 161 lessons, 3 programmes, 83 quizzes, 373 questions,
7 user records (including Administrator and Guest), and historical enrolments
and quiz submissions. It records Frappe commit
`e703fe959883683ee98f073835065e2fee486e08`, which the image pins for compatibility.
The LMS source version is 2.44.0. This is a historical recovery, not proof that
all records added after that date have been recovered.

The SQL contains file metadata, not file bytes. Missing course/programme covers
are mapped to the versioned Stanbic artwork. All 76 unique Google Drive file
references returned HTTP 200 preview pages during the recovery inspection;
this is not a guarantee of future Drive permissions or playback availability.

## Secrets and login

Root-only `/opt/seemplify/secrets/lms.env` contains the database and OIDC
credentials. The encrypted sibling access vault and AES-256 archive retain
recovery copies. The site encryption key must also be retained in that vault.

Login uses Seemplify Identity. Password and email-link login are disabled on
the LMS. Existing Frappe user records are matched by verified IdP email, and
their production LMS role is replaced with the role derived from the IdP's
authoritative LMS permission matrix. Accounts with no LMS permission are denied.
Historical local password hashes are not accepted for production login.

## Deployment

Run `prepare-lms-secrets.py` once under the production deployment lock to
provision the new credentials and Identity client; then restart the Identity
container to load that client. Subsequent core releases materialize it from
`OIDC_LMS_SECRET` in `core-apps.env`.

`deploy-lms.sh` builds an immutable image labeled with the tested main SHA,
initializes the site only when absent, imports the historical SQL only until
the `.historical-restore-complete` marker exists, migrates schema and applies
the production Identity settings. It does not restore over subsequent student
activity. Persistent data resides in the `seemplify-lms_lms-*` Docker volumes.

For recovery, back up the site database and public/private files together with
the site encryption key. Do not delete the volumes or rerun a historical import
against a site with new student activity.
