-- Create a new API key for deployment automation
INSERT INTO apikey (
    id,
    name,
    key,
    "user_id",
    enabled,
    "created_at",
    "updated_at"
) VALUES (
    gen_random_uuid(),
    'Automated Dev Deployment',
    'auto-deploy-dev-2026-01-14-seemplify-temp-key-12345',
    (SELECT id FROM "user" WHERE email = 'admin@seemplifyai.com' LIMIT 1),
    true,
    NOW(),
    NOW()
)
RETURNING id, name, key;
