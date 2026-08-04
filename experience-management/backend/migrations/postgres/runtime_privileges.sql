-- Runtime privileges are deliberately applied in one transaction. The
-- deployment script replaces the two role placeholders with managed,
-- identifier-safe PostgreSQL role names before executing this file.
BEGIN;

DO $seemplify_privilege_contract$
DECLARE protected_table TEXT;
BEGIN
  FOREACH protected_table IN ARRAY ARRAY[
    'experience_schema_version',
    'schema_migrations',
    'experience_runtime_schema_version',
    'platform_audit_events',
    'platform_subscription_events',
    'ticket_events',
    'assistant_audit_events'
  ] LOOP
    IF to_regclass('public.' || protected_table) IS NULL THEN
      RAISE EXCEPTION 'Required runtime privilege target public.% is missing', protected_table;
    END IF;
  END LOOP;
END
$seemplify_privilege_contract$;

DO $seemplify_admin_rbac_privilege_contract$
DECLARE required_table TEXT;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'platform_rbac_roles',
    'platform_rbac_role_permissions',
    'platform_rbac_user_roles'
  ] LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION 'Required administrator RBAC privilege target public.% is missing', required_table;
    END IF;
  END LOOP;
END
$seemplify_admin_rbac_privilege_contract$;

GRANT CONNECT ON DATABASE __DATABASE__ TO __APP_ROLE__;
GRANT USAGE ON SCHEMA public TO __APP_ROLE__;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO __APP_ROLE__;
GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA public TO __APP_ROLE__;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO __APP_ROLE__;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE
  public.platform_rbac_roles,
  public.platform_rbac_role_permissions,
  public.platform_rbac_user_roles
TO __APP_ROLE__;

ALTER DEFAULT PRIVILEGES FOR ROLE __OWNER_ROLE__ IN SCHEMA public
  GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO __APP_ROLE__;
ALTER DEFAULT PRIVILEGES FOR ROLE __OWNER_ROLE__ IN SCHEMA public
  GRANT USAGE,SELECT,UPDATE ON SEQUENCES TO __APP_ROLE__;
ALTER DEFAULT PRIVILEGES FOR ROLE __OWNER_ROLE__ IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO __APP_ROLE__;

-- Migration metadata is immutable to the application runtime.
REVOKE INSERT,UPDATE,DELETE ON TABLE public.experience_schema_version FROM __APP_ROLE__;
REVOKE INSERT,UPDATE,DELETE ON TABLE public.schema_migrations FROM __APP_ROLE__;
REVOKE INSERT,UPDATE,DELETE ON TABLE public.experience_runtime_schema_version FROM __APP_ROLE__;

-- Operational history is append-only to the application runtime.
REVOKE UPDATE,DELETE ON TABLE public.platform_audit_events FROM __APP_ROLE__;
REVOKE UPDATE,DELETE ON TABLE public.platform_subscription_events FROM __APP_ROLE__;
REVOKE UPDATE,DELETE ON TABLE public.ticket_events FROM __APP_ROLE__;
REVOKE UPDATE,DELETE ON TABLE public.assistant_audit_events FROM __APP_ROLE__;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM __APP_ROLE__;
COMMIT;
