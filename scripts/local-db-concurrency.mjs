import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const expected = {
  host: 'localhost',
  port: '5432',
  database: 'fall_split_test',
  user: 'fall_split_test_user',
};

for (const [key, value] of Object.entries(expected)) {
  if (process.env[`PG${key.toUpperCase()}`] !== value) {
    throw new Error(
      `Refusing database concurrency test: PG${key.toUpperCase()} must target ${value}.`
    );
  }
}

const userA = process.env.LOCAL_DB_CONCURRENCY_USER_A;
const userB = process.env.LOCAL_DB_CONCURRENCY_USER_B;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!uuidPattern.test(userA ?? '') || !uuidPattern.test(userB ?? '') || userA === userB) {
  throw new Error(
    'Set LOCAL_DB_CONCURRENCY_USER_A and LOCAL_DB_CONCURRENCY_USER_B to two distinct, pre-provisioned disposable local Auth fixture IDs.'
  );
}

const connect = async () => {
  const client = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: false,
    application_name: 'fall-split-local-concurrency-test',
  });
  await client.connect();
  return client;
};

const setup = await connect();
const settlement = await connect();
const editor = await connect();
const idempotencyKey = `db-concurrency-${randomUUID()}`;
let expenseId;
let settlementTx = false;
let editorTx = false;
let setupTx = false;
let setupCommitted = false;
let editPromise;

try {
  const {
    rows: [target],
  } = await setup.query(`
    SELECT current_database() AS database, current_user AS role,
      inet_server_addr()::text AS address, inet_server_port() AS port,
      current_setting('server_version_num')::integer AS version_num
  `);
  const serverAddress = target.address?.split('/')[0];
  if (
    target.database !== expected.database ||
    target.role !== expected.user ||
    !['127.0.0.1', '::1'].includes(serverAddress) ||
    target.port !== 5432 ||
    target.version_num < 170000 ||
    target.version_num >= 180000
  ) {
    throw new Error(
      `Refusing database concurrency test: target was ${target.database}/${target.role} at ${target.address}:${target.port}, PostgreSQL ${target.version_num}.`
    );
  }

  const {
    rows: [cleanupPrivileges],
  } = await setup.query(`
    SELECT has_table_privilege(current_user, 'public.expenses', 'DELETE') AS can_delete_expenses
  `);
  if (!cleanupPrivileges.can_delete_expenses) {
    throw new Error(
      'Refusing concurrency test before setup: the local role cannot clean up its expense fixture.'
    );
  }

  const { rows: identities } = await setup.query(
    `SELECT auth_user.id, auth_user.email LIKE '%@concurrency.local.invalid' AS disposable,
       profile.id IS NOT NULL AS has_profile, profile.deleted_at IS NULL AS profile_active
     FROM auth.users AS auth_user
     LEFT JOIN public.profiles AS profile ON profile.id = auth_user.id
     WHERE auth_user.id = ANY($1::uuid[])`,
    [[userA, userB]]
  );
  if (
    identities.length !== 2 ||
    identities.some(
      (identity) => !identity.disposable || !identity.has_profile || !identity.profile_active
    )
  ) {
    throw new Error(
      'Refusing concurrency test: both supplied IDs must be existing active disposable @concurrency.local.invalid Auth fixtures.'
    );
  }

  await setup.query('BEGIN');
  setupTx = true;
  await setup.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userA]);
  const {
    rows: [activeA],
  } = await setup.query('SELECT public.is_active_account() AS active');
  await setup.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userB]);
  const {
    rows: [activeB],
  } = await setup.query('SELECT public.is_active_account() AS active');
  if (!activeA.active || !activeB.active) {
    throw new Error('Refusing concurrency test: both supplied identities must be active accounts.');
  }
  await setup.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userA]);
  const created = await setup.query(
    `SELECT public.create_expense_with_records(
       $1::jsonb, $2::jsonb, $3::jsonb
     ) AS expense_id`,
    [
      JSON.stringify({
        title: 'Local concurrent settlement/edit test',
        amount_paise: 10000,
        currency: 'INR',
        split_method: 'equal',
        group_id: null,
        creator_id: userA,
        expense_date: new Date().toISOString().slice(0, 10),
        category: null,
        notes: null,
        idempotency_key: idempotencyKey,
      }),
      JSON.stringify([{ userId: userA, amountPaise: 10000 }]),
      JSON.stringify([
        { userId: userA, amountPaise: 5000 },
        { userId: userB, amountPaise: 5000 },
      ]),
    ]
  );
  expenseId = created.rows[0].expense_id;
  await setup.query('COMMIT');
  setupTx = false;
  setupCommitted = true;

  const {
    rows: [expense],
  } = await setup.query(
    'SELECT updated_at::text AS updated_at FROM public.expenses WHERE id = $1',
    [expenseId]
  );

  await settlement.query('BEGIN');
  settlementTx = true;
  await settlement.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userB]);
  const proposed = await settlement.query(
    'SELECT public.propose_settlement($1, $2, $3) AS settlement_id',
    [userA, 5000, `settlement-${randomUUID()}`]
  );
  if (!proposed.rows[0].settlement_id)
    throw new Error('Settlement RPC did not create its test proposal.');

  await editor.query('BEGIN');
  editorTx = true;
  await editor.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userA]);
  const {
    rows: [editorPid],
  } = await editor.query('SELECT pg_backend_pid() AS pid');
  editPromise = editor.query(
    `SELECT public.update_expense_with_records(
       $1, $2, $3, $4, $5::date, NULL, NULL
     ) AS expense_id`,
    [
      expenseId,
      expense.updated_at,
      'Concurrent edit after settlement lock',
      12000,
      new Date().toISOString().slice(0, 10),
    ]
  );

  let observedPairLockWait = false;
  const waitDeadline = Date.now() + 5000;
  while (Date.now() < waitDeadline) {
    const { rows } = await setup.query(
      'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1',
      [editorPid.pid]
    );
    if (rows[0]?.wait_event_type === 'Lock') {
      observedPairLockWait = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  if (!observedPairLockWait) {
    throw new Error('Did not observe the expense edit waiting on the settlement-held lock.');
  }

  // Roll back the proposal to keep the test fully disposable. This releases
  // the actual settlement RPC's pair lock; the blocked edit must then finish.
  await settlement.query('ROLLBACK');
  settlementTx = false;
  const edited = await editPromise;
  if (edited.rows[0].expense_id !== expenseId)
    throw new Error('Concurrent edit returned an unexpected ID.');
  await editor.query('COMMIT');
  editorTx = false;

  const {
    rows: [totals],
  } = await setup.query(
    `
    SELECT expense.amount_paise,
      (SELECT sum(amount_paise) FROM public.expense_payers WHERE expense_id = expense.id) AS paid,
      (SELECT sum(amount_paise) FROM public.expense_shares WHERE expense_id = expense.id) AS shared
    FROM public.expenses AS expense WHERE expense.id = $1
  `,
    [expenseId]
  );
  if (
    Number(totals.amount_paise) !== 12000 ||
    Number(totals.paid) !== 12000 ||
    Number(totals.shared) !== 12000
  ) {
    throw new Error('Concurrent edit did not preserve header/payer/share reconciliation.');
  }
  console.log(
    'PASS: real settlement proposal and expense-edit RPCs overlapped on two independent sessions; settlement rolled back, edit completed, and totals reconciled.'
  );
} finally {
  if (settlementTx) await settlement.query('ROLLBACK').catch(() => {});
  if (editorTx) await editor.query('ROLLBACK').catch(() => {});
  if (editPromise) await editPromise.catch(() => {});

  let cleanupFailure;
  if (setupCommitted && expenseId) {
    await setup.query('BEGIN');
    try {
      await setup.query('DELETE FROM public.expenses WHERE id = $1', [expenseId]);
      const {
        rows: [remaining],
      } = await setup.query(
        `SELECT count(*)::integer AS count FROM public.expenses WHERE id = $1`,
        [expenseId]
      );
      if (remaining.count !== 0)
        throw new Error('Concurrency expense cleanup did not remove its row.');
      await setup.query('COMMIT');
    } catch (error) {
      await setup.query('ROLLBACK');
      console.error('Disposable concurrency expense cleanup failed; inspect the local test DB.');
      cleanupFailure = error;
    }
  } else if (setupTx) {
    await setup.query('ROLLBACK').catch(() => {});
  }

  await Promise.all(
    [setup.end(), settlement.end(), editor.end()].map((client) => client.catch(() => {}))
  );
  if (cleanupFailure) throw cleanupFailure;
}
