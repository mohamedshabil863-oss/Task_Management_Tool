import { readFile } from 'node:fs/promises';
import { pool } from './db.js';

export async function migrate() {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => { console.log('Schema is up to date.'); return pool.end(); })
    .catch((err) => { console.error(err); process.exit(1); });
}
