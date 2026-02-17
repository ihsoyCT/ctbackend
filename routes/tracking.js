const express = require('express');
const router = express.Router();
const db = require('../db');

const insert = db.prepare(`
  INSERT INTO page_views (ts, date, raw_url, backend, mode, subreddit, author, search_text, referer, user_agent, ip)
  VALUES (@ts, @date, @raw_url, @backend, @mode, @subreddit, @author, @search_text, @referer, @user_agent, @ip)
`);

function getClientIp(req) {
  // Cloudflare sets CF-Connecting-IP to the real visitor IP
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return cf.trim();
  // Fallback: first entry of X-Forwarded-For (set by nginx/other proxies)
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return req.ip || null;
}

router.get('/', (req, res) => {
  try {
    const { d } = req.query;
    if (!d) {
      return res.json({ ok: false });
    }

    let rawUrl;
    try {
      rawUrl = Buffer.from(d, 'base64').toString('utf8');
    } catch {
      return res.json({ ok: false });
    }

    if (!rawUrl.startsWith('http')) {
      return res.json({ ok: false });
    }

    let sp;
    try {
      sp = new URL(rawUrl).searchParams;
    } catch {
      return res.json({ ok: false });
    }

    const subreddit   = (sp.get('subreddit') || '').toLowerCase() || null;
    const author      = (sp.get('author')    || '').toLowerCase() || null;
    const search_text = sp.get('q') || sp.get('query') || sp.get('body') || sp.get('title') || sp.get('selftext') || null;
    const backend     = sp.get('backend') || null;
    const mode        = sp.get('mode')    || null;
    const date        = new Date().toISOString().slice(0, 10);
    const ts          = Math.floor(Date.now() / 1000);
    const referer     = (req.headers['referer'] || '').slice(0, 512) || null;
    const user_agent  = (req.headers['user-agent'] || '').slice(0, 256) || null;
    const ip          = getClientIp(req);

    insert.run({ ts, date, raw_url: rawUrl, backend, mode, subreddit, author, search_text, referer, user_agent, ip });

    return res.json({ ok: true });
  } catch {
    return res.json({ ok: false, error: 'internal' });
  }
});

module.exports = router;
