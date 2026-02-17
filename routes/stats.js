const express = require('express');
const router = express.Router();
const db = require('../db');

function periodWhere(period) {
  if (period === 'today') return "AND date = date('now')";
  if (period === 'week')  return "AND date >= date('now', '-6 days')";
  if (period === 'month') return "AND date >= date('now', '-29 days')";
  return ''; // all time
}

function periodDateFilter(period) {
  if (period === 'today') return "WHERE date = date('now')";
  if (period === 'week')  return "WHERE date >= date('now', '-6 days')";
  if (period === 'month') return "WHERE date >= date('now', '-29 days')";
  return ''; // all time — no filter
}

router.get('/', (req, res) => {
  if (process.env.API_KEY && req.query.key !== process.env.API_KEY) {
    return res.status(403).json({ error: 'forbidden' });
  }

  res.set('Cache-Control', 'no-store');

  const period = req.query.period || 'all';
  const pw = periodWhere(period);
  const pf = periodDateFilter(period);

  const top_subreddits = db.prepare(`
    SELECT subreddit, COUNT(DISTINCT ip) AS count
    FROM page_views
    WHERE subreddit IS NOT NULL AND subreddit != ''
    ${pw}
    GROUP BY subreddit
    ORDER BY count DESC
    LIMIT 20
  `).all();

  const top_authors = db.prepare(`
    SELECT author, COUNT(DISTINCT ip) AS count
    FROM page_views
    WHERE author IS NOT NULL AND author != ''
    ${pw}
    GROUP BY author
    ORDER BY count DESC
    LIMIT 20
  `).all();

  const top_queries = db.prepare(`
    SELECT search_text, COUNT(DISTINCT ip) AS count
    FROM page_views
    WHERE search_text IS NOT NULL AND search_text != ''
    ${pw}
    GROUP BY search_text
    ORDER BY count DESC
    LIMIT 20
  `).all();

  const backend_counts = db.prepare(`
    SELECT COALESCE(backend, 'unknown') AS backend, COUNT(DISTINCT ip) AS count
    FROM page_views
    ${pf}
    GROUP BY COALESCE(backend, 'unknown')
    ORDER BY count DESC
  `).all();

  const mode_counts = db.prepare(`
    SELECT COALESCE(mode, 'unknown') AS mode, COUNT(DISTINCT ip) AS count
    FROM page_views
    ${pf}
    GROUP BY COALESCE(mode, 'unknown')
    ORDER BY count DESC
  `).all();

  const requests_per_day = db.prepare(`
    SELECT date, COUNT(DISTINCT ip) AS count
    FROM page_views
    ${pf || "WHERE date >= date('now', '-30 days')"}
    GROUP BY date
    ORDER BY date ASC
  `).all();

  const { total_unique } = db.prepare(`
    SELECT COUNT(DISTINCT ip) AS total_unique FROM page_views ${pf}
  `).get();

  const { total_requests } = db.prepare(`
    SELECT COUNT(*) AS total_requests FROM page_views ${pf}
  `).get();

  const date_range = db.prepare(`
    SELECT MIN(date) AS first_date, MAX(date) AS last_date FROM page_views
  `).get();

  const top_referers = db.prepare(`
    SELECT referer, COUNT(DISTINCT ip) AS count
    FROM page_views
    WHERE referer IS NOT NULL AND referer != ''
    ${pw}
    GROUP BY referer
    ORDER BY count DESC
    LIMIT 20
  `).all();

  return res.json({
    top_subreddits,
    top_authors,
    top_queries,
    backend_counts,
    mode_counts,
    requests_per_day,
    total_unique,
    total_requests,
    date_range,
    top_referers,
    period,
  });
});

module.exports = router;
