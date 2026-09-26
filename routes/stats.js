const express = require('express');
const router = express.Router();
const db = require('../db');

const PERIODS = ['today', 'week', 'month', 'all'];
const cache = new Map(); // period -> { computed_at, ...stats }

function periodWhere(period) {
  if (period === 'today') return "date = date('now')";
  if (period === 'week')  return "date >= date('now', '-6 days')";
  if (period === 'month') return "date >= date('now', '-29 days')";
  return '1';
}

function computeStats(period) {
  const w = periodWhere(period);
  const all = sql => db.prepare(sql).all();
  const get = sql => db.prepare(sql).get();

  const top_subreddits = all(`
    SELECT subreddit, COUNT(DISTINCT ip) AS count
    FROM searches WHERE ${w} AND subreddit IS NOT NULL
    GROUP BY subreddit ORDER BY count DESC LIMIT 25
  `);

  const top_authors = all(`
    SELECT author, COUNT(DISTINCT ip) AS count
    FROM searches WHERE ${w} AND author IS NOT NULL
    GROUP BY author ORDER BY count DESC LIMIT 25
  `);

  const top_queries = all(`
    SELECT query AS search_text, COUNT(DISTINCT ip) AS count
    FROM searches WHERE ${w} AND query IS NOT NULL
    GROUP BY query ORDER BY count DESC LIMIT 25
  `);

  const subreddit_author_pairs = all(`
    SELECT subreddit, author, COUNT(DISTINCT ip) AS count
    FROM searches WHERE ${w} AND subreddit IS NOT NULL AND author IS NOT NULL
    GROUP BY subreddit, author ORDER BY count DESC LIMIT 20
  `);

  const backend_counts = all(`
    SELECT COALESCE(backend, 'unknown') AS backend, COUNT(DISTINCT ip) AS count
    FROM searches WHERE ${w}
    GROUP BY 1 ORDER BY count DESC
  `);

  const mode_counts = all(`
    SELECT COALESCE(mode, 'unknown') AS mode, COUNT(DISTINCT ip) AS count
    FROM searches WHERE ${w}
    GROUP BY 1 ORDER BY count DESC
  `);

  // Unique visitors per day across all request kinds
  const requests_per_day = all(`
    SELECT date, COUNT(*) AS count
    FROM daily_visitors WHERE ${period === 'all' ? '1' : w}
    GROUP BY date ORDER BY date ASC
  `);

  const { total_unique } = get(`
    SELECT COUNT(DISTINCT ip) AS total_unique FROM daily_visitors WHERE ${w}
  `);

  const kinds = Object.fromEntries(all(`
    SELECT kind, SUM(requests) AS n FROM daily_counts WHERE ${w} GROUP BY kind
  `).map(r => [r.kind, r.n]));

  const date_range = get(`
    SELECT MIN(date) AS first_date, MAX(date) AS last_date FROM daily_counts
  `);

  const hour_of_day = all(`
    SELECT strftime('%H', ts, 'unixepoch') AS hour, COUNT(DISTINCT ip) AS count
    FROM searches WHERE ${w}
    GROUP BY hour ORDER BY hour ASC
  `);

  const day_of_week = all(`
    SELECT strftime('%w', ts, 'unixepoch') AS dow, COUNT(DISTINCT ip) AS count
    FROM searches WHERE ${w}
    GROUP BY dow ORDER BY dow ASC
  `);

  // A session is one visitor on one day
  const session_distribution = all(`
    SELECT
      CASE WHEN s = 1 THEN '1' WHEN s <= 3 THEN '2–3' WHEN s <= 5 THEN '4–5'
           WHEN s <= 10 THEN '6–10' ELSE '10+' END AS bucket,
      CASE WHEN s = 1 THEN 1 WHEN s <= 3 THEN 2 WHEN s <= 5 THEN 3
           WHEN s <= 10 THEN 4 ELSE 5 END AS ord,
      COUNT(*) AS sessions
    FROM (SELECT ip, date, COUNT(*) AS s FROM searches WHERE ${w} GROUP BY ip, date)
    GROUP BY bucket, ord ORDER BY ord
  `);

  const { avg_searches } = get(`
    SELECT ROUND(AVG(s), 1) AS avg_searches
    FROM (SELECT ip, date, COUNT(*) AS s FROM searches WHERE ${w} GROUP BY ip, date)
  `);

  // This week vs last week, independent of period
  const trending_subreddits = all(`
    WITH this_week AS (
      SELECT subreddit, COUNT(DISTINCT ip) AS tw FROM searches
      WHERE date >= date('now', '-6 days') AND subreddit IS NOT NULL
      GROUP BY subreddit
    ),
    last_week AS (
      SELECT subreddit, COUNT(DISTINCT ip) AS lw FROM searches
      WHERE date >= date('now', '-13 days') AND date < date('now', '-6 days') AND subreddit IS NOT NULL
      GROUP BY subreddit
    )
    SELECT t.subreddit, t.tw AS this_week, COALESCE(l.lw, 0) AS last_week
    FROM this_week t LEFT JOIN last_week l ON t.subreddit = l.subreddit
    ORDER BY this_week DESC LIMIT 20
  `);

  return {
    period,
    computed_at: new Date().toISOString(),
    top_subreddits,
    top_authors,
    top_queries,
    subreddit_author_pairs,
    backend_counts,
    mode_counts,
    requests_per_day,
    total_unique,
    total_requests: (kinds.search || 0) + (kinds.thread || 0) + (kinds.other || 0),
    total_searches: kinds.search || 0,
    thread_views:   kinds.thread || 0,
    date_range,
    hour_of_day,
    day_of_week,
    session_distribution,
    avg_searches,
    trending_subreddits,
  };
}

// Called periodically by server.js so requests never run the heavy queries
function refreshStats() {
  for (const period of PERIODS) {
    try {
      cache.set(period, computeStats(period));
    } catch (err) {
      console.error(`[stats] ${period}: ${err.message}`);
    }
  }
}

router.get('/', (req, res) => {
  const period = PERIODS.includes(req.query.period) ? req.query.period : 'all';
  if (!cache.has(period)) cache.set(period, computeStats(period));
  res.set('Cache-Control', 'no-store');
  res.json(cache.get(period));
});

module.exports = { router, refreshStats };
