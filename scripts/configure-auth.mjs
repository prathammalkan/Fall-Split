/**
 * Configure Supabase auth settings via the management API.
 * Sets redirect URLs for auth callbacks.
 */
import pg from 'pg';
const { Client } = pg;
const client = new Client({
  host: 'db.qkmswepfvgguomfhmkvg.supabase.co', port: 5432,
  database: 'postgres', user: 'postgres',
  password: 'your_password_here',
  ssl: { rejectUnauthorized: false }
});
await client.connect();

// Check instances table for raw config
const { rows: instances } = await client.query(`SELECT raw_config FROM auth.instances LIMIT 1`);
if (instances.length > 0) {
  const cfg = instances[0].raw_config || {};
  console.log('Current auth config keys:', Object.keys(cfg));
  console.log('site_url:', cfg.site_url);
  console.log('uri_allow_list:', cfg.uri_allow_list);

  // Update the config with our redirect URLs
  const newConfig = {
    ...cfg,
    site_url: 'http://localhost:5173',
    uri_allow_list: 'http://localhost:5173/**,https://fallsplit.vercel.app/**,https://*.vercel.app/**',
  };

  await client.query(
    `UPDATE auth.instances SET raw_config = $1 WHERE id = (SELECT id FROM auth.instances LIMIT 1)`,
    [newConfig]
  );
  console.log('Updated auth config site_url and uri_allow_list');
} else {
  console.log('No auth instances found');
}

await client.end();
