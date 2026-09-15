-- PDF Trend Lab — schema (D1 / SQLite)

CREATE TABLE IF NOT EXISTS seeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | processing | done | error
  error TEXT,
  fetched_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_seeds_status ON seeds(status);

CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,                       -- md5(canonical tokens)
  title TEXT NOT NULL,
  seed TEXT NOT NULL,
  category TEXT,
  opportunity INTEGER NOT NULL,
  difficulty TEXT NOT NULL,                  -- Easy | Medium | Hard
  interest INTEGER NOT NULL,
  momentum INTEGER NOT NULL,
  competition INTEGER NOT NULL,
  buyer_intent INTEGER NOT NULL,
  demand INTEGER NOT NULL,
  rising INTEGER NOT NULL DEFAULT 0,
  cluster_size INTEGER NOT NULL,
  example_keywords TEXT NOT NULL DEFAULT '[]',  -- JSON array
  sample_questions TEXT NOT NULL DEFAULT '[]',  -- JSON array
  sources TEXT NOT NULL DEFAULT '{}',           -- JSON object
  explain TEXT NOT NULL DEFAULT '{}',           -- JSON object (score breakdown)
  trend_series TEXT NOT NULL DEFAULT '[]',      -- JSON array of numbers
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ideas_opportunity ON ideas(opportunity DESC);
CREATE INDEX IF NOT EXISTS idx_ideas_updated ON ideas(updated_at);

CREATE TABLE IF NOT EXISTS favorites (
  idea_id TEXT PRIMARY KEY REFERENCES ideas(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now'))
);
