-- Runtime schema 9: versioned subscription plan definitions managed through
-- the platform administration control plane.

CREATE TABLE IF NOT EXISTS platform_subscription_plans (
  code TEXT PRIMARY KEY CHECK (code IN ('starter','team','enterprise')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  requestable INTEGER NOT NULL DEFAULT 1 CHECK (requestable IN (0,1)),
  features_json TEXT NOT NULL,
  limits_json TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO platform_subscription_plans
  (code,name,description,requestable,features_json,limits_json,display_order,version,created_at,updated_at)
VALUES
  ('starter','Starter','Core experience management for a small team.',1,
    '{"surveys":true,"campaigns":true,"agreements":true,"serviceRecovery":true,"socialListening":false,"knowledgeBases":false,"terra":true}',
    '{"seats":3,"activeSurveys":10,"monthlyAiActions":100,"knowledgeStorageBytes":0}',
    10,1,'2026-08-04T00:00:00.000Z','2026-08-04T00:00:00.000Z'),
  ('team','Team','Collaboration, intelligence, listening, and knowledge workflows.',1,
    '{"surveys":true,"campaigns":true,"agreements":true,"serviceRecovery":true,"socialListening":true,"knowledgeBases":true,"terra":true}',
    '{"seats":25,"activeSurveys":250,"monthlyAiActions":5000,"knowledgeStorageBytes":21474836480}',
    20,1,'2026-08-04T00:00:00.000Z','2026-08-04T00:00:00.000Z'),
  ('enterprise','Enterprise','Managed limits and governance for larger organisations.',1,
    '{"surveys":true,"campaigns":true,"agreements":true,"serviceRecovery":true,"socialListening":true,"knowledgeBases":true,"terra":true}',
    '{"seats":250,"activeSurveys":5000,"monthlyAiActions":100000,"knowledgeStorageBytes":214748364800}',
    30,1,'2026-08-04T00:00:00.000Z','2026-08-04T00:00:00.000Z')
ON CONFLICT (code) DO NOTHING;
