-- Runtime schema 15: durable, replay-safe subscription usage metering.
--
-- The immutable event ledger is the accounting source of truth. Buckets are a
-- materialized acceleration structure and can be reconciled from the ledger.
-- No request bodies, prompts, export contents, or other customer payloads are
-- stored in either table.

CREATE TABLE IF NOT EXISTS platform_usage_events (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  subscription_id TEXT REFERENCES platform_subscriptions(id) ON DELETE SET NULL,
  meter TEXT NOT NULL CHECK(length(meter) BETWEEN 1 AND 80),
  quantity BIGINT NOT NULL CHECK(quantity > 0),
  period_start TEXT NOT NULL CHECK(length(period_start)=24),
  period_end TEXT NOT NULL CHECK(length(period_end)=24 AND period_end > period_start),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  intent_hash TEXT NOT NULL CHECK(intent_hash ~ '^[a-f0-9]{64}$'),
  source_type TEXT NOT NULL CHECK(length(source_type) BETWEEN 1 AND 80),
  source_id TEXT CHECK(source_id IS NULL OR length(source_id) BETWEEN 1 AND 200),
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_usage_events_idempotency
  ON platform_usage_events(space_id,meter,period_start,idempotency_key);
CREATE INDEX IF NOT EXISTS platform_usage_events_space_period
  ON platform_usage_events(space_id,meter,period_start,created_at,id);
CREATE INDEX IF NOT EXISTS platform_usage_events_source
  ON platform_usage_events(source_type,source_id) WHERE source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS platform_usage_buckets (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  meter TEXT NOT NULL CHECK(length(meter) BETWEEN 1 AND 80),
  period_start TEXT NOT NULL CHECK(length(period_start)=24),
  period_end TEXT NOT NULL CHECK(length(period_end)=24 AND period_end > period_start),
  quantity BIGINT NOT NULL DEFAULT 0 CHECK(quantity >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(space_id,meter,period_start)
);
CREATE INDEX IF NOT EXISTS platform_usage_buckets_period
  ON platform_usage_buckets(meter,period_start,space_id);

-- Preserve the historical synchronous-AI accounting records as ledger events.
-- The legacy event id is retained only as a non-sensitive accounting source
-- reference; historical metadata is deliberately not copied.
WITH legacy AS (
  SELECT event.id,event.space_id,event.subscription_id,event.actor_user_id,event.created_at,
    to_char(date_trunc('month',event.created_at::timestamptz AT TIME ZONE 'UTC'),
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') period_start,
    to_char(date_trunc('month',event.created_at::timestamptz AT TIME ZONE 'UTC') + interval '1 month',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') period_end
  FROM platform_subscription_events event
  WHERE event.event_type='usage.ai_action'
)
INSERT INTO platform_usage_events
  (id,space_id,subscription_id,meter,quantity,period_start,period_end,idempotency_key,intent_hash,
    source_type,source_id,actor_user_id,created_at)
SELECT id,space_id,subscription_id,'monthlyAiActions',1,period_start,period_end,
  'legacy-subscription-event:' || id,
  md5('usage.ai_action:' || id) || md5(id || ':usage.ai_action'),
  'legacy_subscription_event',id,actor_user_id,created_at
FROM legacy
ON CONFLICT DO NOTHING;

INSERT INTO platform_usage_buckets(space_id,meter,period_start,period_end,quantity,updated_at)
SELECT space_id,meter,period_start,MAX(period_end),SUM(quantity),MAX(created_at)
FROM platform_usage_events
GROUP BY space_id,meter,period_start
ON CONFLICT(space_id,meter,period_start) DO UPDATE SET
  period_end=excluded.period_end,
  quantity=excluded.quantity,
  updated_at=excluded.updated_at;
