-- 041_supplier_role_freeform.sql — Stop hardcoding the team-role list in the DB
--
-- The dashboard's role dropdown already offered "Accountant", but
-- suppliers_role_check (from 009_agent_team.sql) never included it — so
-- picking it failed validation before the request even reached the DB
-- (api/agent/team's own ROLES array was missing it too, same bug in two
-- places). Rather than patch the enum for one missing value and hit this
-- again for the next one, drop the DB-level CHECK and let the app layer
-- (api/agent/team/route.js, api/agent/team/[id]/route.js) own the list —
-- the same pattern suppliers.contact_channel already uses (no DB CHECK).

ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_role_check;
