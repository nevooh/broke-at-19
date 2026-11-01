const router = require('express').Router();
const pool = require('../db/pool');
const { COUNTIES } = require('../services/counties');

// The county list for the "County" box on the join form (alphabetical, "Somewhere else" last).
router.get('/counties', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.json(COUNTIES);
});

// The county race, biggest first.
router.get('/leaderboard', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT county_id, backers FROM v_county_leaderboard ORDER BY backers DESC, county_id'
    );
    res.set('Cache-Control', 'public, max-age=10');
    res.json(rows.map((r) => ({ county_id: r.county_id, backers: Number(r.backers) })));
  } catch (err) { next(err); }
});

router.get('/referrers', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT backer_number, name, referred FROM v_top_referrers ORDER BY referred DESC, backer_number'
    );
    res.set('Cache-Control', 'public, max-age=10');
    res.json(rows.map((r) => ({ backer_number: r.backer_number, name: r.name, referred: Number(r.referred) })));
  } catch (err) { next(err); }
});

module.exports = router;