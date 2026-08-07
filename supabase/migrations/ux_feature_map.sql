-- Feature-usage ranking for the MiniMe Agent Mini App.
-- Run in Supabase SQL Editor AFTER ux_events.sql.
--
-- Answers the question we currently cannot answer at all: of the ~50 screens in
-- the Mini App, which do owners actually use, which do they come back to, and
-- which are dead weight?
--
-- Routes are mapped to feature names through a LOOKUP TABLE rather than a CASE
-- expression, so adding a screen is an INSERT and not a migration rewrite. That
-- matters here specifically: the surface area is large and still growing, and a
-- CASE would drift out of date silently.

CREATE TABLE IF NOT EXISTS ux_feature_map (
  route_pattern TEXT PRIMARY KEY,   -- must match Tracker's normalizeRoute() output
  feature       TEXT NOT NULL,
  area          TEXT NOT NULL       -- 'core' | 'agent' | 'sales' | 'growth' | 'settings' | 'public'
);

INSERT INTO ux_feature_map (route_pattern, feature, area) VALUES
  -- Core
  ('/',                       'Home',                'core'),
  ('/home',                   'Home',                'core'),
  ('/onboarding',             'Onboarding',          'core'),
  ('/progress',               'Progress',            'core'),
  ('/achievements',           'Achievements',        'core'),
  ('/analytics',              'Analytics',           'core'),
  -- The MiniMe agent itself
  ('/advisor',                'MiniMe Advisor',      'agent'),
  ('/advisor/teach',          'Advisor Teach',       'agent'),
  ('/agent',                  'Agent',               'agent'),
  ('/agent/brain',            'Agent Brain',         'agent'),
  ('/agent/knowledge',        'Agent Knowledge',     'agent'),
  ('/agent/team',             'Agent Team',          'agent'),
  ('/agent/[id]',             'Agent Detail',        'agent'),
  ('/assistant',              'Assistant',           'agent'),
  ('/teach',                  'Teach',               'agent'),
  ('/memory',                 'Memory',              'agent'),
  ('/documents',              'Documents',           'agent'),
  ('/tasks',                  'Tasks',               'agent'),
  -- Sales
  ('/conversations',          'Conversations',       'sales'),
  ('/conversations/[id]',     'Conversation Detail', 'sales'),
  ('/customers',              'Customers',           'sales'),
  ('/customers/[id]',         'Customer Detail',     'sales'),
  ('/orders',                 'Orders',              'sales'),
  ('/orders/[id]',            'Order Detail',        'sales'),
  ('/products',               'Products',            'sales'),
  ('/catalog',                'Catalog',             'sales'),
  ('/pipeline',               'Pipeline',            'sales'),
  -- Growth
  ('/broadcast',              'Broadcast',           'growth'),
  ('/discounts',              'Discounts',           'growth'),
  ('/reminders',              'Reminders',           'growth'),
  ('/b2b',                    'B2B',                 'growth'),
  -- Settings (23 subpages — the long tail most likely to contain dead screens)
  ('/settings',               'Settings Home',       'settings'),
  ('/settings/audit',         'Settings: Audit',         'settings'),
  ('/settings/billing',       'Settings: Billing',       'settings'),
  ('/settings/bot',           'Settings: Bot',           'settings'),
  ('/settings/card',          'Settings: Card',          'settings'),
  ('/settings/channel',       'Settings: Channel',       'settings'),
  ('/settings/channels',      'Settings: Channels',      'settings'),
  ('/settings/character',     'Settings: Character',     'settings'),
  ('/settings/commands',      'Settings: Commands',      'settings'),
  ('/settings/email',         'Settings: Email',         'settings'),
  ('/settings/faq',           'Settings: FAQ',           'settings'),
  ('/settings/hours',         'Settings: Hours',         'settings'),
  ('/settings/modes',         'Settings: Modes',         'settings'),
  ('/settings/network',       'Settings: Network',       'settings'),
  ('/settings/notifications', 'Settings: Notifications', 'settings'),
  ('/settings/payments',      'Settings: Payments',      'settings'),
  ('/settings/people',        'Settings: People',        'settings'),
  ('/settings/personalize',   'Settings: Personalize',   'settings'),
  ('/settings/profile',       'Settings: Profile',       'settings'),
  ('/settings/search',        'Settings: Search',        'settings'),
  ('/settings/staff',         'Settings: Staff',         'settings'),
  ('/settings/trust',         'Settings: Trust',         'settings'),
  ('/settings/voice',         'Settings: Voice',         'settings'),
  -- Public surfaces
  ('/market',                 'Market',              'public'),
  ('/directory/[id]',         'Directory Profile',   'public'),
  ('/shop/[id]',              'Shop Storefront',     'public'),
  ('/connect',                'Connect',             'public'),
  ('/login',                  'Login',               'public')
ON CONFLICT (route_pattern) DO UPDATE SET feature = EXCLUDED.feature, area = EXCLUDED.area;

ALTER TABLE ux_feature_map ENABLE ROW LEVEL SECURITY;

-- Resolved event stream. Unmapped routes surface as 'Unmapped: <route>' rather
-- than being dropped — a route missing from the seed must be visible, not
-- silently excluded from the ranking it would have changed.
CREATE OR REPLACE VIEW ux_events_resolved AS
SELECT
  e.*,
  COALESCE(m.feature, 'Unmapped: ' || COALESCE(e.route, '?')) AS feature,
  COALESCE(m.area, 'unmapped')                                AS area
FROM ux_events e
LEFT JOIN ux_feature_map m ON m.route_pattern = e.route;

-- ── The headline ranking ────────────────────────────────────────────────────
-- Ordered by unique_businesses, NOT clicks. Ranking by raw clicks would put a
-- fiddly screen that takes six taps to do one thing above a well-designed screen
-- that takes one — i.e. it would reward the exact thing we want to fix.
CREATE OR REPLACE VIEW ux_feature_usage AS
SELECT
  day,
  feature,
  area,
  COUNT(*) FILTER (WHERE event = 'click')            AS clicks,
  COUNT(*) FILTER (WHERE event = 'nav')              AS views,
  COUNT(DISTINCT session_id)                         AS sessions,
  COUNT(DISTINCT business_id)                        AS unique_businesses,
  COUNT(DISTINCT tg_user_id)                         AS unique_users,
  PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY (meta->>'ms')::numeric
  ) FILTER (WHERE event = 'dwell')                   AS median_dwell_ms
FROM (SELECT *, date_trunc('day', created_at) AS day FROM ux_events_resolved) r
GROUP BY day, feature, area;

-- What fraction of businesses have ever touched each feature (last 30 days).
CREATE OR REPLACE VIEW ux_feature_adoption AS
WITH active AS (
  SELECT COUNT(*)::numeric AS total
  FROM businesses
  WHERE subscription_status IN ('trial', 'active')
), used AS (
  SELECT feature, area, COUNT(DISTINCT business_id) AS businesses
  FROM ux_events_resolved
  WHERE created_at > now() - INTERVAL '30 days' AND business_id IS NOT NULL
  GROUP BY feature, area
)
SELECT
  u.feature,
  u.area,
  u.businesses,
  a.total AS active_businesses,
  ROUND(100.0 * u.businesses / NULLIF(a.total, 0), 1) AS adoption_pct
FROM used u CROSS JOIN active a;

-- Tried vs relied on: of the businesses that used a feature in a given week, how
-- many came back to it the following week. A feature with high adoption and near
-- zero stickiness is a curiosity, not a product.
CREATE OR REPLACE VIEW ux_feature_stickiness AS
WITH weekly AS (
  SELECT DISTINCT feature, area, business_id, date_trunc('week', created_at) AS wk
  FROM ux_events_resolved
  WHERE business_id IS NOT NULL
)
SELECT
  w.feature,
  w.area,
  w.wk AS week,
  COUNT(*)                                       AS businesses,
  COUNT(n.business_id)                           AS returned_next_week,
  ROUND(100.0 * COUNT(n.business_id) / NULLIF(COUNT(*), 0), 1) AS retention_pct
FROM weekly w
LEFT JOIN weekly n
  ON n.feature = w.feature
 AND n.business_id = w.business_id
 AND n.wk = w.wk + INTERVAL '1 week'
GROUP BY w.feature, w.area, w.wk;

-- Removal candidates: mapped features that fewer than 3 businesses touched in 30
-- days. Includes features with ZERO events via the LEFT JOIN — a screen nobody
-- opened produces no rows, so an inner join would hide exactly what we're after.
CREATE OR REPLACE VIEW ux_dead_features AS
SELECT
  m.feature,
  m.area,
  COALESCE(COUNT(DISTINCT e.business_id), 0) AS businesses_30d,
  COALESCE(COUNT(e.id), 0)                   AS events_30d
FROM ux_feature_map m
LEFT JOIN ux_events e
  ON e.route = m.route_pattern
 AND e.created_at > now() - INTERVAL '30 days'
GROUP BY m.feature, m.area
HAVING COUNT(DISTINCT e.business_id) < 3
ORDER BY businesses_30d ASC, events_30d ASC;

-- Bottom-nav split. The design assumes the raised centre "MiniMe" button is the
-- centre of gravity; this is the number that confirms or refutes that.
CREATE OR REPLACE VIEW ux_nav_tabs AS
SELECT
  date_trunc('day', created_at) AS day,
  intent,
  COUNT(*)                    AS taps,
  COUNT(DISTINCT business_id) AS businesses
FROM ux_events
WHERE event = 'click' AND intent LIKE 'nav.tab.%'
GROUP BY day, intent;
