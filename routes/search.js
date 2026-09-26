const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ results: [] });

  // Split on whitespace — each term must appear somewhere in raw_url
  const terms = q.split(/\s+/).filter(Boolean).slice(0, 10);

  const conditions = terms.map(() => 'raw_url LIKE ?').join(' AND ');
  const params = terms.map(t => `%${t}%`);

  const results = db.prepare(`
    SELECT ip, raw_url, date, ts
    FROM searches
    WHERE ${conditions}
    ORDER BY ts DESC
    LIMIT 200
  `).all(...params);

  res.set('Cache-Control', 'no-store');
  return res.json({ results });
});

module.exports = router;
