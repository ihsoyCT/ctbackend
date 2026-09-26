const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'analytics.db');
const db = new Database(dbPath);

// Must be set before the first table is created to take effect
db.pragma('auto_vacuum = INCREMENTAL');
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  -- One row per search request (thread views are only counted, see below)
  CREATE TABLE IF NOT EXISTS searches (
    id         INTEGER PRIMARY KEY,
    ts         INTEGER NOT NULL,
    date       TEXT    NOT NULL,
    ip         TEXT    NOT NULL,
    backend    TEXT,
    mode       TEXT,
    subreddit  TEXT,
    author     TEXT,
    query      TEXT,
    raw_url    TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_searches_date ON searches(date);

  -- Requests per day by kind: 'search', 'thread', 'other'
  CREATE TABLE IF NOT EXISTS daily_counts (
    date      TEXT    NOT NULL,
    kind      TEXT    NOT NULL,
    requests  INTEGER NOT NULL,
    PRIMARY KEY (date, kind)
  ) WITHOUT ROWID;

  -- Distinct visitors per day (any kind of request)
  CREATE TABLE IF NOT EXISTS daily_visitors (
    date  TEXT NOT NULL,
    ip    TEXT NOT NULL,
    PRIMARY KEY (date, ip)
  ) WITHOUT ROWID;

  -- How far each log file has been imported
  CREATE TABLE IF NOT EXISTS import_state (
    file    TEXT PRIMARY KEY,
    offset  INTEGER NOT NULL,
    updated INTEGER NOT NULL
  );
`);

db.dataDir = dataDir;
db.path = dbPath;

module.exports = db;
