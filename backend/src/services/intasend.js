// IntaSend M-Pesa payments over their REST API (no SDK: the official Node SDK is AGPL-licensed).
//
// NOTE: the endpoint path and field names below follow IntaSend's public API, but they were not
// checked against a live account. Test in the sandbox first (INTASEND_TEST_MODE=true).
// If a call is rejected, the error details are logged on the server. This is the only file to fix.

function baseUrl() {
  if (process.env.INTASEND_BASE_URL) return process.env.INTASEND_BASE_URL.replace(/\/+$/, '');
  return process.env.INTASEND_TEST_MODE === 'true'
    ? 'https://sandbox.intasend.com'
    : 'https://payment.intasend.com';
}

async function post(path, body) {
  const res = await fetch(baseUrl() + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'BrokeAt19/1.0 (+https://broke-at-19.onrender.com)',
      Authorization: `Bearer ${process.env.INTASEND_SECRET_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
  if (!res.ok) {
    const err = new Error(`IntaSend ${path} returned ${res.status}`);
    err.details = data;
    throw err;
  }
  return data;
}

// Sends the M-Pesa prompt to the backer's phone. The result comes back through the webhook, or we ask IntaSend for it.
async function stkPush({ apiRef, amount, phone }) {
  return post('/api/v1/payment/mpesa-stk-push/', {
    public_key: process.env.INTASEND_PUBLISHABLE_KEY,
    amount,
    currency: 'KES',
    phone_number: phone,
    api_ref: apiRef,
  });
}

// Asks IntaSend directly how one payment went. Works even when the webhook cannot reach us.
async function getStatus(invoiceId) {
  return post('/api/v1/payment/status/', { invoice_id: invoiceId });
}

// IntaSend's own id for a payment, from its answer to the M-Pesa prompt request.
function invoiceIdFrom(resp) {
  return (resp && ((resp.invoice && resp.invoice.invoice_id) || resp.invoice_id)) || null;
}

module.exports = { stkPush, getStatus, invoiceIdFrom };