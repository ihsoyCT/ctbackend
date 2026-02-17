#!/usr/bin/env node
// Usage: node import-log.js /path/to/2025-09-17.log

const fs   = require('fs');
const path = require('path');
const db   = require('./db');

const logFile = process.argv[2];
if (!logFile) {
  console.error('Usage: node import-log.js <logfile>');
  process.exit(1);
}

const lines = fs.readFileSync(logFile, 'utf8').split('\n');

// [REQUEST] - [2025-09-17T00:00:06.192Z] - <hash> - <url>
const LINE_RE = /^\[REQUEST\] - \[([^\]]+)\] - ([0-9a-f]+) - (https?:\/\/.+)$/;

const insert = db.prepare(`
  INSERT INTO page_views (ts, date, raw_url, backend, mode, subreddit, author, search_text, referer, user_agent, ip)
  VALUES (@ts, @date, @raw_url, @backend, @mode, @subreddit, @author, @search_text, @referer, @user_agent, @ip)
`);

let imported = 0;
let skipped  = 0;

const importAll = db.transaction(() => {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { skipped++; continue; }

    const m = trimmed.match(LINE_RE);
    if (!m) { skipped++; continue; }

    const [, isoTs, hash, rawUrl] = m;

    let sp;
    try {
      sp = new URL(rawUrl).searchParams;
    } catch {
      skipped++;
      continue;
    }

    const tsMs  = Date.parse(isoTs);
    const ts    = Math.floor(tsMs / 1000);
    const date  = isoTs.slice(0, 10);

    const subreddit   = (sp.get('subreddit') || '').toLowerCase() || null;
    const author      = (sp.get('author')    || '').toLowerCase() || null;
    const search_text = sp.get('q') || sp.get('query') || sp.get('body') || sp.get('title') || sp.get('selftext') || null;
    const backend     = sp.get('backend') || null;
    const mode        = sp.get('mode')    || null;

    insert.run({
      ts, date, raw_url: rawUrl,
      backend, mode, subreddit, author, search_text,
      referer: null, user_agent: null,
      ip: hash,
    });
    imported++;
  }
});

importAll();

console.log(`Done: ${imported} imported, ${skipped} skipped (blank/unmatched lines)`);
