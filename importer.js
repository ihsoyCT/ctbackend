// Incrementally imports the tracking logs written by ihsoy-api
// (/var/log/ihsoyct-ref/YYYY-MM-DD.log) into the database.
//
// Line formats:
// [REQUEST] - [2026-09-26T17:31:15.417Z] - <sha256 of ip> - <page url>[ - Referer: <r>]
// [BOT] - [2026-09-26T17:31:15.417Z] - <sha256 of ip> - <page url> - <crawler name>
//
// Crawler hits are only counted per day and crawler (kind 'bot:<name>'); they
// are not visitors and never reach the searches table.

const fs   = require('fs');
const path = require('path');
const db   = require('./db');

const LOG_DIR        = process.env.LOG_DIR || '/var/log/ihsoyct-ref';
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '90', 10);
const MIN_FREE_MB    = parseInt(process.env.MIN_FREE_MB || '1024', 10);
const CHUNK_BYTES    = 4 * 1024 * 1024;
const TRACKED_HOSTS  = new Set(['ihsoyct.github.io']);

const LINE_RE = /^\[REQUEST\] - \[([^\]]+)\] - ([0-9a-f]{16,}) - (\S+)/;
const BOT_RE = /^\[BOT\] - \[([^\]]+)\] - [0-9a-f]{16,} - \S+ - ([A-Za-z0-9_.-]{1,40})\s*$/;

const getOffset = db.prepare('SELECT offset FROM import_state WHERE file = ?');
const setOffset = db.prepare(`
  INSERT INTO import_state (file, offset, updated) VALUES (?, ?, ?)
  ON CONFLICT(file) DO UPDATE SET offset = excluded.offset, updated = excluded.updated
`);
const insertSearch = db.prepare(`
  INSERT INTO searches (ts, date, ip, backend, mode, subreddit, author, query, raw_url)
  VALUES (@ts, @date, @ip, @backend, @mode, @subreddit, @author, @query, @raw_url)
`);
const addCount = db.prepare(`
  INSERT INTO daily_counts (date, kind, requests) VALUES (?, ?, 1)
  ON CONFLICT(date, kind) DO UPDATE SET requests = requests + 1
`);
const addVisitor = db.prepare('INSERT OR IGNORE INTO daily_visitors (date, ip) VALUES (?, ?)');

function clip(s, n) {
  return s ? s.slice(0, n) : null;
}

function cutoffDate() {
  return new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString().slice(0, 10);
}

// Returns a parsed record, or null for lines that should be ignored entirely
function parseLine(line, cutoff) {
  const bot = line.match(BOT_RE);
  if (bot) {
    const date = bot[1].slice(0, 10);
    if (Number.isNaN(Date.parse(bot[1])) || date < cutoff) return null;
    return { date, kind: `bot:${bot[2]}` };
  }

  const m = line.match(LINE_RE);
  if (!m) return null;

  const [, isoTs, hash, rawUrl] = m;
  const tsMs = Date.parse(isoTs);
  if (Number.isNaN(tsMs)) return null;
  const date = isoTs.slice(0, 10);
  if (date < cutoff) return null;

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!TRACKED_HOSTS.has(url.hostname.toLowerCase())) return null;

  const sp = url.searchParams;
  const rec = { ts: Math.floor(tsMs / 1000), date, ip: hash.slice(0, 16) };

  if (sp.has('comments') || url.pathname.includes('/comments/')) {
    rec.kind = 'thread';
    return rec;
  }

  const subreddit = (sp.get('subreddit') || '').trim().toLowerCase();
  const author    = (sp.get('author')    || '').trim().toLowerCase();
  const query     = (sp.get('q') || sp.get('query') || sp.get('body') || sp.get('title') || sp.get('selftext') || '').trim();
  if (!subreddit && !author && !query) {
    rec.kind = 'other';
    return rec;
  }

  rec.kind      = 'search';
  rec.backend   = clip(sp.get('backend'), 32);
  rec.mode      = clip(sp.get('mode'), 32);
  rec.subreddit = clip(subreddit, 100);
  rec.author    = clip(author, 100);
  rec.query     = clip(query, 300);
  rec.raw_url   = rawUrl.slice(0, 1000);
  return rec;
}

const importLines = db.transaction((lines, cutoff) => {
  let n = 0;
  for (const line of lines) {
    const rec = parseLine(line, cutoff);
    if (!rec) continue;
    addCount.run(rec.date, rec.kind);
    if (rec.kind.startsWith('bot:')) { n++; continue; }
    addVisitor.run(rec.date, rec.ip);
    if (rec.kind === 'search') insertSearch.run(rec);
    n++;
  }
  return n;
});

function freeMb(dir) {
  const s = fs.statfsSync(dir);
  return (s.bavail * s.bsize) / (1024 * 1024);
}

function importFile(file, cutoff) {
  const full = path.join(LOG_DIR, file);
  const size = fs.statSync(full).size;
  let offset = getOffset.get(file)?.offset ?? 0;
  if (size < offset) offset = 0; // file was replaced
  if (size === offset) return 0;

  let imported = 0;
  const fd = fs.openSync(full, 'r');
  try {
    const buf = Buffer.alloc(CHUNK_BYTES);
    while (offset < size) {
      const read = fs.readSync(fd, buf, 0, Math.min(CHUNK_BYTES, size - offset), offset);
      if (read === 0) break;
      // Only consume complete lines; a partial last line is picked up next run
      const end = buf.lastIndexOf(0x0a, read - 1);
      if (end === -1) break;
      const text = buf.toString('utf8', 0, end).replace(/\0/g, '');
      imported += importLines(text.split('\n'), cutoff);
      offset += end + 1;
      setOffset.run(file, offset, Date.now());
    }
  } finally {
    fs.closeSync(fd);
  }
  return imported;
}

let lowDiskWarned = false;

function runImport() {
  if (freeMb(db.dataDir) < MIN_FREE_MB) {
    if (!lowDiskWarned) console.warn(`[import] less than ${MIN_FREE_MB} MB free, skipping imports`);
    lowDiskWarned = true;
    return 0;
  }
  lowDiskWarned = false;

  let files;
  try {
    files = fs.readdirSync(LOG_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort();
  } catch (err) {
    console.error(`[import] cannot read ${LOG_DIR}: ${err.message}`);
    return 0;
  }

  const cutoff = cutoffDate();
  let total = 0;
  for (const file of files) {
    if (file.slice(0, 10) < cutoff) continue;
    try {
      total += importFile(file, cutoff);
    } catch (err) {
      console.error(`[import] ${file}: ${err.message}`);
    }
  }
  if (total > 0) console.log(`[import] ${total} requests imported`);
  return total;
}

module.exports = { runImport, parseLine, RETENTION_DAYS };

if (require.main === module) {
  runImport();
}
