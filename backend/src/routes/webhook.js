const router = require('express').Router();
const { settlePayment } = require('../services/settle');
const { safeEqual } = require('../middleware/adminAuth');

const REF_PATTERN = /^b19_[a-f0-9]{16}$/;

// IntaSend calls this every time a payment changes state (PENDING, PROCESSING, COMPLETE, FAILED).
// Set the URL in the IntaSend dashboard to https://YOUR-DOMAIN/api/webhook/intasend and type the
// same challenge string you put in INTASEND_WEBHOOK_CHALLENGE.
router.post('/webhook/intasend', async (req, res) => {
  const expected = process.env.INTASEND_WEBHOOK_CHALLENGE;
  if (!expected) return res.status(503).json({ error: 'Webhook is disabled: no challenge is set.' });

  const b = req.body || {};
  if (!safeEqual(b.challenge || '', expected)) return res.sendStatus(401);

  const ref = String(b.api_ref || '');
  if (!REF_PATTERN.test(ref)) return res.sendStatus(200); // not one of ours; ignore

  try {
    await settlePayment(ref, { state: b.state, value: b.value, currency: b.currency });
    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(500); // a 5xx makes IntaSend retry, and confirm_backer is safe to replay
  }
});

module.exports = router;