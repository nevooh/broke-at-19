const pool = require('../db/pool');
const { askIntaSend } = require('./settle');

// A safety net. Every little while, ask IntaSend about payments that are still waiting.
// It catches gives where the customer closed the page, or the webhook never arrived.
// It only looks at gives from the last 50 minutes, because the cleanup in server.js
// stops counting a give as pending after an hour.
let running = false;

async function sweepOnce() {
  if (running) return;
  running = true;
  try {
    const { rows } = await pool.query(
      `SELECT payment_ref, invoice_id FROM backers
        WHERE status = 'pending' AND invoice_id IS NOT NULL
          AND created_at > now() - interval '50 minutes'
          AND created_at < now() - interval '20 seconds'
        ORDER BY created_at DESC
        LIMIT 40`
    );
    for (const r of rows) await askIntaSend(r.payment_ref, r.invoice_id);
  } catch (e) {
    console.error('Sweep error:', e.message);
  } finally {
    running = false;
  }
}

function start() {
  const secs = Math.max(5, Number(process.env.SWEEP_SECONDS) || 30);
  setInterval(sweepOnce, secs * 1000).unref();
}

module.exports = { start, sweepOnce };