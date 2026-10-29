// Creates the database (if missing) and applies db/schema.sql. Safe to run repeatedly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';

const schemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../db/schema.sql');

export async function migrate(database = config.db.database) {
  if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error(`Unsafe database name: ${database}`);
  const { host, port, user, password } = config.db;
  const conn = await mysql.createConnection({ host, port, user, password, multipleStatements: true });
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await conn.query(`USE \`${database}\``);
    await conn.query(fs.readFileSync(schemaPath, 'utf8'));
  } finally {
    await conn.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate()
    .then(() => console.log(`Schema applied to "${config.db.database}".`))
    .catch((err) => { console.error('Migration failed:', err.message); process.exit(1); });
}
