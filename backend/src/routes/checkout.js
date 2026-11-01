const router = require('express').Router();
const crypto = require('crypto');
const pool = require('../db/pool');
const intasend = require('../services/intasend');
const { askIntaSend } = require('../services/settle');
const { cleanName, cleanHandle } = require('../services/moderation');
const { isValidCounty } = require('../services/counties');
const rateLimit = require('../middleware/rateLimit');

const MIN_KES = 3;
const MAX_KES = 250000; // the most one M-Pesa payment can carry
const REF_PATTERN = /^b19_[a-f0-9]{16}$/;

// Each checkout can send an M-Pesa prompt to a stranger's phone, so keep a limit on it.
// Many phones on one mobile network (or one school/office) share an address, so don't set it too low.
const checkoutLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: 'Too many attempts from your network. Wait a few minutes and try again.',
});
const statusLimit = rateLimit({ windowMs: 60 * 1000, max: 60 });

// Referral codes avoid look-alike characters (0/O, 1/I) so they survive being typed or read out.
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function makeReferralCode() {
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function normalizeKenyanPhone(raw) {
  const m = /^(?:\+?254|0)?([17]\d{8})$/.exec(String(raw || '').replace(/[\s-]/g, ''));
  return m ? `254${m[1]}` : null;
}

// POST /api/checkout
// body: { amount (whole KES), phone, county? (0-47), nick?, ig?, ref? }
// Only amount and phone are needed. Everything else is optional: the money is what matters.
router.post('/checkout', checkoutLimit, async (req, res, next) => {
  try {
    const b = req.body || {};

    const amount = Number(b.amount);
    if (b.amount === '' || b.amount == null || !Number.isInteger(amount) || amount < MIN_KES) {
      return res.status(400).json({ error: `Give a whole number of shillings, KES ${MIN_KES} or more.` });
    }
    if (amount > MAX_KES) {
      return res.status(400).json({ error: `M-Pesa will not carry more than KES ${MAX_KES.toLocaleString('en-US')} in one payment.` });
    }

    // County is optional. Not given = 0. A wrong value is still refused, so typos do not hide in 0.
    let county = 0;
    if (b.county !== undefined && b.county !== null && b.county !== '') {
      county = typeof b.county === 'number' ? b.county : /^\d{1,2}$/.test(String(b.county)) ? Number(b.county) : NaN;
      if (!isValidCounty(county)) return res.status(400).json({ error: 'Pick your county from the list.' });
    }

    const phone = normalizeKenyanPhone(b.phone);
    if (!phone) return res.status(400).json({ error: 'Enter a valid Kenyan M-Pesa number, like 0712 345 678.' });

    // The money matters most: a name or handle that fails the checks is dropped, never a reason to refuse the gift.
    const dropped = [];
    let name = cleanName(b.nick);
    if (!name.ok) { name = { ok: true, value: null }; dropped.push('name'); }
    let handle = cleanHandle(b.ig);
    if (!handle.ok) { handle = { ok: true, value: null }; dropped.push('ig'); }

    // Who sent this person, if anyone. Only paid backers' codes count.
    let referredBy = null;
    if (typeof b.ref === 'string' && /^[a-z0-9]{8}$/.test(b.ref)) {
      const { rows } = await pool.query(
        "SELECT id FROM backers WHERE referral_code = $1 AND status = 'paid'", [b.ref]
      );
      if (rows[0]) referredBy = rows[0].id;
    }

    const apiRef = `b19_${crypto.randomBytes(8).toString('hex')}`;

    await pool.query(
      `INSERT INTO backers
         (display_name, instagram_handle, county_id, referral_code, referred_by,
          amount_kes, provider, payment_ref, status, phone)
       VALUES ($1, $2, $3, $4, $5, $6, 'intasend', $7, 'pending', $8)`,
      [name.value, handle.value, county, makeReferralCode(), referredBy, amount, apiRef, phone]
    );

    try {
      const sent = await intasend.stkPush({ apiRef, amount, phone });
      // Keep IntaSend's own id for this payment, so we can ask IntaSend how it went.
      const invoiceId = intasend.invoiceIdFrom(sent);
      if (invoiceId) {
        await pool.query('UPDATE backers SET invoice_id = $1 WHERE payment_ref = $2', [String(invoiceId).slice(0, 40), apiRef])
          .catch((e) => console.error('Could not save the IntaSend invoice id:', e.message));
      }
      return res.status(202).json({ api_ref: apiRef, currency: 'KES', amount, dropped });
    } catch (providerErr) {
      console.error('Payment provider error:', providerErr.message, JSON.stringify(providerErr.details || {}));
      await pool.query(
        "UPDATE backers SET status = 'failed' WHERE payment_ref = $1 AND status = 'pending'", [apiRef]
      );
      return res.status(502).json({ error: 'We could not start the payment. Nothing was charged. Try again in a minute.' });
    }
  } catch (err) { next(err); }
});

// Asks IntaSend how one payment went. The answer goes through the same checks as the webhook.
// Returns true when IntaSend answered. At most one question per payment every 1.2 seconds.
const lastAsk = new Map();
async function checkWithIntaSend(ref, invoiceId) {
  const now = Date.now();
  if (now - (lastAsk.get(ref) || 0) < 1200) return false;
  lastAsk.set(ref, now);
  if (lastAsk.size > 5000) for (const [k, t] of lastAsk) if (now - t > 600000) lastAsk.delete(k);
  return askIntaSend(ref, invoiceId);
}

// GET /api/checkout/status/:ref  (the site polls this after the M-Pesa prompt)
router.get('/checkout/status/:ref', statusLimit, async (req, res, next) => {
  try {
    if (!REF_PATTERN.test(req.params.ref)) return res.status(400).json({ error: 'Bad reference.' });
    const STATUS_SQL = 'SELECT status, backer_number, person_number, referral_code, invoice_id FROM backers WHERE payment_ref = $1';
    let { rows: [row] } = await pool.query(STATUS_SQL, [req.params.ref]);
    if (!row) return res.status(404).json({ error: 'Unknown reference.' });
    // Still waiting? Ask IntaSend directly. This works even when the webhook cannot reach us.
    if (row.status === 'pending' && row.invoice_id && (await checkWithIntaSend(req.params.ref, row.invoice_id))) {
      ({ rows: [row] } = await pool.query(STATUS_SQL, [req.params.ref]));
    }
    res.set('Cache-Control', 'no-store');
    if (row.status === 'paid') {
      return res.json({ status: 'paid', backer_number: row.backer_number, person_number: row.person_number, referral_code: row.referral_code });
    }
    res.json({ status: row.status });
  } catch (err) { next(err); }
});

module.exports = router;