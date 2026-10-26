// scripts/apply-bulk-delete-migration.mjs
// Applies migration 20261026120000_bulk_delete_my_expenses.sql to production.

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
const migrationFile = path.join(__dirname, '..', 'supabase', 'migrations', '20261026120000_bulk_delete_my_expenses.sql');
const sql = readFileSync(migrationFile, 'utf8');

const client = new pg.Client({ connectionString: dbUrl });
try {
  await client.connect();
  console.log('Connected');

  // Check if already applied
  const { rows: existing } = await client.query(
    "SELECT version FROM supabase_migrations.schema_migrations WHERE version = '20261026120000'"
  );
  if (existing.length > 0) {
    console.log('Migration already applied');
    process.exit(0);
  }

  await client.query(sql);
  
  // Record in migration history
  await client.query(
    "INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ($1, $2, ARRAY[$3])",
    ['20261026120000', '20261026120000_bulk_delete_my_expenses', sql]
  );
  
  // Verify function was created
  const { rows } = await client.query(
    "SELECT proname FROM pg_proc WHERE proname = 'bulk_delete_my_expenses'"
  );
  console.log('Function created:', rows.length > 0 ? '✅' : '❌');
  console.log('Migration applied successfully');
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
