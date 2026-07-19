-- ================================================================
-- MINIME COMPLETE DATABASE SCHEMA
-- Run this ONCE in Supabase SQL Editor
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- 1. BUSINESSES
-- ============================================
CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_telegram_id BIGINT UNIQUE NOT NULL,
  owner_private_chat_id BIGINT,
  business_group_chat_id BIGINT,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  description TEXT,
  location VARCHAR(255) DEFAULT 'Addis Ababa',
  languages TEXT[] DEFAULT ARRAY['am', 'en'],
  owner_name VARCHAR(255),
  owner_phone VARCHAR(50),
  email VARCHAR(255),
  tone VARCHAR(50) DEFAULT 'professional_friendly',
  greeting_style VARCHAR(255) DEFAULT 'ሰላም + Name',
  price_format VARCHAR(50) DEFAULT 'ETB_comma',
  code_switch_style VARCHAR(50) DEFAULT 'amharic_first',
  sample_replies JSONB DEFAULT '[]'::jsonb,
  voice_embedding JSONB DEFAULT '{}'::jsonb,
  trust_level INTEGER DEFAULT 0 CHECK (trust_level BETWEEN 0 AND 3),
  panic_mode BOOLEAN DEFAULT FALSE,
  panic_activated_at TIMESTAMPTZ,
  trust_promoted_at TIMESTAMPTZ,
  subscription_status VARCHAR(20) DEFAULT 'trial' CHECK (subscription_status IN ('trial', 'active', 'expired', 'cancelled')),
  subscription_plan VARCHAR(50) DEFAULT 'pro',
  trial_ends_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days',
  subscription_expires_at TIMESTAMPTZ,
  onboarding_step INTEGER DEFAULT 0,
  onboarding_completed BOOLEAN DEFAULT FALSE,
  consent_at TIMESTAMPTZ,
  consent_version TEXT,
  daily_summary_time VARCHAR(5) DEFAULT '20:00',
  notification_prefs JSONB DEFAULT '{"new_message": true, "ai_approval": true, "daily_summary": true, "low_stock": true}'::jsonb,
  auto_send_confidence_threshold FLOAT DEFAULT 0.85,
  max_auto_reply_length INTEGER DEFAULT 300,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 2. CUSTOMERS
-- ============================================
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  telegram_id BIGINT,
  telegram_username VARCHAR(255),
  name VARCHAR(255),
  phone VARCHAR(50),
  tier VARCHAR(20) DEFAULT 'new' CHECK (tier IN ('new', 'regular', 'vip')),
  tags TEXT[] DEFAULT '{}',
  preferences JSONB DEFAULT '{}'::jsonb,
  sentiment_avg FLOAT DEFAULT 0.5,
  language_preference VARCHAR(10) DEFAULT 'am',
  total_spent DECIMAL(12,2) DEFAULT 0,
  total_orders INTEGER DEFAULT 0,
  last_order_at TIMESTAMPTZ,
  first_contact_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  owner_notes TEXT,
  ai_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, telegram_id)
);

-- ============================================
-- 3. CONVERSATIONS
-- ============================================
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'archived')),
  priority VARCHAR(10) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  last_ai_action VARCHAR(50),
  last_ai_confidence FLOAT,
  requires_owner BOOLEAN DEFAULT FALSE,
  message_count INTEGER DEFAULT 0,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 4. MESSAGES
-- ============================================
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id),
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content TEXT NOT NULL,
  content_type VARCHAR(20) DEFAULT 'text' CHECK (content_type IN ('text', 'image', 'document', 'voice', 'sticker', 'location')),
  media_url TEXT,
  is_ai_generated BOOLEAN DEFAULT FALSE,
  ai_draft TEXT,
  owner_edited BOOLEAN DEFAULT FALSE,
  edit_distance INTEGER DEFAULT 0,
  ai_confidence FLOAT,
  ai_model VARCHAR(50),
  detected_intent VARCHAR(50),
  detected_sentiment VARCHAR(20),
  detected_language VARCHAR(10),
  detected_topics TEXT[] DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'sent' CHECK (status IN ('drafted', 'approved', 'sent', 'failed', 'skipped')),
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  telegram_message_id BIGINT,
  telegram_chat_id BIGINT,
  notification_message_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 5. PRODUCTS
-- ============================================
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  name_am VARCHAR(255),
  description TEXT,
  description_am TEXT,
  category VARCHAR(100),
  price DECIMAL(12,2) NOT NULL,
  cost_price DECIMAL(12,2),
  currency VARCHAR(3) DEFAULT 'ETB',
  stock_quantity INTEGER DEFAULT 0,
  low_stock_threshold INTEGER DEFAULT 10,
  bulk_discount_threshold INTEGER,
  bulk_discount_percent FLOAT,
  max_negotiable_discount FLOAT DEFAULT 0,
  image_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 6. SUPPLIERS
-- ============================================
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  contact_telegram BIGINT,
  contact_phone VARCHAR(50),
  contact_name VARCHAR(255),
  products_supplied TEXT[] DEFAULT '{}',
  avg_delivery_days INTEGER DEFAULT 3,
  reliability_score FLOAT DEFAULT 0.5,
  total_orders INTEGER DEFAULT 0,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 7. AGENT TASKS
-- ============================================
CREATE TABLE agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL CHECK (type IN (
    'supply_reorder', 'delivery_schedule', 'payment_followup',
    'inventory_check', 'customer_followup', 'price_update'
  )),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN (
    'pending', 'awaiting_approval', 'approved', 'in_progress',
    'completed', 'failed', 'cancelled'
  )),
  urgency VARCHAR(10) DEFAULT 'medium' CHECK (urgency IN ('low', 'medium', 'high', 'critical')),
  payload JSONB DEFAULT '{}'::jsonb,
  steps JSONB DEFAULT '[]'::jsonb,
  decision_log JSONB DEFAULT '[]'::jsonb,
  estimated_amount DECIMAL(12,2),
  actual_amount DECIMAL(12,2),
  currency VARCHAR(3) DEFAULT 'ETB',
  customer_id UUID REFERENCES customers(id),
  product_id UUID REFERENCES products(id),
  supplier_id UUID REFERENCES suppliers(id),
  supplier_name VARCHAR(255),
  requires_approval BOOLEAN DEFAULT TRUE,
  approved_by VARCHAR(50),
  approved_at TIMESTAMPTZ,
  notification_message_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 8. PAYMENTS
-- ============================================
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id),
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'ETB',
  method VARCHAR(30) CHECK (method IN ('telebirr', 'cbe_birr', 'cash', 'bank_transfer', 'chapa')),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  direction VARCHAR(10) CHECK (direction IN ('inbound', 'outbound')),
  reference VARCHAR(255),
  chapa_tx_ref VARCHAR(255),
  description TEXT,
  invoice_sent BOOLEAN DEFAULT FALSE,
  invoice_sent_at TIMESTAMPTZ,
  reminder_count INTEGER DEFAULT 0,
  last_reminder_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ============================================
-- 9. DAILY ANALYTICS
-- ============================================
CREATE TABLE daily_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  total_messages INTEGER DEFAULT 0,
  inbound_messages INTEGER DEFAULT 0,
  outbound_messages INTEGER DEFAULT 0,
  ai_drafted INTEGER DEFAULT 0,
  ai_auto_sent INTEGER DEFAULT 0,
  ai_approved INTEGER DEFAULT 0,
  ai_edited INTEGER DEFAULT 0,
  ai_skipped INTEGER DEFAULT 0,
  owner_manual INTEGER DEFAULT 0,
  avg_response_time_seconds INTEGER,
  avg_ai_confidence FLOAT,
  edit_rate FLOAT,
  new_customers INTEGER DEFAULT 0,
  active_customers INTEGER DEFAULT 0,
  revenue DECIMAL(12,2) DEFAULT 0,
  sentiment_positive INTEGER DEFAULT 0,
  sentiment_neutral INTEGER DEFAULT 0,
  sentiment_negative INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, date)
);

-- ============================================
-- 10. ONBOARDING RESPONSES
-- ============================================
CREATE TABLE onboarding_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  question_id VARCHAR(50) NOT NULL,
  question_text TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_business ON messages(business_id, created_at DESC);
CREATE INDEX idx_messages_status ON messages(business_id, status);
CREATE INDEX idx_conversations_business ON conversations(business_id, status);
CREATE INDEX idx_conversations_customer ON conversations(customer_id);
CREATE INDEX idx_conversations_last_message ON conversations(business_id, last_message_at DESC);
CREATE INDEX idx_customers_business ON customers(business_id);
CREATE INDEX idx_customers_tier ON customers(business_id, tier);
CREATE INDEX idx_customers_telegram ON customers(business_id, telegram_id);
CREATE INDEX idx_agent_tasks_business ON agent_tasks(business_id, status);
CREATE INDEX idx_agent_tasks_type ON agent_tasks(business_id, type, status);
CREATE INDEX idx_products_business ON products(business_id, is_active);
CREATE INDEX idx_payments_business ON payments(business_id, status);
CREATE INDEX idx_payments_customer ON payments(customer_id);
CREATE INDEX idx_daily_analytics_date ON daily_analytics(business_id, date DESC);
CREATE INDEX idx_onboarding_business ON onboarding_responses(business_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON businesses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON customers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON conversations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON suppliers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON agent_tasks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON payments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON daily_analytics FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON onboarding_responses FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER businesses_updated_at BEFORE UPDATE ON businesses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER agent_tasks_updated_at BEFORE UPDATE ON agent_tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
