const express = require('express');
const router = express.Router();
const db = require('../db');

function periodWhere(period) {
  if (period === 'today') return "AND date = date('now')";
  if (period === 'week')  return "AND date >= date('now', '-6 days')";
  if (period === 'month') return "AND date >= date('now', '-29 days')";
  return '';
}

function periodDateFilter(period) {
  if (period === 'today') return "WHERE date = date('now')";
  if (period === 'week')  return "WHERE date >= date('now', '-6 days')";
  if (period === 'month') return "WHERE date >= date('now', '-29 days')";
  return '';
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
    GROUP BY subreddit ORDER BY count DESC LIMIT 20
  `).all();

  const top_authors = db.prepare(`
    SELECT author, COUNT(DISTINCT ip) AS count
    FROM page_views
    WHERE author IS NOT NULL AND author != ''
    ${pw}
    GROUP BY author ORDER BY count DESC LIMIT 20
  `).all();

  const top_queries = db.prepare(`
    SELECT search_text, COUNT(DISTINCT ip) AS count
    FROM page_views
    WHERE search_text IS NOT NULL AND search_text != ''
    ${pw}
    GROUP BY search_text ORDER BY count DESC LIMIT 20
  `).all();

  const backend_counts = db.prepare(`
    SELECT COALESCE(backend, 'unknown') AS backend, COUNT(DISTINCT ip) AS count
    FROM page_views ${pf}
    GROUP BY COALESCE(backend, 'unknown') ORDER BY count DESC
  `).all();

  const mode_counts = db.prepare(`
    SELECT COALESCE(mode, 'unknown') AS mode, COUNT(DISTINCT ip) AS count
    FROM page_views ${pf}
    GROUP BY COALESCE(mode, 'unknown') ORDER BY count DESC
  `).all();

  const requests_per_day = db.prepare(`
    SELECT date, COUNT(DISTINCT ip) AS count
    FROM page_views
    ${pf || "WHERE date >= date('now', '-30 days')"}
    GROUP BY date ORDER BY date ASC
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
    GROUP BY referer ORDER BY count DESC LIMIT 20
  `).all();

  // Hour of day (UTC)
  const hour_of_day = db.prepare(`
    SELECT strftime('%H', ts, 'unixepoch') AS hour, COUNT(DISTINCT ip) AS count
    FROM page_views ${pf}
    GROUP BY hour ORDER BY hour ASC
  `).all();

  // Day of week (0=Sun … 6=Sat)
  const day_of_week = db.prepare(`
    SELECT strftime('%w', ts, 'unixepoch') AS dow, COUNT(DISTINCT ip) AS count
    FROM page_views ${pf}
    GROUP BY dow ORDER BY dow ASC
  `).all();

  // Searches per session distribution
  const session_distribution = db.prepare(`
    SELECT
      CASE
        WHEN s = 1      THEN '1'
        WHEN s <= 3     THEN '2–3'
        WHEN s <= 5     THEN '4–5'
        WHEN s <= 10    THEN '6–10'
        ELSE '10+'
      END AS bucket,
      CASE
        WHEN s = 1      THEN 1
        WHEN s <= 3     THEN 2
        WHEN s <= 5     THEN 3
        WHEN s <= 10    THEN 4
        ELSE 5
      END AS ord,
      COUNT(*) AS sessions
    FROM (
      SELECT ip, date, COUNT(*) AS s
      FROM page_views ${pf}
      GROUP BY ip, date
    )
    GROUP BY bucket, ord
    ORDER BY ord
  `).all();

  const { avg_searches } = db.prepare(`
    SELECT ROUND(AVG(s), 1) AS avg_searches
    FROM (
      SELECT ip, date, COUNT(*) AS s
      FROM page_views ${pf}
      GROUP BY ip, date
    )
  `).get();

  // Trending subreddits: this week vs last week (always fixed, ignores period)
  const trending_subreddits = db.prepare(`
    WITH this_week AS (
      SELECT subreddit, COUNT(DISTINCT ip) AS tw
      FROM page_views
      WHERE date >= date('now', '-6 days')
        AND subreddit IS NOT NULL AND subreddit != ''
      GROUP BY subreddit
    ),
    last_week AS (
      SELECT subreddit, COUNT(DISTINCT ip) AS lw
      FROM page_views
      WHERE date >= date('now', '-13 days') AND date < date('now', '-6 days')
        AND subreddit IS NOT NULL AND subreddit != ''
      GROUP BY subreddit
    )
    SELECT
      COALESCE(t.subreddit, l.subreddit) AS subreddit,
      COALESCE(t.tw, 0) AS this_week,
      COALESCE(l.lw, 0) AS last_week
    FROM this_week t
    LEFT JOIN last_week l ON t.subreddit = l.subreddit
    ORDER BY this_week DESC
    LIMIT 20
  `).all();

  // Subreddit + author pairs
  const subreddit_author_pairs = db.prepare(`
    SELECT subreddit, author, COUNT(DISTINCT ip) AS count
    FROM page_views
    WHERE subreddit IS NOT NULL AND subreddit != ''
      AND author IS NOT NULL AND author != ''
    ${pw}
    GROUP BY subreddit, author
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
    hour_of_day,
    day_of_week,
    session_distribution,
    avg_searches,
    trending_subreddits,
    subreddit_author_pairs,
    period,
  });
});

module.exports = router;
