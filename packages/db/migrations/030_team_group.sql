-- 030_team_group.sql — Team group chat (outbound visibility for delegation).
--
-- The delegation loop (029) DMs each team member 1:1. This lets a business
-- register a Telegram GROUP as its team channel so the agent can ALSO post
-- assignments, progress, and the end-of-day standup where the whole team sees
-- them.
--
-- NOTE: this migration originally shipped the group as outbound-only. It is now
-- two-way, but narrowly: handleTeamGroupMessage (delegation.js) engages only
-- when a message is clearly addressed to the bot (@mention, a reply to one of
-- its own posts, or a slash command) AND comes from the owner or a registered
-- supplier. Everyone else still gets silence, so a stray group participant
-- never mints a customer row. Group posts also carry On it / Done / Blocked
-- buttons; taps carry the tapper's id and are authorised the same way.
--
-- business_group_chat_id already exists in the bootstrap schema.sql but was
-- never a migration, so environments built from migrations alone don't have it.
-- Promote it here. Non-null = a team group is configured; presence is the
-- switch (no separate flag column).
--
-- Apply in the Supabase SQL editor — DDL can't run through the service-role
-- key without a PAT.

alter table businesses
  add column if not exists business_group_chat_id bigint;
