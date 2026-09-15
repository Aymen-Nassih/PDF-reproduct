-- Market data + sellability additions
ALTER TABLE ideas ADD COLUMN sellability INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ideas ADD COLUMN sell_grade TEXT NOT NULL DEFAULT '';
ALTER TABLE ideas ADD COLUMN sell_reasons TEXT NOT NULL DEFAULT '[]';
ALTER TABLE ideas ADD COLUMN product_idea TEXT NOT NULL DEFAULT '{}';
ALTER TABLE ideas ADD COLUMN cross_formats TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_ideas_sellability ON ideas(sellability DESC);
