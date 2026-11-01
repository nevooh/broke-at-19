const router = require('express').Router();
const pool = require('../db/pool');

// GET /api/wall?limit=24&before=240  (newest first; "before" is a backer number, for paging)
router.get('/wall', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), 100);
    const before = parseInt(req.query.before, 10) || null;
    const { rows } = await pool.query(
      `SELECT backer_number, person_number, name, instagram_handle, county_id, amount_kes, paid_at
         FROM v_wall
        WHERE ($2::int IS NULL OR backer_number < $2)
        ORDER BY backer_number DESC
        LIMIT $1`,
      [limit, before]
    );
    res.set('Cache-Control', 'public, max-age=5');
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;