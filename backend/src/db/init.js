// Sets up the database. Runs automatically on `npm start`, and by hand with `npm run db:init`.
//   1. Creates the database named in DATABASE_URL if it does not exist yet.
//   2. Creates the tables, views and milestones if they do not exist yet.
// It never changes or deletes existing data.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const pool = require('./pool');

const SQL_FILES = ['schema.sql', 'milestones.sql'];
const ssl = process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined;

function describe(url) {
  try {
    const u = new URL(url);
    return { user: decodeURIComponent(u.username), host: u.hostname, port: u.port || '5432', db: decodeURIComponent(u.pathname.slice(1)) };
  } catch {
    return null;
  }
}

// Turns Postgres error codes into something you can act on.
function friendly(err) {
  const d = describe(process.env.DATABASE_URL) || {};
  if (err.code === '28P01' || err.code === '28000') {
    return new Error(
      `Postgres rejected the login for user "${d.user}". Fix the password in the DATABASE_URL line of your .env file.\n` +
      '(If the password has symbols like @ # / : %, change it to letters and numbers only, or the address breaks.)'
    );
  }
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
    return new Error(`Cannot reach Postgres at ${d.host}:${d.port}. Is the Postgres service running, and is the host/port in DATABASE_URL right?`);
  }
  return new Error(`Database problem: ${err.message}`);
}

async function createDatabase() {
  const url = new URL(process.env.DATABASE_URL);
  const dbName = decodeURIComponent(url.pathname.slice(1));
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
    throw new Error(`The database "${dbName}" does not exist. Create it in pgAdmin, then start again.`);
  }
  url.pathname = '/postgres'; // the built-in admin database, used only to create ours
  const admin = new Client({ connectionString: url.toString(), ssl });
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } catch (err) {
    if (err.code === '28P01' || err.code === '28000') throw friendly(err);
    throw new Error(`The database "${dbName}" does not exist and I could not create it (${err.message}). Create it in pgAdmin, then start again.`);
  } finally {
    await admin.end().catch(() => {});
  }
}

// Returns { databaseCreated, tablesCreated } so callers can say what happened.
async function ensureDatabase() {
  if (!process.env.DATABASE_URL) throw new Error('Missing DATABASE_URL. Open .env and fill it in.');

  const result = { databaseCreated: false, tablesCreated: false };

  try {
    await pool.query('SELECT 1');
  } catch (err) {
    if (err.code === '3D000') { // database does not exist
      await createDatabase();
      result.databaseCreated = true;
    } else {
      throw friendly(err);
    }
  }

  const client = await pool.connect().catch((err) => { throw friendly(err); });
  try {
    const { rows } = await client.query("SELECT to_regclass('public.backers') AS t");
    if (!rows[0].t) {
      await client.query('BEGIN');
      try {
        for (const file of SQL_FILES) {
          await client.query(fs.readFileSync(path.join(__dirname, '..', '..', 'sql', file), 'utf8'));
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Could not build the tables: ${err.message}`);
      }
      result.tablesCreated = true;
    }
    // Small upgrade for databases built by an older schema.sql. Adding a column never touches existing data.
    await client.query('ALTER TABLE backers ADD COLUMN IF NOT EXISTS invoice_id VARCHAR(40)');
  } finally {
    client.release();
  }
  return result;
}

module.exports = { ensureDatabase };

// `npm run db:init` runs this file directly.
if (require.main === module) {
  ensureDatabase()
    .then((r) => {
      if (r.databaseCreated) console.log('Created the database.');
      if (r.tablesCreated) {
        SQL_FILES.forEach((f) => console.log('Ran', f));
        console.log('Done.');
      } else {
        console.log('The database is already set up (the backers table exists). Nothing to do.');
      }
    })
    .catch((err) => { console.error('\nSetup failed: ' + err.message + '\n'); process.exitCode = 1; })
    .finally(() => pool.end());
}