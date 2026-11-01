const router = require('express').Router();
const pool = require('../db/pool');
const { adminAuth } = require('../middleware/adminAuth');
const rateLimit = require('../middleware/rateLimit');

// Every request needs the header:  x-admin-token: <ADMIN_TOKEN>
router.use('/admin', rateLimit({ windowMs: 10 * 60 * 1000, max: 120 }), adminAuth);

// GET /api/admin/backers?status=paid&limit=100&before=<id>
// Unlike the public wall, this includes hidden rows and shows the row id you need for hiding.
router.get('/admin/backers', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const before = parseInt(req.query.before, 10) || null;
    const status = ['pending', 'paid', 'failed', 'refunded'].includes(req.query.status) ? req.query.status : null;
    const { rows } = await pool.query(
      `SELECT id, backer_number, display_name, instagram_handle, county_id, status, hidden,
              amount_kes, payment_ref, created_at, paid_at
         FROM backers
        WHERE ($1::text IS NULL OR status = $1)
          AND ($2::bigint IS NULL OR id < $2)
        ORDER BY id DESC
        LIMIT $3`,
      [status, before, limit]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/admin/backers/:id/hide   body: { "hidden": true }
router.post('/admin/backers/:id/hide', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id.' });
    const hidden = req.body && req.body.hidden === false ? false : true;
    const { rowCount } = await pool.query('UPDATE backers SET hidden = $2 WHERE id = $1', [id, hidden]);
    if (!rowCount) return res.status(404).json({ error: 'No backer with that id.' });
    res.json({ id, hidden });
  } catch (err) { next(err); }
});

module.exports = router;