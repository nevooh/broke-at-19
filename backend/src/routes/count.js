const router = require('express').Router();
const pool = require('../db/pool');

// The corner widget in your other apps hits this a lot, so cache it for a few seconds.
let cache = { at: 0, data: null };

router.get('/count', async (req, res, next) => {
  try {
    if (!cache.data || Date.now() - cache.at > 5000) {
      const { rows: [r] } = await pool.query('SELECT backers, people, total_kes FROM v_count');
      cache = { at: Date.now(), data: { backers: Number(r.backers), people: Number(r.people), total_kes: Number(r.total_kes) } };
    }
    res.set('Cache-Control', 'public, max-age=5');
    res.json(cache.data);
  } catch (err) { next(err); }
});

module.exports = router;