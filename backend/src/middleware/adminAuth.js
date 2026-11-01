const crypto = require('crypto');

// Compares two strings without leaking where they differ.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function adminAuth(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return res.status(503).json({ error: 'Admin is disabled: ADMIN_TOKEN is not set.' });
  const given = req.get('x-admin-token') || '';
  if (!safeEqual(given, expected)) return res.status(401).json({ error: 'Wrong admin token.' });
  next();
}

module.exports = { adminAuth, safeEqual };