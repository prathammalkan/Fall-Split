import pg from 'pg';
const { Client } = pg;
const client = new Client({
  host: 'db.qkmswepfvgguomfhmkvg.supabase.co', port: 5432,
  database: 'postgres', user: 'postgres',
  password: '@Fall----split#3wszQ12',
  ssl: { rejectUnauthorized: false }
});
await client.connect();
try {
  // Update auth config for site_url and redirect URLs
  await client.query(`
    UPDATE auth.config SET
      site_url = 'http://localhost:5173'
    WHERE site_url IS NOT NULL OR site_url IS NULL
  `);
  console.log('Auth config updated');
} catch(e) {
  console.log('Cannot update auth.config directly:', e.message.slice(0,200));
  // Try inserting into flow state
}
const { rows } = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='auth' ORDER BY tablename`);
console.log('Auth tables:', rows.map(r=>r.tablename).join(', '));
await client.end();
