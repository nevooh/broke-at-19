// Empties the database so `npm start` can build fresh tables. Run:  npm run db:reset
// For development only. It refuses to run if anyone has really paid, or if NODE_ENV is production.
require('dotenv').config();
const pool = require('./pool');

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to reset a production database.');
  }
  if (!process.env.DATABASE_URL) throw new Error('Missing DATABASE_URL in .env');

  const { rows: [t] } = await pool.query("SELECT to_regclass('public.backers') AS t");
  if (t.t) {
    const { rows: [c] } = await pool.query("SELECT count(*)::int AS n FROM backers WHERE status = 'paid'");
    if (c.n > 0) {
      throw new Error(`Refusing to reset: ${c.n} paid backer(s) are in this database. Their data would be lost.`);
    }
  }
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  console.log('Database emptied. Run "npm start" to build the tables again.');
}

main()
  .catch((err) => { console.error('\nReset failed: ' + err.message + '\n'); process.exitCode = 1; })
  .finally(() => pool.end());