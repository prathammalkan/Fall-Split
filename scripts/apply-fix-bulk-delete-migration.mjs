// scripts/apply-fix-bulk-delete-migration.mjs
// Applies migration 20261026140000_fix_bulk_delete_ordering.sql to production.
// This fixes two correctness defects in bulk_delete_my_expenses:
//   BUG 1: information disclosure — already-deleted check before creator check
//   BUG 2: TOCTOU race — settlement check before advisory locks

import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf8');
const dbUrlMatch = envContent.match(/SUPABASE_DB_URL=(.+)/);
if (!dbUrlMatch) { console.error('SUPABASE_DB_URL not found'); process.exit(1); }

const dbUrl = dbUrlMatch[1].trim();
const migrationFile = path.join(__dirname, '..', 'supabase', 'migrations', '20261026140000_fix_bulk_delete_ordering.sql');
const sql = readFileSync(migrationFile, 'utf8');

const client = new pg.Client({ connectionString: dbUrl });
try {
  await client.connect();
  console.log('Connected');

  // Check if already applied
  const { rows: existing } = await client.query(
    "SELECT version FROM supabase_migrations.schema_migrations WHERE version = '20261026140000'"
  );
  if (existing.length > 0) {
    console.log('Migration 20261026140000 already applied');
    process.exit(0);
  }

  // Verify the previous migration (20261026120000) is already applied
  const { rows: prev } = await client.query(
    "SELECT version FROM supabase_migrations.schema_migrations WHERE version = '20261026120000'"
  );
  if (prev.length === 0) {
    console.error('Prerequisite migration 20261026120000 not found in schema_migrations');
    process.exit(1);
  }

  console.log('Applying fix migration 20261026140000...');
  await client.query(sql);

  // Record in migration history
  await client.query(
    "INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ($1, $2, ARRAY[$3])",
    ['20261026140000', '20261026140000_fix_bulk_delete_ordering', sql]
  );

  // Verify function body was replaced (check the function exists)
  const { rows } = await client.query(
    "SELECT proname FROM pg_proc WHERE proname = 'bulk_delete_my_expenses'"
  );
  console.log('Function present after fix:', rows.length > 0 ? '✅' : '❌');
  console.log('Migration 20261026140000 applied successfully');
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
