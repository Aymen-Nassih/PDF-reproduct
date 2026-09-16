-- Data-driven market metrics per trend
ALTER TABLE trends ADD COLUMN metrics TEXT NOT NULL DEFAULT '{}';
ALTER TABLE trends ADD COLUMN buyer_formats INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_trends_buyer ON trends(buyer_formats DESC);
