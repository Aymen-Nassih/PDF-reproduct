-- Global trend discovery (seed-free): what the world is searching/talking about
CREATE TABLE IF NOT EXISTS trends (
  id TEXT PRIMARY KEY,                    -- hash(source:normalized_term)
  term TEXT NOT NULL,
  source TEXT NOT NULL,                   -- google | twitter | hackernews | wikipedia | github | googlenews
  traffic TEXT,                           -- raw traffic/popularity label e.g. "10000+"
  pdf_potential INTEGER NOT NULL DEFAULT 0,
  reasons TEXT NOT NULL DEFAULT '[]',     -- JSON array of strings
  extra TEXT NOT NULL DEFAULT '{}',       -- JSON: url, description, etc.
  first_seen TEXT DEFAULT (datetime('now')),
  last_seen TEXT DEFAULT (datetime('now')),
  seen_count INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_trends_potential ON trends(pdf_potential DESC);
CREATE INDEX IF NOT EXISTS idx_trends_source ON trends(source);
CREATE INDEX IF NOT EXISTS idx_trends_last_seen ON trends(last_seen);
