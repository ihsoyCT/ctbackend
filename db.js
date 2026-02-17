const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'analytics.db'));

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS page_views (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           INTEGER NOT NULL,
    date         TEXT    NOT NULL,
    raw_url      TEXT    NOT NULL,
    backend      TEXT,
    mode         TEXT,
    subreddit    TEXT,
    author       TEXT,
    search_text  TEXT,
    referer      TEXT,
    user_agent   TEXT,
    ip           TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_pv_date      ON page_views(date);
  CREATE INDEX IF NOT EXISTS idx_pv_subreddit ON page_views(subreddit);
`);

// Migration: add ip column for existing databases created before this column existed
try {
  db.exec('ALTER TABLE page_views ADD COLUMN ip TEXT');
} catch {
  // column already exists, ignore
}

module.exports = db;
