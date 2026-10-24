/**
 * Configure Supabase auth settings via the management API.
 * Sets redirect URLs for auth callbacks.
 *
 * This script must never ship with embedded database credentials.
 * Provide configuration through environment variables instead.
 */
import pg from 'pg';
const { Client } = pg;

const dbUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
const dbHost = process.env.SUPABASE_DB_HOST ?? process.env.PGHOST;
const dbPort = Number(process.env.SUPABASE_DB_PORT ?? process.env.PGPORT ?? 5432);
const dbName = process.env.SUPABASE_DB_NAME ?? process.env.PGDATABASE ?? 'postgres';
const dbUser = process.env.SUPABASE_DB_USER ?? process.env.PGUSER ?? 'postgres';
const dbPassword = process.env.SUPABASE_DB_PASSWORD ?? process.env.PGPASSWORD;

if (!dbUrl && !(dbHost && dbName && dbUser && dbPassword)) {
  console.error(
    'Missing database configuration. Set SUPABASE_DB_URL or SUPABASE_DB_HOST + SUPABASE_DB_NAME + SUPABASE_DB_USER + SUPABASE_DB_PASSWORD.'
  );
  process.exit(1);
}

const client = new Client(
  dbUrl
    ? { connectionString: dbUrl, ssl: { rejectUnauthorized: false } }
    : {
        host: dbHost,
        port: dbPort,
        database: dbName,
        user: dbUser,
        password: dbPassword,
        ssl: { rejectUnauthorized: false },
      }
);

await client.connect();

try {
  // Check instances table for raw config
  const { rows: instances } = await client.query(`SELECT raw_config FROM auth.instances LIMIT 1`);
  if (instances.length > 0) {
    const cfg = instances[0].raw_config || {};
    console.log('Current auth config keys:', Object.keys(cfg));
    console.log('site_url:', cfg.site_url);
    console.log('uri_allow_list:', cfg.uri_allow_list);

    // Update the config with our redirect URLs.
    const siteUrl = process.env.SUPABASE_SITE_URL ?? 'https://fall-split.vercel.app';
    const newConfig = {
      ...cfg,
      site_url: siteUrl,
      uri_allow_list: [
        'http://localhost:5173/auth/callback',
        'http://localhost:5173/reset-password',
        'https://fall-split.vercel.app',
        'https://fall-split.vercel.app/auth/callback',
        'https://fall-split.vercel.app/reset-password',
        'https://*.vercel.app/auth/callback',
        'https://*.vercel.app/reset-password',
      ].join(','),
    };

    await client.query(
      `UPDATE auth.instances SET raw_config = $1 WHERE id = (SELECT id FROM auth.instances LIMIT 1)`,
      [newConfig]
    );
    console.log('Updated auth config site_url and uri_allow_list');
  } else {
    console.log('No auth instances found');
  }
} finally {
  await client.end();
}
