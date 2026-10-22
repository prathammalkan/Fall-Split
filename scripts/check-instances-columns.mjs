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

const c = new Client(
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

await c.connect();

try {
  // Get columns of auth.instances
  const { rows: cols } = await c.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='auth' AND table_name='instances'
     ORDER BY column_name`
  );
  console.log('auth.instances columns:', cols.map((row) => row.column_name).join(', '));

  // Get current instance rows
  const { rows: instances } = await c.query(`SELECT * FROM auth.instances LIMIT 5`);
  console.log('auth.instances rows:', JSON.stringify(instances, null, 2));

  // Try to update raw_base_config if it exists
  if (cols.some((row) => row.column_name === 'raw_base_config')) {
    console.log('raw_base_config column found — attempting update...');
    try {
      const existing = instances[0];
      let config = {};
      if (existing?.raw_base_config) {
        config = JSON.parse(existing.raw_base_config);
      }
      config.site_url = 'http://localhost:5173';
      config.uri_allow_list = [
        'http://localhost:5173/auth/callback',
        'https://fallsplit.vercel.app/auth/callback',
        'https://fallsplit.vercel.app',
        'https://*.vercel.app/auth/callback',
      ].join(',');

      const { rowCount } = await c.query(
        `UPDATE auth.instances SET raw_base_config = $1 WHERE id = $2`,
        [JSON.stringify(config), existing.id]
      );
      console.log('Updated rows:', rowCount);
    } catch (error) {
      console.error('Update failed:', error instanceof Error ? error.message : 'unknown database error');
    }
  } else {
    console.log('No raw_base_config column. Manual dashboard config required.');
  }
} finally {
  await c.end();
}
