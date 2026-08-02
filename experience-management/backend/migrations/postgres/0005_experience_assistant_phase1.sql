-- Runtime schema 5: governed Phase-1 executive-assistant capabilities.
-- This migration remains non-mutating toward external providers: work products,
-- actions and reminders are internal records, while Nylas access remains read-only.

ALTER TABLE assistant_runs
  DROP CONSTRAINT IF EXISTS assistant_runs_kind_check;

ALTER TABLE assistant_runs
  ADD CONSTRAINT assistant_runs_kind_check CHECK(kind IN (
    'email_summary',
    'email_draft',
    'knowledge_answer',
    'work_product'
  ));

ALTER TABLE assistant_runs
  ADD COLUMN IF NOT EXISTS document_type TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS knowledge_base_ids_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE assistant_runs
  DROP CONSTRAINT IF EXISTS assistant_runs_document_type_check;

ALTER TABLE assistant_runs
  ADD CONSTRAINT assistant_runs_document_type_check CHECK(
    document_type IS NULL OR document_type IN (
      'correspondence',
      'memo',
      'report',
      'board_paper',
      'meeting_pack',
      'briefing_note',
      'meeting_minutes',
      'executive_document',
      'cross_document_summary',
      'historical_decision_brief',
      'policy_lookup',
      'scheduling_proposal'
    )
  );

CREATE TABLE IF NOT EXISTS assistant_actions (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_run_id TEXT REFERENCES assistant_runs(id) ON DELETE SET NULL,
  source_item_index INTEGER,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','completed','cancelled')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
  due_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS assistant_actions_owner_history
  ON assistant_actions(space_id,created_by,status,created_at DESC,id);
CREATE UNIQUE INDEX IF NOT EXISTS assistant_actions_source_item
  ON assistant_actions(space_id,created_by,source_run_id,source_item_index)
  WHERE source_run_id IS NOT NULL AND source_item_index IS NOT NULL;

CREATE TABLE IF NOT EXISTS assistant_reminders (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL REFERENCES assistant_actions(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  remind_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'scheduled' CHECK(state IN ('scheduled','dismissed','completed')),
  revision INTEGER NOT NULL DEFAULT 1,
  delivered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS assistant_reminders_owner_schedule
  ON assistant_reminders(space_id,created_by,state,remind_at,id);

CREATE TABLE IF NOT EXISTS assistant_audit_events (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS assistant_audit_events_owner_history
  ON assistant_audit_events(space_id,actor_user_id,created_at DESC,id);
