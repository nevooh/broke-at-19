const pool = require('../db/pool');
const intasend = require('./intasend');

// The one place that decides "was this really paid?". The webhook and the status check both use it,
// so a payment is counted by the same rules whichever way the news arrives.
// state: PENDING | PROCESSING | COMPLETE | FAILED. Returns true when this call just counted the give.
async function settlePayment(ref, { state, value, currency }) {
  const s = String(state || '').toUpperCase();

  if (s === 'COMPLETE') {
    const { rows: [row] } = await pool.query('SELECT amount_kes FROM backers WHERE payment_ref = $1', [ref]);
    if (!row) return false;

    // Safety net: never count a payment that came in under what we asked for.
    const paid = Number(value);
    if (currency && currency !== 'KES') {
      console.warn(`CURRENCY DIFFERS ${ref}: expected KES, IntaSend says ${currency}. Counted anyway.`);
    } else if (Number.isFinite(paid) && paid + 0.01 < row.amount_kes) {
      console.warn(`UNDERPAID ${ref}: expected KES ${row.amount_kes}, got ${value}`);
      return false; // left pending for you to review
    }

    const { rows: [r] } = await pool.query('SELECT confirm_backer($1) AS n', [ref]);
    if (r.n) { await pool.query('SELECT stamp_milestones()'); return true; }
    return false; // already counted earlier (safe to repeat)
  }

  if (s === 'FAILED') {
    await pool.query("UPDATE backers SET status = 'failed' WHERE payment_ref = $1 AND status = 'pending'", [ref]);
  }
  return false;
}

// Asks IntaSend how one payment went, then applies the answer by the same rules as the webhook.
// Returns true when IntaSend answered, false when it could not be reached or the answer was not about this payment.
async function askIntaSend(ref, invoiceId) {
  try {
    const resp = await intasend.getStatus(invoiceId);
    const inv = (resp && resp.invoice) || resp || {};
    if (inv.api_ref && inv.api_ref !== ref) return false; // not our payment: ignore
    await settlePayment(ref, { state: inv.state, value: inv.value, currency: inv.currency });
    return true;
  } catch (e) {
    console.error('Could not ask IntaSend for the status:', e.message);
    return false;
  }
}

module.exports = { settlePayment, askIntaSend };