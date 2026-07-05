-- Webhook delivery history — Telegram's own getWebhookInfo only gives a live
-- snapshot (pending count, last error); this gives a real time series so
-- Pulse can compute an actual "webhook success rate" and the retention cron
-- can purge old rows. Populated by lib/server/webhookHealth.js on every
-- custom-bot webhook delivery.
CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGSERIAL PRIMARY KEY,
  business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('success', 'failure', 'timeout')),
  http_status INT,
  response_time_ms INT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_biz_time ON webhook_events(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_time ON webhook_events(created_at DESC);
