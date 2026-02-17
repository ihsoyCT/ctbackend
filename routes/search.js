const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  if (process.env.API_KEY && req.query.key !== process.env.API_KEY) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const q = (req.query.q || '').trim();
  if (!q) return res.json({ results: [] });

  // Split on whitespace — each term must appear somewhere in raw_url
  const terms = q.split(/\s+/).filter(Boolean);

  const conditions = terms.map(() => 'raw_url LIKE ?').join(' AND ');
  const params = terms.map(t => `%${t}%`);

  const results = db.prepare(`
    SELECT ip, raw_url, referer, date, ts
    FROM page_views
    WHERE ${conditions}
    ORDER BY ts DESC
    LIMIT 200
  `).all(...params);

  res.set('Cache-Control', 'no-store');
  return res.json({ results });
});

module.exports = router;
