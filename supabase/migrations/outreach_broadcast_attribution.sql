-- Tags every outreach_sends row with the id of the specific send it belongs to.
-- Run in Supabase SQL Editor.
--
-- Without this, an ad-hoc admin broadcast (notify-owners) is indistinguishable
-- from any other one — source_type='campaign' with campaign_id=NULL is shared
-- by every such send, so two broadcasts sent minutes apart collapse into one
-- bucket and "did people engage after THIS message" can't be answered. Rules
-- and campaigns already have rule_id/campaign_id for this; broadcast_id gives
-- notify-owners (and anything else calling sendBroadcast) the same anchor.
ALTER TABLE outreach_sends ADD COLUMN IF NOT EXISTS broadcast_id uuid;

CREATE INDEX IF NOT EXISTS idx_outreach_sends_broadcast
  ON outreach_sends (broadcast_id, business_id)
  WHERE broadcast_id IS NOT NULL;
