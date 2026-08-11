-- 035_b2b_network.sql — B2B Autonomous Layer Foundation.
-- Adds Capability Manifests and B2B Negotiation tracking.

-- 1. BUSINESS MANIFESTS
-- This is the "Digital Storefront" that other bots query.
CREATE TABLE business_manifests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_name VARCHAR(255) NOT NULL,
  description TEXT,
  min_price DECIMAL(12,2) NOT NULL,
  max_price DECIMAL(12,2),
  currency VARCHAR(3) DEFAULT 'ETB',
  tags TEXT[] DEFAULT '{}',
  availability_status VARCHAR(20) DEFAULT 'available' CHECK (availability_status IN ('available', 'limited', 'busy', 'offline')),
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, service_name)
);

-- 2. B2B NEGOTIATIONS
-- Tracks the state of an autonomous deal between two minime bots.
CREATE TABLE b2b_negotiations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_business_id UUID NOT NULL REFERENCES businesses(id),
  target_business_id UUID NOT NULL REFERENCES businesses(id),
  service_id UUID REFERENCES business_manifests(id),
  current_status VARCHAR(20) DEFAULT 'negotiating' CHECK (current_status IN ('negotiating', 'accepted', 'rejected', 'escalated', 'expired')),
  current_offer DECIMAL(12,2),
  currency VARCHAR(3) DEFAULT 'ETB',
  round_count INTEGER DEFAULT 0,
  max_rounds INTEGER DEFAULT 5,
  agreed_slot TIMESTAMPTZ,
  handshaked_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. INDEXES for fast B2B discovery
CREATE INDEX idx_manifest_tags ON business_manifests USING GIN (tags);
CREATE INDEX idx_manifest_service ON business_manifests(service_name);
CREATE INDEX idx_b2b_negotiation_status ON b2b_negotiations(current_status);

-- 4. UPDATING BUSINESSES TABLE for Agency Levels
-- Adding columns to handle the "Ghost/Agent/Partner" levels for B2B.
ALTER TABLE businesses 
ADD COLUMN IF NOT EXISTS b2b_agency_level INTEGER DEFAULT 1 CHECK (b2b_agency_level BETWEEN 1 AND 3),
ADD COLUMN IF NOT EXISTS secretary_account_id VARCHAR(255);
