const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  if (process.env.API_KEY && req.query.key !== process.env.API_KEY) {
    return res.status(403).json({ error: 'forbidden' });
  }

  res.set('Cache-Control', 'no-store');

  const top_subreddits = db.prepare(`
    SELECT subreddit, COUNT(*) AS count
    FROM page_views
    WHERE subreddit IS NOT NULL AND subreddit != ''
    GROUP BY subreddit
    ORDER BY count DESC
    LIMIT 20
  `).all();

  const top_authors = db.prepare(`
    SELECT author, COUNT(*) AS count
    FROM page_views
    WHERE author IS NOT NULL AND author != ''
    GROUP BY author
    ORDER BY count DESC
    LIMIT 20
  `).all();

  const top_queries = db.prepare(`
    SELECT search_text, COUNT(*) AS count
    FROM page_views
    WHERE search_text IS NOT NULL AND search_text != ''
    GROUP BY search_text
    ORDER BY count DESC
    LIMIT 20
  `).all();

  const backend_counts = db.prepare(`
    SELECT COALESCE(backend, 'unknown') AS backend, COUNT(*) AS count
    FROM page_views
    GROUP BY COALESCE(backend, 'unknown')
    ORDER BY count DESC
  `).all();

  const mode_counts = db.prepare(`
    SELECT COALESCE(mode, 'unknown') AS mode, COUNT(*) AS count
    FROM page_views
    GROUP BY COALESCE(mode, 'unknown')
    ORDER BY count DESC
  `).all();

  const requests_per_day = db.prepare(`
    SELECT date, COUNT(*) AS count
    FROM page_views
    WHERE date >= date('now', '-30 days')
    GROUP BY date
    ORDER BY date ASC
  `).all();

  const { total_requests } = db.prepare(`
    SELECT COUNT(*) AS total_requests FROM page_views
  `).get();

  const date_range = db.prepare(`
    SELECT MIN(date) AS first_date, MAX(date) AS last_date FROM page_views
  `).get();

  return res.json({
    top_subreddits,
    top_authors,
    top_queries,
    backend_counts,
    mode_counts,
    requests_per_day,
    total_requests,
    date_range,
  });
});

module.exports = router;
