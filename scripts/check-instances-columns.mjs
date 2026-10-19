import pg from 'pg';
const { Client } = pg;

const c = new Client({
  host: 'db.qkmswepfvgguomfhmkvg.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'your_password_here',
  ssl: { rejectUnauthorized: false }
});

await c.connect();

// Get columns of auth.instances
const { rows: cols } = await c.query(
  `SELECT column_name FROM information_schema.columns 
   WHERE table_schema='auth' AND table_name='instances' 
   ORDER BY column_name`
);
console.log('auth.instances columns:', cols.map(r => r.column_name).join(', '));

// Get current instance rows
const { rows: instances } = await c.query(`SELECT * FROM auth.instances LIMIT 5`);
console.log('auth.instances rows:', JSON.stringify(instances, null, 2));

// Try to update raw_base_config if it exists
if (cols.some(r => r.column_name === 'raw_base_config')) {
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
      'https://*.vercel.app/auth/callback'
    ].join(',');

    const { rowCount } = await c.query(
      `UPDATE auth.instances SET raw_base_config = $1 WHERE id = $2`,
      [JSON.stringify(config), existing.id]
    );
    console.log('Updated rows:', rowCount);
  } catch (e) {
    console.error('Update failed:', e.message);
  }
} else {
  console.log('No raw_base_config column. Manual dashboard config required.');
}

await c.end();
