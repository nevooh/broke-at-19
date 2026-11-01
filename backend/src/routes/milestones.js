const router = require('express').Router();
const pool = require('../db/pool');

router.get('/milestones', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM v_milestones ORDER BY backers_needed');
    res.set('Cache-Control', 'public, max-age=10');
    res.json(rows.map((m) => ({
      id: m.id,
      backers_needed: m.backers_needed,
      prize_total_kes: m.prize_total_kes,
      winners: m.winners,
      label: m.label,
      reached_at: m.reached_at,
      video_url: m.video_url,
      current_backers: Number(m.current_backers),
      progress_pct: Number(m.progress_pct),
    })));
  } catch (err) { next(err); }
});

module.exports = router;