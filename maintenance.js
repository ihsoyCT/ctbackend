// Keeps the database bounded: drops data older than RETENTION_DAYS and, if the
// database is still above MAX_DB_MB, drops the oldest days until it fits.

const db = require('./db');
const { RETENTION_DAYS } = require('./importer');

const MAX_DB_MB = parseInt(process.env.MAX_DB_MB || '2048', 10);

const DATED_TABLES = ['searches', 'daily_counts', 'daily_visitors'];
const deleteBefore = DATED_TABLES.map(t => db.prepare(`DELETE FROM ${t} WHERE date < ?`));
const oldestDate   = db.prepare(`
  SELECT MIN(date) AS d FROM (
    SELECT MIN(date) AS date FROM searches
    UNION ALL SELECT MIN(date) FROM daily_counts
    UNION ALL SELECT MIN(date) FROM daily_visitors
  )
`);

function usedMb() {
  const pageSize = db.pragma('page_size', { simple: true });
  const pages    = db.pragma('page_count', { simple: true });
  const free     = db.pragma('freelist_count', { simple: true });
  return ((pages - free) * pageSize) / (1024 * 1024);
}

const dropBefore = db.transaction(date => {
  for (const stmt of deleteBefore) stmt.run(date);
});

function runMaintenance() {
  const today  = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString().slice(0, 10);
  dropBefore(cutoff);

  // Size cap: drop whole days, oldest first, but never today
  while (usedMb() > MAX_DB_MB) {
    const oldest = oldestDate.get().d;
    if (!oldest || oldest >= today) break;
    console.warn(`[maintenance] database above ${MAX_DB_MB} MB, dropping ${oldest}`);
    const next = new Date(Date.parse(oldest) + 86400000).toISOString().slice(0, 10);
    dropBefore(next);
  }

  db.pragma('incremental_vacuum');
  db.pragma('wal_checkpoint(TRUNCATE)');
  console.log(`[maintenance] done, database uses ${usedMb().toFixed(1)} MB`);
}

module.exports = { runMaintenance, usedMb };

if (require.main === module) {
  runMaintenance();
}
