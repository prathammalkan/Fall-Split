/**
 * run-migrations.mjs - Robust migration runner for Fall Split.
 * Handles: line comments, block comments, dollar-quotes, single-quoted strings.
 */
import pg from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

const DB_CONFIG = {
  host: 'db.qkmswepfvgguomfhmkvg.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'your_password_here',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  statement_timeout: 120000,
};

const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations');
const MIGRATION_FILES = [
  '001_core_schema.sql',
  '002_rls_policies.sql',
  '003_functions.sql',
];

const SKIP_CODES = new Set(['42710','42P07','42723','42804','42P16','23505','42501']);
const SKIP_MSGS = ['already exists','duplicate key'];
function isSkippable(err) {
  if (SKIP_CODES.has(err.code)) return true;
  return SKIP_MSGS.some(m => err.message.toLowerCase().includes(m));
}

/**
 * Split SQL into individual statements, correctly handling:
 *   - `--` line comments (semicolons inside are NOT delimiters)
 *   - `/* ... * /` block comments
 *   - `$$` / `$tag$` dollar-quoted blocks
 *   - `'...'` single-quoted strings (with '' escaping)
 */
function splitStatements(sql) {
  const stmts = [];
  let cur = '';
  let i = 0;
  const len = sql.length;
  let dollarTag = null; // null or the opening tag string

  while (i < len) {
    // Inside a dollar-quote block — scan until closing tag
    if (dollarTag !== null) {
      if (sql.startsWith(dollarTag, i)) {
        cur += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
      } else {
        cur += sql[i++];
      }
      continue;
    }

    // Opening of a dollar-quote block
    const dollarMatch = sql.slice(i).match(/^(\$[A-Za-z_0-9]*\$)/);
    if (dollarMatch) {
      dollarTag = dollarMatch[1];
      cur += dollarTag;
      i += dollarTag.length;
      continue;
    }

    // Line comment: -- ... \n  (consume everything up to newline; semicolons inside are ignored)
    if (sql[i] === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      if (end === -1) {
        cur += sql.slice(i);
        i = len;
      } else {
        cur += sql.slice(i, end + 1);
        i = end + 1;
      }
      continue;
    }

    // Block comment: /* ... */
    if (sql[i] === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) {
        cur += sql.slice(i);
        i = len;
      } else {
        cur += sql.slice(i, end + 2);
        i = end + 2;
      }
      continue;
    }

    // Single-quoted string: '...' with '' escape
    if (sql[i] === "'") {
      cur += sql[i++];
      while (i < len) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          cur += "''";
          i += 2;
        } else if (sql[i] === "'") {
          cur += sql[i++];
          break;
        } else {
          cur += sql[i++];
        }
      }
      continue;
    }

    // Statement delimiter
    if (sql[i] === ';') {
      cur += ';';
      const trimmed = cur.trim();
      const stripped = trimmed.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (stripped.length > 1) stmts.push(trimmed);
      cur = '';
      i++;
      continue;
    }

    cur += sql[i++];
  }

  // Trailing statement (no trailing semicolon)
  const trimmed = cur.trim();
  const stripped = trimmed.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (stripped.length > 1) stmts.push(trimmed);

  return stmts;
}

async function runStatements(client, sql) {
  const stmts = splitStatements(sql);
  console.log(`   (${stmts.length} statements)`);
  let applied = 0, skipped = 0;
  for (const stmt of stmts) {
    try {
      await client.query(stmt);
      applied++;
    } catch (err) {
      if (isSkippable(err)) {
        skipped++;
      } else {
        console.error(`\n   ❌ Failed statement:\n${stmt.slice(0, 300)}`);
        throw err;
      }
    }
  }
  return { applied, skipped };
}

async function main() {
  console.log('🚀 Fall Split — Database Migrations');
  console.log(`📡 Host: ${DB_CONFIG.host}\n`);

  for (const filename of MIGRATION_FILES) {
    const filePath = join(MIGRATIONS_DIR, filename);
    const sql = readFileSync(filePath, 'utf8');
    console.log(`📄 ${filename}...`);

    const client = new Client(DB_CONFIG);
    await client.connect();
    try {
      try {
        await client.query(sql);
        console.log(`   ✅ Applied (whole file)\n`);
      } catch (err) {
        if (isSkippable(err)) {
          const { applied, skipped } = await runStatements(client, sql);
          console.log(`   ✅ Applied: ${applied}  Skipped: ${skipped}\n`);
        } else {
          console.error(`   ❌ Failed: ${err.message} [${err.code}]`);
          if (err.position) {
            const pos = +err.position;
            console.error(`   Near pos ${pos}: ...${sql.slice(Math.max(0, pos - 60), pos + 60)}...`);
          }
          throw err;
        }
      }
    } finally {
      await client.end().catch(() => {});
    }
  }

  // Verification
  const vc = new Client(DB_CONFIG);
  await vc.connect();
  try {
    const { rows } = await vc.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
    const tables = rows.map(r => r.tablename);
    const required = ['profiles','friend_requests','groups','group_members','expenses','expense_payers','expense_shares','settlements','notifications','activity_log','invitation_tokens'];
    const missing = required.filter(t => !tables.includes(t));
    if (missing.length) { console.error('❌ Missing tables:', missing.join(', ')); process.exit(1); }
    console.log('✅ Tables:', tables.join(', '));

    const { rows: r2 } = await vc.query(`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
    const noRls = r2.filter(r => !r.rowsecurity).map(r => r.tablename);
    if (noRls.length) console.warn('⚠️  No RLS:', noRls.join(', '));
    else console.log('✅ RLS enabled on all tables');

    const { rows: r3 } = await vc.query(`SELECT proname FROM pg_proc JOIN pg_namespace n ON n.oid=pg_proc.pronamespace WHERE n.nspname='public' ORDER BY proname`);
    console.log('✅ Functions:', r3.map(r=>r.proname).join(', '));
  } finally {
    await vc.end().catch(()=>{});
  }

  console.log('\n🎉 All migrations applied successfully!');
}

main().catch(err => { console.error('💥', err.message); process.exit(1); });
