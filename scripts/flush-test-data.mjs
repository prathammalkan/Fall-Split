// scripts/flush-test-data.mjs
// Authorized data flush: removes all test data from the Fall Split production DB.
// Run: node scripts/flush-test-data.mjs

import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load DB URL from .env.local
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf8');
const dbUrlMatch = envContent.match(/SUPABASE_DB_URL=(.+)/);
if (!dbUrlMatch) {
  console.error('SUPABASE_DB_URL not found in .env.local');
  process.exit(1);
}

const dbUrl = dbUrlMatch[1].trim();

const sql = `
BEGIN;

SET session_replication_role = replica;

TRUNCATE TABLE public.expense_item_allocations CASCADE;
TRUNCATE TABLE public.expense_items CASCADE;
TRUNCATE TABLE public.expense_approvals CASCADE;
TRUNCATE TABLE public.expense_history CASCADE;
TRUNCATE TABLE public.expense_shares CASCADE;
TRUNCATE TABLE public.expense_payers CASCADE;
TRUNCATE TABLE public.expenses CASCADE;
TRUNCATE TABLE public.settlements CASCADE;
TRUNCATE TABLE public.activity_log CASCADE;
TRUNCATE TABLE public.notifications CASCADE;
TRUNCATE TABLE public.notification_preferences CASCADE;
TRUNCATE TABLE public.push_subscriptions CASCADE;
TRUNCATE TABLE public.group_members CASCADE;
TRUNCATE TABLE public.groups CASCADE;
TRUNCATE TABLE public.friend_requests CASCADE;
TRUNCATE TABLE public.invitation_tokens CASCADE;

SET session_replication_role = DEFAULT;

COMMIT;
`;

const client = new pg.Client({ connectionString: dbUrl });

try {
  await client.connect();
  console.log('Connected to database');
  
  // Verify we're on the right project
  const { rows } = await client.query("SELECT current_database()");
  console.log('Database:', rows[0].current_database);
  
  await client.query(sql);
  console.log('✅ All test data flushed successfully');
  
  // Verify counts
  const tables = [
    'expenses', 'settlements', 'groups', 'friend_requests',
    'expense_approvals', 'notifications', 'invitation_tokens'
  ];
  
  for (const table of tables) {
    const result = await client.query(`SELECT COUNT(*) FROM public.${table}`);
    console.log(`  ${table}: ${result.rows[0].count} rows`);
  }
  
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
