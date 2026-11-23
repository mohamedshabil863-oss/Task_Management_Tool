import pg from 'pg';
import 'dotenv/config';

// DATE columns come back as plain 'YYYY-MM-DD' strings, not JS Dates shifted by time zone.
pg.types.setTypeParser(1082, (v) => v);
// SUM()/COUNT() come back as bigint strings; these are small numbers, so parse them.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

// Keep PostgreSQL's idea of "today" the same as the server's (set TZ in .env, e.g. Asia/Kolkata).
const TZ = (process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC').replace(/[^A-Za-z0-9_/+-]/g, '');

export const pool = new pg.Pool({
  options: `-c TimeZone=${TZ}`,
  connectionString: process.env.DATABASE_URL || 'postgres://taskboard:taskboard@localhost:5432/taskboard',
});

export const query = (text, params) => pool.query(text, params);

/** Run fn(client) inside a transaction. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

