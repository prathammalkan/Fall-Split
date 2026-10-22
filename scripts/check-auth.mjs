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
  // Update auth config for site_url and redirect URLs.
  await client.query(`
    UPDATE auth.config SET
      site_url = 'http://localhost:5173'
    WHERE site_url IS NOT NULL OR site_url IS NULL
  `);
  console.log('Auth config updated');
} catch (error) {
  console.log('Cannot update auth.config directly:', error instanceof Error ? error.message.slice(0, 200) : 'unknown database error');
  // Try inserting into flow state.
}
const { rows } = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='auth' ORDER BY tablename`);
console.log('Auth tables:', rows.map((row) => row.tablename).join(', '));
await client.end();
