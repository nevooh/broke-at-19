require('dotenv').config();

const path = require('path');
const express = require('express');
const pool = require('./src/db/pool');

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  const missing = ['INTASEND_PUBLISHABLE_KEY', 'INTASEND_SECRET_KEY', 'INTASEND_WEBHOOK_CHALLENGE', 'ADMIN_TOKEN']
    .filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('Missing required settings for production: ' + missing.join(', '));
    process.exit(1);
  }
}

const app = express();
app.disable('x-powered-by');
if (Number(process.env.TRUST_PROXY)) app.set('trust proxy', Number(process.env.TRUST_PROXY));

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  next();
});

// Public read-only data can be fetched from other sites and apps (the corner widget).
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/admin')) res.set('Access-Control-Allow-Origin', '*');
  next();
});

app.use('/api', express.json({ limit: '10kb' }));

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use('/api', require('./src/routes/count'));
app.use('/api', require('./src/routes/wall'));
app.use('/api', require('./src/routes/leaderboard'));
app.use('/api', require('./src/routes/checkout'));
app.use('/api', require('./src/routes/card'));
app.use('/api', require('./src/routes/webhook'));
app.use('/api', require('./src/routes/admin'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// The site itself lives in ../frontend
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad JSON.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Try again in a minute.' });
});

// Checkouts nobody finished (closed tab, ignored M-Pesa prompt) stop counting as pending after an hour.
setInterval(() => {
  pool.query("UPDATE backers SET status = 'failed' WHERE status = 'pending' AND created_at < now() - interval '1 hour'")
    .catch((e) => console.error('Cleanup error:', e.message));
}, 10 * 60 * 1000).unref();

const { ensureDatabase } = require('./src/db/init');
const port = Number(process.env.PORT) || 3000;

// Make sure the database and tables exist, then start taking visitors.
ensureDatabase()
  .then((r) => {
    if (r.databaseCreated) console.log('Created the database.');
    if (r.tablesCreated) console.log('Built the tables and giveaway milestones.');
    app.listen(port, () => console.log(`Broke at 19 is running on http://localhost:${port}`));
    require('./src/services/sweeper').start(); // safety net: follows up payments that are still waiting
  })
  .catch((err) => {
    console.error('\nCould not start: ' + err.message + '\n');
    process.exit(1);
  });