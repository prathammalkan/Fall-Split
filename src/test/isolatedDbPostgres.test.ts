import fs from 'fs';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

declare const process: { env: Record<string, string | undefined> };

const { Client } = pg;

function hasLocalDbCredentials(): boolean {
  try {
    const pgpassPath = `${process.env.USERPROFILE || ''}/AppData/Roaming/postgresql/pgpass.conf`;
    if (!fs.existsSync(pgpassPath)) return false;
    const pgpass = fs.readFileSync(pgpassPath, 'utf8');
    return pgpass.split('\n').some((l: string) => l.includes('fall_split_test_user'));
  } catch {
    return false;
  }
}

function createLocalTestClient(): InstanceType<typeof Client> | null {
  try {
    const pgpassPath = `${process.env.USERPROFILE || ''}/AppData/Roaming/postgresql/pgpass.conf`;
    if (!fs.existsSync(pgpassPath)) return null;

    const pgpass = fs.readFileSync(pgpassPath, 'utf8');
    const line = pgpass.split('\n').find((l: string) => l.includes('fall_split_test_user'));
    if (!line) return null;

    const parts = line.trim().split(':');
    const password = parts[4];
    return new Client({
      host: 'localhost',
      port: 5432,
      user: 'fall_split_test_user',
      password,
      database: 'fall_split_test',
    });
  } catch {
    return null;
  }
}

const describeIfLocalDb = hasLocalDbCredentials() ? describe : describe.skip;

describeIfLocalDb(
  'PostgreSQL 17 Live Integration: Participant Approval & Settlement Invariants',
  () => {
    it('executes full approval lifecycle, dispute, edit invalidation, and settlement reconciliation against PostgreSQL', async () => {
      const client = createLocalTestClient();
      if (!client) return;
      await client.connect();

      const aliceId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
      const bobId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

      await client.query('BEGIN');
      try {
        // 1. Ensure test profiles exist
        await client.query(`
        INSERT INTO public.profiles (id, username, display_name)
        VALUES 
          ('${aliceId}', 'alice_test', 'Alice Test'),
          ('${bobId}', 'bob_test', 'Bob Test')
        ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, deleted_at = NULL;
      `);

        // 2. Alice creates an expense with Bob as participant for 10000 paise (100 INR)
        await client.query(`SET LOCAL request.jwt.claim.sub = '${aliceId}'`);

        const expensePayload = {
          creator_id: aliceId,
          idempotency_key: 'test-idemp-' + Date.now(),
          title: 'Dinner at Olive',
          amount_paise: 10000,
          currency: 'INR',
          split_method: 'equal',
          expense_date: '2026-10-24',
        };
        const payersPayload = [{ userId: aliceId, amountPaise: 10000 }];
        const sharesPayload = [
          { userId: aliceId, amountPaise: 5000 },
          { userId: bobId, amountPaise: 5000 },
        ];

        const createRes = await client.query(
          `SELECT public.create_expense_with_records($1::jsonb, $2::jsonb, $3::jsonb) AS expense_id`,
          [
            JSON.stringify(expensePayload),
            JSON.stringify(payersPayload),
            JSON.stringify(sharesPayload),
          ]
        );

        const expenseId = createRes.rows[0].expense_id;
        expect(expenseId).toBeTruthy();

        // Verify initial status is pending_approval
        const expRow = await client.query('SELECT status FROM public.expenses WHERE id = $1', [
          expenseId,
        ]);
        expect(expRow.rows[0].status).toBe('pending_approval');

        // Verify approval row was created for Bob
        const appRow = await client.query(
          'SELECT * FROM public.expense_approvals WHERE expense_id = $1 AND user_id = $2',
          [expenseId, bobId]
        );
        expect(appRow.rows[0]?.status).toBe('pending');

        // 3. Verify balance exclusion: expense_pair_allocations should return NOTHING for Alice
        const allocBefore = await client.query<{ expense_id: string }>(
          'SELECT * FROM public.expense_pair_allocations($1, NULL)',
          [aliceId]
        );
        const aliceBobAllocBefore = allocBefore.rows.filter((r) => r.expense_id === expenseId);
        expect(aliceBobAllocBefore.length).toBe(0);

        // 4. Test dispute behavior: Bob disputes
        await client.query(`SET LOCAL request.jwt.claim.sub = '${bobId}'`);
        const disputeRes = await client.query<{
          result: { expense_status: string; all_approved: boolean };
        }>(
          `SELECT public.respond_to_expense_approval($1, 'dispute', 'Overcharged for drinks', 'Incorrect personal share') AS result`,
          [expenseId]
        );
        expect(disputeRes.rows[0].result.expense_status).toBe('disputed');

        const expDisputed = await client.query('SELECT status FROM public.expenses WHERE id = $1', [
          expenseId,
        ]);
        expect(expDisputed.rows[0].status).toBe('disputed');

        // Disputed expense must still NOT appear in allocations
        const allocDisputed = await client.query<{ expense_id: string }>(
          'SELECT * FROM public.expense_pair_allocations($1, NULL)',
          [aliceId]
        );
        const aliceBobAllocDisputed = allocDisputed.rows.filter((r) => r.expense_id === expenseId);
        expect(aliceBobAllocDisputed.length).toBe(0);

        // 5. Test approval: Bob approves
        const approveRes = await client.query<{
          result: { expense_status: string; all_approved: boolean };
        }>(`SELECT public.respond_to_expense_approval($1, 'approve') AS result`, [expenseId]);
        expect(approveRes.rows[0].result.all_approved).toBe(true);
        expect(approveRes.rows[0].result.expense_status).toBe('confirmed');

        const expConfirmed = await client.query(
          'SELECT status FROM public.expenses WHERE id = $1',
          [expenseId]
        );
        expect(expConfirmed.rows[0].status).toBe('confirmed');

        // Now it MUST appear in expense_pair_allocations!
        const allocConfirmed = await client.query<{
          expense_id: string;
          participant_id: string;
          amount_paise: number;
        }>('SELECT * FROM public.expense_pair_allocations($1, NULL)', [aliceId]);
        const aliceBobAllocConfirmed = allocConfirmed.rows.filter(
          (r) => r.expense_id === expenseId
        );
        expect(aliceBobAllocConfirmed.length).toBe(2);
        const bobShare = aliceBobAllocConfirmed.find((r) => r.participant_id === bobId);
        expect(Number(bobShare?.amount_paise)).toBe(5000);

        // 6. Test approval invalidation on material edit by Alice
        await client.query(`SET LOCAL request.jwt.claim.sub = '${aliceId}'`);
        const expHeader = await client.query(
          'SELECT updated_at::text FROM public.expenses WHERE id = $1',
          [expenseId]
        );
        const expectedUpdatedAt = expHeader.rows[0].updated_at;

        await client.query(
          `SELECT public.update_expense_with_records(
          $1, $2, 'Dinner at Olive (Edited)', 12000, '2026-10-24'::date, 'Added dessert', 'Food'
        )`,
          [expenseId, expectedUpdatedAt]
        );

        // Check expense status dropped back to pending_approval
        const expEdited = await client.query(
          'SELECT status, amount_paise FROM public.expenses WHERE id = $1',
          [expenseId]
        );
        expect(expEdited.rows[0].status).toBe('pending_approval');
        expect(Number(expEdited.rows[0].amount_paise)).toBe(12000);

        // Check Bob's approval reset to pending
        const appEdited = await client.query(
          'SELECT status, dispute_reason FROM public.expense_approvals WHERE expense_id = $1 AND user_id = $2',
          [expenseId, bobId]
        );
        expect(appEdited.rows[0].status).toBe('pending');
        expect(appEdited.rows[0].dispute_reason).toBeNull();

        // Check allocations: again EXCLUDED from balance!
        const allocAfterEdit = await client.query<{ expense_id: string }>(
          'SELECT * FROM public.expense_pair_allocations($1, NULL)',
          [aliceId]
        );
        const aliceBobAllocAfterEdit = allocAfterEdit.rows.filter(
          (r) => r.expense_id === expenseId
        );
        expect(aliceBobAllocAfterEdit.length).toBe(0);

        // 7. Bob re-approves edited expense
        await client.query(`SET LOCAL request.jwt.claim.sub = '${bobId}'`);
        await client.query(`SELECT public.respond_to_expense_approval($1, 'approve')`, [expenseId]);

        // Check confirmed balance from get_friend_balances
        await client.query(`SET LOCAL request.jwt.claim.sub = '${aliceId}'`);
        const balRes = await client.query(
          `SELECT * FROM public.get_friend_balances() WHERE other_user_id = $1`,
          [bobId]
        );
        expect(Number(balRes.rows[0].net_paise)).toBe(6000); // Bob owes Alice 6000

        // 8. Test settlement confirmation: Bob proposes settlement of 6000 paise
        await client.query(`SET LOCAL request.jwt.claim.sub = '${bobId}'`);
        const settleRes = await client.query(
          `SELECT public.propose_settlement($1, $2, $3) AS settlement_id`,
          [aliceId, 6000, 'settle-idemp-' + Date.now()]
        );
        const settlementId = settleRes.rows[0].settlement_id;
        expect(settlementId).toBeTruthy();

        // Balance invariant: unconfirmed settlement does NOT alter balance!
        await client.query(`SET LOCAL request.jwt.claim.sub = '${aliceId}'`);
        const balWhileProposed = await client.query(
          `SELECT * FROM public.get_friend_balances() WHERE other_user_id = $1`,
          [bobId]
        );
        expect(Number(balWhileProposed.rows[0].net_paise)).toBe(6000);

        // Alice confirms settlement
        await client.query(`SELECT public.respond_to_settlement($1, 'confirm')`, [settlementId]);

        // Balance invariant: confirmed settlement reduces balance to 0 (all settled up)!
        const balAfterSettlement = await client.query(
          `SELECT * FROM public.get_friend_balances() WHERE other_user_id = $1`,
          [bobId]
        );
        const aliceBobBal = balAfterSettlement.rows[0]
          ? Number(balAfterSettlement.rows[0].net_paise)
          : 0;
        expect(aliceBobBal).toBe(0);
      } finally {
        await client.query('ROLLBACK');
        await client.end();
      }
    });

    it('verifies historical active expense status conversion, approval backfill, and delete cleanup', async () => {
      const client = createLocalTestClient();
      if (!client) return;
      await client.connect();

      const aliceId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
      const bobId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

      await client.query('BEGIN');
      try {
        await client.query(`
          INSERT INTO public.profiles (id, username, display_name)
          VALUES 
            ('${aliceId}', 'alice_test', 'Alice Test'),
            ('${bobId}', 'bob_test', 'Bob Test')
          ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, deleted_at = NULL;
        `);

        // 1. Insert a legacy/historical expense with status = 'active' and NO approval rows
        const legacyExpenseId = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
        await client.query(`
          INSERT INTO public.expenses (
            id, title, amount_paise, currency, split_method, creator_id, expense_date, status, idempotency_key
          ) VALUES (
            '${legacyExpenseId}', 'Legacy Trip', 5000, 'INR', 'equal', '${aliceId}', '2026-10-01', 'active', 'legacy-key-1'
          );
          INSERT INTO public.expense_payers (expense_id, user_id, amount_paise)
          VALUES ('${legacyExpenseId}', '${aliceId}', 5000);
          INSERT INTO public.expense_shares (expense_id, user_id, amount_paise)
          VALUES 
            ('${legacyExpenseId}', '${aliceId}', 2500),
            ('${legacyExpenseId}', '${bobId}', 2500);
        `);

        // Verify no approval rows currently exist
        const approvalsBefore = await client.query(
          'SELECT * FROM public.expense_approvals WHERE expense_id = $1',
          [legacyExpenseId]
        );
        expect(approvalsBefore.rows.length).toBe(0);

        // 2. Execute migration backfill statements
        await client.query(`
          UPDATE public.expenses
          SET status = 'confirmed'
          WHERE status = 'active';

          INSERT INTO public.expense_approvals (expense_id, user_id, status, responded_at)
          SELECT share.expense_id, share.user_id, 'approved', e.created_at
          FROM public.expense_shares share
          JOIN public.expenses e ON e.id = share.expense_id
          WHERE e.status = 'confirmed'
            AND share.user_id <> e.creator_id
          ON CONFLICT (expense_id, user_id) DO NOTHING;
        `);

        // 3. Verify status transitioned to 'confirmed'
        const expAfterBackfill = await client.query(
          'SELECT status FROM public.expenses WHERE id = $1',
          [legacyExpenseId]
        );
        expect(expAfterBackfill.rows[0].status).toBe('confirmed');

        // 4. Verify approval row was backfilled for Bob with status = 'approved'
        const approvalsAfter = await client.query(
          'SELECT * FROM public.expense_approvals WHERE expense_id = $1',
          [legacyExpenseId]
        );
        expect(approvalsAfter.rows.length).toBe(1);
        expect(approvalsAfter.rows[0].user_id).toBe(bobId);
        expect(approvalsAfter.rows[0].status).toBe('approved');

        // 5. Test delete_expense cleanup: Alice deletes the expense
        await client.query(`SET LOCAL request.jwt.claim.sub = '${aliceId}'`);
        await client.query('SELECT public.delete_expense($1)', [legacyExpenseId]);

        // Verify expense status is deleted
        const expDeleted = await client.query('SELECT status FROM public.expenses WHERE id = $1', [
          legacyExpenseId,
        ]);
        expect(expDeleted.rows[0].status).toBe('deleted');

        // Verify child expense_approvals row was cleaned up
        const approvalsAfterDelete = await client.query(
          'SELECT * FROM public.expense_approvals WHERE expense_id = $1',
          [legacyExpenseId]
        );
        expect(approvalsAfterDelete.rows.length).toBe(0);
      } finally {
        await client.query('ROLLBACK');
        await client.end();
      }
    });

    it('enforces creator self-approval rejection, non-participant rejection, non-creator deletion rejection, settlement rejection, and idempotency bounds', async () => {
      const client = createLocalTestClient();
      if (!client) return;
      await client.connect();

      const aliceId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
      const bobId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
      const charlieId = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';

      await client.query('BEGIN');
      try {
        await client.query(`
          INSERT INTO public.profiles (id, username, display_name)
          VALUES 
            ('${aliceId}', 'alice_test', 'Alice Test'),
            ('${bobId}', 'bob_test', 'Bob Test'),
            ('${charlieId}', 'charlie_test', 'Charlie Test')
          ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, deleted_at = NULL;
        `);

        // 1. Alice creates an expense with Bob as participant
        await client.query(`SET LOCAL request.jwt.claim.sub = '${aliceId}'`);
        const idempKey = 'idemp-auth-test-' + Date.now();
        const expensePayload = {
          creator_id: aliceId,
          idempotency_key: idempKey,
          title: 'Concert Tickets',
          amount_paise: 4000,
          currency: 'INR',
          split_method: 'equal',
          expense_date: '2026-10-24',
        };
        const payersPayload = [{ userId: aliceId, amountPaise: 4000 }];
        const sharesPayload = [
          { userId: aliceId, amountPaise: 2000 },
          { userId: bobId, amountPaise: 2000 },
        ];

        const createRes = await client.query(
          `SELECT public.create_expense_with_records($1::jsonb, $2::jsonb, $3::jsonb) AS expense_id`,
          [
            JSON.stringify(expensePayload),
            JSON.stringify(payersPayload),
            JSON.stringify(sharesPayload),
          ]
        );
        const expenseId = createRes.rows[0].expense_id;

        // 2. Creator self-approval rejection: Alice attempts to approve her own expense
        let selfApprovalError: Error | null = null;
        await client.query('SAVEPOINT sp_self_app');
        try {
          await client.query(`SELECT public.respond_to_expense_approval($1, 'approve')`, [
            expenseId,
          ]);
        } catch (err) {
          selfApprovalError = err as Error;
          await client.query('ROLLBACK TO SAVEPOINT sp_self_app');
        }
        expect(selfApprovalError).not.toBeNull();
        expect(selfApprovalError?.message).toContain(
          'You are not a required participant for this expense approval'
        );

        // 3. Unauthorized non-participant approval rejection: Charlie attempts to approve
        await client.query(`SET LOCAL request.jwt.claim.sub = '${charlieId}'`);
        let charlieApprovalError: Error | null = null;
        await client.query('SAVEPOINT sp_charlie_app');
        try {
          await client.query(`SELECT public.respond_to_expense_approval($1, 'approve')`, [
            expenseId,
          ]);
        } catch (err) {
          charlieApprovalError = err as Error;
          await client.query('ROLLBACK TO SAVEPOINT sp_charlie_app');
        }
        expect(charlieApprovalError).not.toBeNull();
        expect(charlieApprovalError?.message).toContain(
          'You are not a required participant for this expense approval'
        );

        // 4. Deletion rejection by non-creator: Bob attempts to delete Alice's expense
        await client.query(`SET LOCAL request.jwt.claim.sub = '${bobId}'`);
        let bobDeleteError: Error | null = null;
        await client.query('SAVEPOINT sp_bob_del');
        try {
          await client.query('SELECT public.delete_expense($1)', [expenseId]);
        } catch (err) {
          bobDeleteError = err as Error;
          await client.query('ROLLBACK TO SAVEPOINT sp_bob_del');
        }
        expect(bobDeleteError).not.toBeNull();
        expect(bobDeleteError?.message).toContain(
          'Only the expense creator may delete this expense'
        );

        // 5. Bob attempts to approve invalid action or dispute
        await client.query(`SET LOCAL request.jwt.claim.sub = '${bobId}'`);

        // 6. Bob approves expense
        await client.query(`SELECT public.respond_to_expense_approval($1, 'approve')`, [expenseId]);

        // 7. Settlement reporting and REJECTION: Bob proposes settlement
        const settleRes = await client.query(
          `SELECT public.propose_settlement($1, $2, $3) AS settlement_id`,
          [aliceId, 2000, 'settle-reject-idemp-' + Date.now()]
        );
        const settlementId = settleRes.rows[0].settlement_id;

        // Alice rejects settlement
        await client.query(`SET LOCAL request.jwt.claim.sub = '${aliceId}'`);
        await client.query(`SELECT public.respond_to_settlement($1, 'reject')`, [settlementId]);

        const settleRow = await client.query(
          'SELECT status FROM public.settlements WHERE id = $1',
          [settlementId]
        );
        expect(settleRow.rows[0].status).toBe('rejected');

        // Balance invariant: rejected settlement does NOT reduce debt!
        const balAfterReject = await client.query(
          `SELECT net_paise FROM public.get_friend_balances() WHERE other_user_id = $1`,
          [bobId]
        );
        expect(Number(balAfterReject.rows[0].net_paise)).toBe(2000);

        // 8. Idempotency replay check: Alice resubmits with identical idempotency key -> returns same expense ID
        const retryRes = await client.query(
          `SELECT public.create_expense_with_records($1::jsonb, $2::jsonb, $3::jsonb) AS expense_id`,
          [
            JSON.stringify(expensePayload),
            JSON.stringify(payersPayload),
            JSON.stringify(sharesPayload),
          ]
        );
        expect(retryRes.rows[0].expense_id).toBe(expenseId);

        // Conflicting replay with different amount -> throws collision error
        const conflictingPayers = [{ userId: aliceId, amountPaise: 9999 }];
        const conflictingShares = [
          { userId: aliceId, amountPaise: 5000 },
          { userId: bobId, amountPaise: 4999 },
        ];
        let conflictError: Error | null = null;
        await client.query('SAVEPOINT sp_conflict');
        try {
          await client.query(
            `SELECT public.create_expense_with_records($1::jsonb, $2::jsonb, $3::jsonb) AS expense_id`,
            [
              JSON.stringify({ ...expensePayload, amount_paise: 9999 }),
              JSON.stringify(conflictingPayers),
              JSON.stringify(conflictingShares),
            ]
          );
        } catch (err) {
          conflictError = err as Error;
          await client.query('ROLLBACK TO SAVEPOINT sp_conflict');
        }
        expect(conflictError).not.toBeNull();
        expect(conflictError?.message).toContain(
          'Expense idempotency key was already used for different details'
        );
      } finally {
        await client.query('ROLLBACK');
        await client.end();
      }
    });
  }
);
