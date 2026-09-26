const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { runImport } = require('./importer');
const { runMaintenance } = require('./maintenance');
const stats = require('./routes/stats');

const PORT = parseInt(process.env.PORT || '3031', 10);
const HOST = process.env.HOST || '127.0.0.1';
const API_KEY = process.env.API_KEY || '';
const IMPORT_INTERVAL_MS  = 60 * 1000;
const STATS_INTERVAL_MS   = parseInt(process.env.STATS_REFRESH_MIN || '10', 10) * 60 * 1000;
const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;

if (!API_KEY) console.warn('API_KEY is not set, all /api requests will be refused');

function keyMatches(given) {
  if (!API_KEY || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(API_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const app = express();
app.disable('x-powered-by');

app.use('/api', (req, res, next) => {
  if (!keyMatches(req.get('x-api-key') || req.query.key)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
});
app.use('/api/stats',  stats.router);
app.use('/api/search', require('./routes/search'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/health', (req, res) => res.json({ ok: true }));

// Background jobs. better-sqlite3 is synchronous, so these never overlap.
function safely(name, fn) {
  return () => {
    try {
      fn();
    } catch (err) {
      console.error(`[${name}] ${err.stack || err.message}`);
    }
  };
}
const importJob      = safely('import', runImport);
const statsJob       = safely('stats', stats.refreshStats);
const maintenanceJob = safely('maintenance', runMaintenance);

maintenanceJob();
importJob();
statsJob();
setInterval(importJob, IMPORT_INTERVAL_MS);
setInterval(statsJob, STATS_INTERVAL_MS);
setInterval(maintenanceJob, MAINTENANCE_INTERVAL_MS);

app.listen(PORT, HOST, () => {
  console.log(`ctarchive-analytics listening on http://${HOST}:${PORT}`);
});
