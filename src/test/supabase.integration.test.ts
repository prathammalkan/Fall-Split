import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

declare const process: { env: Record<string, string | undefined> };

const securityTestsEnabled = process.env.SUPABASE_DISPOSABLE_SECURITY_TESTS === '1';
const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const targetJwt = process.env.SUPABASE_SECURITY_TARGET_JWT;
const targetUserId = process.env.SUPABASE_SECURITY_TARGET_USER_ID;
const activeJwt = process.env.SUPABASE_SECURITY_ACTIVE_JWT;
const activeUserId = process.env.SUPABASE_SECURITY_ACTIVE_USER_ID;
const privateProfileId = process.env.SUPABASE_SECURITY_PRIVATE_PROFILE_ID;
const privateGroupId = process.env.SUPABASE_SECURITY_PRIVATE_GROUP_ID;
const invitationToken = process.env.SUPABASE_SECURITY_INVITATION_TOKEN;
const retainedExpenseId = process.env.SUPABASE_SECURITY_RETAINED_EXPENSE_ID;
const retainedSettlementId = process.env.SUPABASE_SECURITY_RETAINED_SETTLEMENT_ID;
const disposableTargetId = process.env.SUPABASE_SECURITY_DISPOSABLE_TARGET_ID;
const disposableProjectRef = process.env.SUPABASE_DISPOSABLE_PROJECT_REF;
const disposableProjectConfirmation = process.env.SUPABASE_DISPOSABLE_PROJECT_CONFIRMATION;
const productionProjectRef = process.env.SUPABASE_PRODUCTION_PROJECT_REF;
const authDeletionConfirmation = process.env.SUPABASE_SECURITY_AUTH_DELETE_CONFIRMATION;

const requiredSecurityFixtures = {
  SUPABASE_URL: url,
  SUPABASE_ANON_KEY: anonKey,
  SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  SUPABASE_SECURITY_TARGET_JWT: targetJwt,
  SUPABASE_SECURITY_TARGET_USER_ID: targetUserId,
  SUPABASE_SECURITY_ACTIVE_JWT: activeJwt,
  SUPABASE_SECURITY_ACTIVE_USER_ID: activeUserId,
  SUPABASE_SECURITY_PRIVATE_PROFILE_ID: privateProfileId,
  SUPABASE_SECURITY_PRIVATE_GROUP_ID: privateGroupId,
  SUPABASE_SECURITY_INVITATION_TOKEN: invitationToken,
  SUPABASE_SECURITY_RETAINED_EXPENSE_ID: retainedExpenseId,
  SUPABASE_SECURITY_RETAINED_SETTLEMENT_ID: retainedSettlementId,
  SUPABASE_SECURITY_DISPOSABLE_TARGET_ID: disposableTargetId,
  SUPABASE_DISPOSABLE_PROJECT_REF: disposableProjectRef,
  SUPABASE_DISPOSABLE_PROJECT_CONFIRMATION: disposableProjectConfirmation,
  SUPABASE_PRODUCTION_PROJECT_REF: productionProjectRef,
  SUPABASE_SECURITY_AUTH_DELETE_CONFIRMATION: authDeletionConfirmation,
};

if (securityTestsEnabled) {
  const missing = Object.entries(requiredSecurityFixtures)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Disposable security tests require: ${missing.join(', ')}`);
  }
  if (process.env.SUPABASE_SECURITY_TARGET_IS_DISPOSABLE !== '1') {
    throw new Error('The target identity must be explicitly marked disposable.');
  }
  if (
    disposableTargetId !== targetUserId ||
    disposableProjectConfirmation !== disposableProjectRef
  ) {
    throw new Error(
      'Disposable target and project confirmation must exactly match their configured IDs.'
    );
  }
  if (productionProjectRef === disposableProjectRef) {
    throw new Error(
      'Disposable project reference must not match the configured production project reference.'
    );
  }
  if (authDeletionConfirmation !== `DELETE_AUTH_USER_${targetUserId}`) {
    throw new Error(
      'Auth deletion requires an explicit confirmation matching the disposable target ID.'
    );
  }

  const parsedUrl = new URL(url!);
  const isLocalProject = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1';
  const isConfirmedHostedProject = parsedUrl.hostname === `${disposableProjectRef}.supabase.co`;
  if (!isLocalProject && !isConfirmedHostedProject) {
    throw new Error(
      'Database URL does not match the explicitly confirmed disposable project reference.'
    );
  }
  if (isLocalProject && parsedUrl.port !== '54321') {
    throw new Error('Local Supabase tests must use the standard local API port 54321.');
  }
}

const integrationDescribe = securityTestsEnabled ? describe : describe.skip;

integrationDescribe('Supabase integration checks', () => {
  const clients = securityTestsEnabled
    ? {
        anon: createClient(url!, anonKey!, {
          auth: { persistSession: false, autoRefreshToken: false },
        }),
        admin: createClient(url!, serviceRoleKey!, {
          auth: { persistSession: false, autoRefreshToken: false },
        }),
        stale: createClient(url!, anonKey!, {
          global: { headers: { Authorization: `Bearer ${targetJwt}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        }),
        active: createClient(url!, anonKey!, {
          global: { headers: { Authorization: `Bearer ${activeJwt}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        }),
      }
    : null;

  it('blocks anonymous reads of private profile storage', async () => {
    const { data, error } = await clients!.anon.from('profiles').select('id').limit(1);

    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it('denies anonymous internal helpers while preserving public invitation preview', async () => {
    const { data, error } = await clients!.anon.rpc('are_friends', {
      user_a: '00000000-0000-0000-0000-000000000001',
      user_b: '00000000-0000-0000-0000-000000000002',
    });

    expect(data).toBeNull();
    expect(error).not.toBeNull();

    const settlementUpis = await clients!.anon.rpc('get_settlement_recipient_upis');
    expect(settlementUpis.data).toBeNull();
    expect(settlementUpis.error).not.toBeNull();

    const anonymousMutations = await Promise.all([
      clients!.anon.rpc('accept_invitation', { p_token: invitationToken! }),
      clients!.anon.rpc('delete_account'),
      clients!.anon.rpc('propose_settlement', {
        p_recipient_id: activeUserId!,
        p_amount_paise: 1,
        p_idempotency_key: crypto.randomUUID(),
      }),
      clients!.anon.rpc('respond_to_settlement', {
        p_settlement_id: retainedSettlementId!,
        p_action: 'confirm',
      }),
      clients!.anon.rpc('cancel_settlement', { p_settlement_id: retainedSettlementId! }),
    ]);
    for (const result of anonymousMutations) {
      expect(result.error).not.toBeNull();
    }

    const preview = await clients!.anon.rpc('get_invitation_preview', {
      p_token: invitationToken!,
    });
    expect(preview.error).toBeNull();
    expect(preview.data).not.toBeNull();
  });

  it('checks active-user expense conservation and private-group isolation', async () => {
    expect(activeUserId).not.toBe(targetUserId);
    expect(privateProfileId).not.toBe(activeUserId);
    const ownProfile = await clients!.active.rpc('get_profile_for_user', {
      p_user_id: activeUserId!,
    });
    expect(ownProfile.error).toBeNull();
    expect(ownProfile.data?.[0]?.id).toBe(activeUserId);

    const crossCallerHelper = await clients!.active.rpc('are_friends', {
      user_a: privateProfileId!,
      user_b: targetUserId!,
    });
    expect(crossCallerHelper.error).toBeNull();
    expect(crossCallerHelper.data).toBe(false);

    const privateGroupMembership = await clients!.admin
      .from('group_members')
      .select('id')
      .eq('group_id', privateGroupId!)
      .eq('user_id', activeUserId!)
      .is('removed_at', null)
      .maybeSingle();
    expect(privateGroupMembership.error).toBeNull();
    expect(privateGroupMembership.data).toBeNull();

    const privateGroupRead = await clients!.active
      .from('groups')
      .select('id')
      .eq('id', privateGroupId!);
    expect(privateGroupRead.error).toBeNull();
    expect(privateGroupRead.data).toEqual([]);

    const expense = await clients!.admin
      .from('expenses')
      .select('id, amount_paise')
      .eq('id', retainedExpenseId!)
      .single();
    expect(expense.error).toBeNull();

    const payers = await clients!.admin
      .from('expense_payers')
      .select('amount_paise')
      .eq('expense_id', retainedExpenseId!);
    expect(payers.error).toBeNull();
    expect(payers.data!.length).toBeGreaterThanOrEqual(2);

    const shares = await clients!.admin
      .from('expense_shares')
      .select('amount_paise')
      .eq('expense_id', retainedExpenseId!);
    expect(shares.error).toBeNull();
    const payerTotal = payers.data!.reduce((sum, row) => sum + row.amount_paise, 0);
    const shareTotal = shares.data!.reduce((sum, row) => sum + row.amount_paise, 0);
    expect(payerTotal).toBe(expense.data!.amount_paise);
    expect(shareTotal).toBe(expense.data!.amount_paise);
  });

  it('rejects a non-party settlement response without changing confirmed history', async () => {
    const settlementBefore = await clients!.admin
      .from('settlements')
      .select('id, payer_id, recipient_id, amount_paise, status, confirmed_at')
      .eq('id', retainedSettlementId!)
      .single();
    expect(settlementBefore.error).toBeNull();
    expect(settlementBefore.data?.status).toBe('confirmed');
    expect(activeUserId).not.toBe(settlementBefore.data?.payer_id);
    expect(activeUserId).not.toBe(settlementBefore.data?.recipient_id);

    const unauthorizedResponse = await clients!.active.rpc('respond_to_settlement', {
      p_settlement_id: retainedSettlementId!,
      p_action: 'confirm',
    });
    expect(unauthorizedResponse.error).not.toBeNull();

    const settlementAfter = await clients!.admin
      .from('settlements')
      .select('id, payer_id, recipient_id, amount_paise, status, confirmed_at')
      .eq('id', retainedSettlementId!)
      .single();
    expect(settlementAfter.error).toBeNull();
    expect(settlementAfter.data).toEqual(settlementBefore.data);
  });

  it('atomically creates, repairs, and deduplicates expense financial records', async () => {
    const makeExpense = (idempotencyKey: string, title = 'Atomic expense') => ({
      title,
      amount_paise: 101,
      currency: 'INR',
      split_method: 'equal' as const,
      group_id: null,
      creator_id: activeUserId!,
      expense_date: '2026-10-21',
      category: null,
      notes: null,
      idempotency_key: idempotencyKey,
    });
    const validPayers = [
      { userId: activeUserId!, amountPaise: 60 },
      { userId: targetUserId!, amountPaise: 41 },
    ];
    const validShares = [
      { userId: activeUserId!, amountPaise: 50 },
      { userId: targetUserId!, amountPaise: 51 },
    ];
    const missingProfile = '00000000-0000-0000-0000-000000000000';

    const failedWrites = [
      (() => {
        const key = `atomic-header-${crypto.randomUUID()}`;
        return {
          expense: makeExpense(key, ''),
          payers: validPayers,
          shares: validShares,
        };
      })(),
      (() => {
        const key = `atomic-payer-${crypto.randomUUID()}`;
        return {
          expense: makeExpense(key),
          payers: [{ userId: missingProfile, amountPaise: 101 }],
          shares: validShares,
        };
      })(),
      (() => {
        const key = `atomic-share-${crypto.randomUUID()}`;
        return {
          expense: makeExpense(key),
          payers: validPayers,
          shares: [{ userId: missingProfile, amountPaise: 101 }],
        };
      })(),
    ];

    for (const failedWrite of failedWrites) {
      const result = await clients!.active.rpc('create_expense_with_records', {
        p_expense: failedWrite.expense,
        p_payers: failedWrite.payers,
        p_shares: failedWrite.shares,
      });
      expect(result.error).not.toBeNull();
      const rolledBackHeader = await clients!.admin
        .from('expenses')
        .select('id')
        .eq('idempotency_key', failedWrite.expense.idempotency_key)
        .maybeSingle();
      expect(rolledBackHeader.error).toBeNull();
      expect(rolledBackHeader.data).toBeNull();
    }

    const idempotencyKey = `atomic-reconcile-${crypto.randomUUID()}`;
    const expenseInput = makeExpense(idempotencyKey);
    const partialHeader = await clients!.admin
      .from('expenses')
      .insert(expenseInput)
      .select('id')
      .single();
    expect(partialHeader.error).toBeNull();

    const firstRetry = await clients!.active.rpc('create_expense_with_records', {
      p_expense: expenseInput,
      p_payers: validPayers,
      p_shares: validShares,
    });
    expect(firstRetry.error).toBeNull();
    expect(firstRetry.data).toBe(partialHeader.data?.id);

    const duplicate = await clients!.active.rpc('create_expense_with_records', {
      p_expense: expenseInput,
      p_payers: validPayers,
      p_shares: validShares,
    });
    expect(duplicate.error).toBeNull();
    expect(duplicate.data).toBe(firstRetry.data);

    const persistedExpense = await clients!.admin
      .from('expenses')
      .select('id, amount_paise')
      .eq('idempotency_key', idempotencyKey)
      .single();
    expect(persistedExpense.error).toBeNull();
    const persistedPayers = await clients!.admin
      .from('expense_payers')
      .select('amount_paise')
      .eq('expense_id', firstRetry.data!);
    expect(persistedPayers.error).toBeNull();
    const persistedShares = await clients!.admin
      .from('expense_shares')
      .select('amount_paise')
      .eq('expense_id', firstRetry.data!);
    expect(persistedShares.error).toBeNull();
    expect(persistedPayers.data).toHaveLength(2);
    expect(persistedShares.data).toHaveLength(2);
    expect(persistedPayers.data!.reduce((sum, row) => sum + row.amount_paise, 0)).toBe(101);
    expect(persistedShares.data!.reduce((sum, row) => sum + row.amount_paise, 0)).toBe(101);
    expect(persistedExpense.data?.amount_paise).toBe(101);
  });

  it('deletes only an explicitly disposable Auth identity while retaining its anonymized ledger profile', async () => {
    expect(activeUserId).not.toBe(targetUserId);

    const targetAuthUser = await clients!.admin.auth.admin.getUserById(targetUserId!);
    expect(targetAuthUser.error).toBeNull();
    expect(targetAuthUser.data.user?.app_metadata?.disposable_test_identity).toBe(true);

    const profileBefore = await clients!.admin
      .from('profiles')
      .select('id, username, display_name, avatar_url, bio, upi_id, deleted_at')
      .eq('id', targetUserId!)
      .single();
    expect(profileBefore.error).toBeNull();
    expect(profileBefore.data?.deleted_at).toBeNull();

    const membershipsBefore = await clients!.admin
      .from('group_members')
      .select('id, removed_at')
      .eq('user_id', targetUserId!)
      .is('removed_at', null);
    expect(membershipsBefore.error).toBeNull();

    const requestsBefore = await clients!.admin
      .from('friend_requests')
      .select('id, status, updated_at')
      .or(`sender_id.eq.${targetUserId},receiver_id.eq.${targetUserId}`)
      .eq('status', 'pending');
    expect(requestsBefore.error).toBeNull();

    const invitationsBefore = await clients!.admin
      .from('invitation_tokens')
      .select('id, revoked_at')
      .eq('creator_id', targetUserId!)
      .is('revoked_at', null);
    expect(invitationsBefore.error).toBeNull();

    const initiatedPendingSettlements = await clients!.admin
      .from('settlements')
      .select('id')
      .eq('payer_id', targetUserId!)
      .in('status', ['proposed', 'pending']);
    expect(initiatedPendingSettlements.error).toBeNull();
    expect(initiatedPendingSettlements.data).toEqual([]);

    const expenseBefore = await clients!.admin
      .from('expenses')
      .select('id, creator_id')
      .eq('id', retainedExpenseId!)
      .maybeSingle();
    expect(expenseBefore.error).toBeNull();
    expect(expenseBefore.data).not.toBeNull();

    const shareBefore = await clients!.admin
      .from('expense_shares')
      .select('id, user_id')
      .eq('expense_id', retainedExpenseId!)
      .eq('user_id', targetUserId!)
      .limit(1)
      .maybeSingle();
    expect(shareBefore.error).toBeNull();
    expect(shareBefore.data).not.toBeNull();

    const auditBefore = await clients!.admin
      .from('expense_history')
      .select('id')
      .eq('expense_id', retainedExpenseId!)
      .eq('changed_by', targetUserId!)
      .limit(1)
      .maybeSingle();
    expect(auditBefore.error).toBeNull();
    expect(auditBefore.data).not.toBeNull();

    const settlementBefore = await clients!.admin
      .from('settlements')
      .select('id, payer_id, recipient_id, status')
      .eq('id', retainedSettlementId!)
      .maybeSingle();
    expect(settlementBefore.error).toBeNull();
    expect(settlementBefore.data?.status).toBe('confirmed');
    expect(
      settlementBefore.data?.payer_id === targetUserId! ||
        settlementBefore.data?.recipient_id === targetUserId!
    ).toBe(true);

    let testError: unknown;
    let authDeletionSucceeded = false;
    const cleanupErrors: Error[] = [];
    try {
      const deactivation = await clients!.stale.rpc('delete_account');
      expect(deactivation.error).toBeNull();

      const deactivatedProfile = await clients!.admin
        .from('profiles')
        .select('deleted_at, display_name')
        .eq('id', targetUserId!)
        .single();
      expect(deactivatedProfile.error).toBeNull();
      expect(deactivatedProfile.data?.deleted_at).not.toBeNull();
      expect(deactivatedProfile.data?.display_name).toBe('[Deleted User]');

      const staleProfile = await clients!.stale
        .from('profiles')
        .select('id')
        .eq('id', targetUserId!);
      expect(staleProfile.error).toBeNull();
      expect(staleProfile.data).toEqual([]);

      const staleProfileUpdate = await clients!.stale
        .from('profiles')
        .update({ display_name: 'Stale JWT mutation' })
        .eq('id', targetUserId!)
        .select('id');
      expect(staleProfileUpdate.error !== null || staleProfileUpdate.data?.length === 0).toBe(true);

      const staleExpense = await clients!.stale
        .from('expenses')
        .select('id')
        .eq('id', retainedExpenseId!);
      expect(staleExpense.error).toBeNull();
      expect(staleExpense.data).toEqual([]);

      const staleSettlement = await clients!.stale
        .from('settlements')
        .select('id')
        .eq('id', retainedSettlementId!);
      expect(staleSettlement.error).toBeNull();
      expect(staleSettlement.data).toEqual([]);

      const staleBalances = await clients!.stale.rpc('get_friend_balances');
      expect(staleBalances.error).toBeNull();
      expect(staleBalances.data).toEqual([]);

      const staleMutation = await clients!.stale.rpc('propose_settlement', {
        p_recipient_id: crypto.randomUUID(),
        p_amount_paise: 1,
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(staleMutation.error?.message).toContain('Active account required');

      const staleInvitationMutation = await clients!.stale.rpc('accept_invitation', {
        p_token: 'inactive-account-invalid-token',
      });
      expect(staleInvitationMutation.error?.message).toContain('Active account required');
      const staleDeletionMutation = await clients!.stale.rpc('delete_account');
      expect(staleDeletionMutation.error?.message).toContain('Active account required');

      const expenseAfter = await clients!.admin
        .from('expenses')
        .select('id, creator_id')
        .eq('id', retainedExpenseId!)
        .maybeSingle();
      const shareAfter = await clients!.admin
        .from('expense_shares')
        .select('id, user_id')
        .eq('id', shareBefore.data!.id)
        .maybeSingle();
      const auditAfter = await clients!.admin
        .from('expense_history')
        .select('id')
        .eq('id', auditBefore.data!.id)
        .maybeSingle();
      const settlementAfter = await clients!.admin
        .from('settlements')
        .select('id, payer_id, recipient_id, status')
        .eq('id', retainedSettlementId!)
        .maybeSingle();
      expect(expenseAfter.data).toEqual(expenseBefore.data);
      expect(shareAfter.data).toEqual(shareBefore.data);
      expect(auditAfter.data).toEqual(auditBefore.data);
      expect(settlementAfter.data).toEqual(settlementBefore.data);

      const crossUserProfile = await clients!.active.rpc('get_profile_for_user', {
        p_user_id: privateProfileId!,
      });
      expect(crossUserProfile.error).toBeNull();
      expect(crossUserProfile.data).toEqual([]);

      const authDeletion = await clients!.admin.auth.admin.deleteUser(targetUserId!);
      authDeletionSucceeded = authDeletion.error === null;
      expect(authDeletion.error).toBeNull();
      const retainedProfile = await clients!.admin
        .from('profiles')
        .select('id, deleted_at, display_name, username')
        .eq('id', targetUserId!)
        .single();
      expect(retainedProfile.error).toBeNull();
      expect(retainedProfile.data?.deleted_at).not.toBeNull();
      expect(retainedProfile.data?.display_name).toBe('[Deleted User]');
      expect(retainedProfile.data?.username).toMatch(/^deleted_[0-9a-f]{22}$/);
    } catch (error) {
      testError = error;
    } finally {
      const recordCleanup = async (
        label: string,
        expectedRows: number,
        operation: () => Promise<{
          data: { id: string }[] | null;
          error: { message: string } | null;
        }>
      ) => {
        try {
          const result = await operation();
          if (result.error) {
            cleanupErrors.push(new Error(`${label}: ${result.error.message}`));
          } else if (result.data?.length !== expectedRows) {
            cleanupErrors.push(
              new Error(
                `${label}: expected ${expectedRows} restored row(s), received ${result.data?.length ?? 0}.`
              )
            );
          }
        } catch (error) {
          cleanupErrors.push(
            new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`)
          );
        }
      };

      if (!authDeletionSucceeded) {
        let identityStillExists = false;
        try {
          const { data, error } = await clients!.admin.auth.admin.getUserById(targetUserId!);
          if (error) {
            cleanupErrors.push(
              new Error(`Could not verify target identity before cleanup: ${error.message}`)
            );
          } else {
            identityStillExists = Boolean(data.user);
          }
        } catch (error) {
          cleanupErrors.push(
            new Error(
              `Could not verify target identity before cleanup: ${error instanceof Error ? error.message : String(error)}`
            )
          );
        }

        if (identityStillExists) {
          await recordCleanup('Profile restoration failed', 1, async () =>
            clients!.admin
              .from('profiles')
              .update({
                username: profileBefore.data!.username,
                display_name: profileBefore.data!.display_name,
                avatar_url: profileBefore.data!.avatar_url,
                bio: profileBefore.data!.bio,
                upi_id: profileBefore.data!.upi_id,
                deleted_at: profileBefore.data!.deleted_at,
              })
              .eq('id', targetUserId!)
              .select('id')
          );

          for (const membership of membershipsBefore.data ?? []) {
            await recordCleanup(`Membership restoration failed (${membership.id})`, 1, async () =>
              clients!.admin
                .from('group_members')
                .update({ removed_at: membership.removed_at })
                .eq('id', membership.id)
                .select('id')
            );
          }
          for (const request of requestsBefore.data ?? []) {
            await recordCleanup(`Friend-request restoration failed (${request.id})`, 1, async () =>
              clients!.admin
                .from('friend_requests')
                .update({ status: request.status, updated_at: request.updated_at })
                .eq('id', request.id)
                .select('id')
            );
          }
          for (const invitation of invitationsBefore.data ?? []) {
            await recordCleanup(`Invitation restoration failed (${invitation.id})`, 1, async () =>
              clients!.admin
                .from('invitation_tokens')
                .update({ revoked_at: invitation.revoked_at })
                .eq('id', invitation.id)
                .select('id')
            );
          }
        }
      }
    }

    if (testError && cleanupErrors.length > 0) {
      const primaryMessage = testError instanceof Error ? testError.message : String(testError);
      const cleanupMessage = cleanupErrors.map((error) => error.message).join('; ');
      throw new Error(
        `Integration test failed (${primaryMessage}) and cleanup was incomplete (${cleanupMessage}).`
      );
    }
    if (testError) throw testError;
    if (cleanupErrors.length > 0) {
      throw new Error(
        `Integration-test cleanup was incomplete: ${cleanupErrors.map((error) => error.message).join('; ')}`
      );
    }
  });
});

if (!securityTestsEnabled) {
  it('keeps disposable database authorization checks opt-in', () => {
    expect(securityTestsEnabled).toBe(false);
  });
}
