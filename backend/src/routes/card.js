const router = require('express').Router();
const pool = require('../db/pool');
const rateLimit = require('../middleware/rateLimit');

// Someone who gave before comes back with no login. Their phone number gets their card back.
// Strict limit: this stops people from guessing phone numbers one after another.
const cardLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: 'Too many tries from your network. Wait a few minutes and try again.',
});

function normalizeKenyanPhone(raw) {
  const m = /^(?:\+?254|0)?([17]\d{8})$/.exec(String(raw || '').replace(/[\s-]/g, ''));
  return m ? `254${m[1]}` : null;
}

// POST /api/card
// body: { phone }
// answer: { person_number, name, county_id, gives, total_kes }   (name is null if they never gave one)
// It is a POST so the phone number never lands in a web address or a log.
router.post('/card', cardLimit, async (req, res, next) => {
  try {
    const phone = normalizeKenyanPhone(req.body && req.body.phone);
    if (!phone) return res.status(400).json({ error: 'Enter the M-Pesa number you gave with, like 0712 345 678.' });

    // Name and county: the latest one they gave. A name an admin hid never comes back on the card.
    const { rows: [r] } = await pool.query(
      `SELECT MIN(person_number) AS person_number,
              COUNT(*)::int AS gives,
              SUM(amount_kes)::int AS total_kes,
              (ARRAY_AGG(display_name ORDER BY paid_at DESC)
                 FILTER (WHERE hidden = FALSE AND display_name IS NOT NULL AND display_name <> ''))[1] AS name,
              COALESCE((ARRAY_AGG(county_id ORDER BY paid_at DESC) FILTER (WHERE county_id <> 0))[1], 0) AS county_id
         FROM backers
        WHERE phone = $1 AND status = 'paid'`,
      [phone]
    );

    res.set('Cache-Control', 'no-store');
    if (!r.gives) return res.status(404).json({ error: 'No card found for that number yet.' });
    res.json({ person_number: r.person_number, name: r.name, county_id: Number(r.county_id), gives: r.gives, total_kes: r.total_kes });
  } catch (err) { next(err); }
});

module.exports = router;