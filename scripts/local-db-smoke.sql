-- Rollback-only smoke tests for the disposable plain PostgreSQL Auth fixture.
-- Run only against fall_split_test on localhost:5432 with psql ON_ERROR_STOP.
BEGIN;

DO $tests$
DECLARE
  user_a UUID := 'a0000000-0000-4000-8000-000000000001';
  user_b UUID := 'a0000000-0000-4000-8000-000000000002';
  v_expense_id UUID;
  retry_id UUID;
  v_itemized_id UUID;
  settlement_id UUID;
  v_group_id UUID;
  v_edit_expense_id UUID;
  v_expected_updated_at TIMESTAMPTZ;
  v_paid_total BIGINT;
  v_share_total BIGINT;
  v_title TEXT;
  v_invitation_token TEXT;
  v_invitation_result JSONB;
  failed BOOLEAN;
  total BIGINT;
  test_key TEXT;
BEGIN
  IF current_database() <> 'fall_split_test'
    OR inet_server_addr() NOT IN ('127.0.0.1'::INET, '::1'::INET)
    OR inet_server_port() <> 5432
    OR current_setting('server_version_num')::INTEGER NOT BETWEEN 170000 AND 179999 THEN
    RAISE EXCEPTION 'Local database smoke test target mismatch';
  END IF;

  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (user_a, 'dbtest-a@local.invalid', '{}'::JSONB),
         (user_b, 'dbtest-b@local.invalid', '{}'::JSONB);

  PERFORM set_config('request.jwt.claim.sub', user_a::TEXT, TRUE);

  v_group_id := public.create_group_with_owner('DB smoke group', 'Rollback-only test', 'custom');
  IF NOT EXISTS (
    SELECT 1 FROM public.groups AS test_group
    WHERE test_group.id = v_group_id AND test_group.creator_id = user_a
  ) OR NOT EXISTS (
    SELECT 1 FROM public.group_members AS member
    WHERE member.group_id = v_group_id AND member.user_id = user_a
      AND member.role = 'admin' AND member.removed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Atomic group creation did not persist the caller as owner/admin';
  END IF;

  failed := FALSE;
  BEGIN
    PERFORM public.create_group_with_owner('   ', NULL, 'custom');
  EXCEPTION WHEN SQLSTATE '22023' THEN failed := TRUE;
  END;
  IF NOT failed OR EXISTS (SELECT 1 FROM public.groups WHERE name = '') THEN
    RAISE EXCEPTION 'Invalid group creation was not rejected atomically';
  END IF;
  RAISE NOTICE 'PASS: group creation atomically assigns caller ownership/admin; invalid input rejected';

  v_invitation_token := repeat('c', 64);
  INSERT INTO public.invitation_tokens (token, type, creator_id, target_id, max_uses, expires_at)
  VALUES (v_invitation_token, 'group', user_a, v_group_id, 1, NOW() + INTERVAL '1 day');
  PERFORM set_config('request.jwt.claim.sub', user_b::TEXT, TRUE);
  v_invitation_result := public.accept_invitation(v_invitation_token);
  IF v_invitation_result ->> 'success' IS DISTINCT FROM 'true'
    OR v_invitation_result ->> 'type' IS DISTINCT FROM 'group'
    OR v_invitation_result ->> 'groupId' IS DISTINCT FROM v_group_id::TEXT
    OR NOT EXISTS (
      SELECT 1 FROM public.group_members AS member
      WHERE member.group_id = v_group_id AND member.user_id = user_b
        AND member.role = 'member' AND member.removed_at IS NULL
        AND member.invited_by = user_a
    )
    OR (SELECT invitation.use_count FROM public.invitation_tokens AS invitation
        WHERE invitation.token = v_invitation_token) <> 1 THEN
    RAISE EXCEPTION 'Valid group invitation was not accepted with the expected membership';
  END IF;
  v_invitation_result := public.accept_invitation(v_invitation_token);
  IF v_invitation_result ->> 'error' IS NULL THEN
    RAISE EXCEPTION 'Duplicate or exhausted group invitation was accepted';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', user_a::TEXT, TRUE);
  v_invitation_result := public.accept_invitation(v_invitation_token);
  IF v_invitation_result ->> 'error' IS NULL THEN
    RAISE EXCEPTION 'Invitation creator was allowed to accept their own invitation';
  END IF;
  RAISE NOTICE 'PASS: group invitation acceptance, membership role, usage limit, duplicate and self-acceptance rejection';

  test_key := 'dbtest-regular-expense-0001';
  v_expense_id := public.create_expense_with_records(
    jsonb_build_object(
      'title', 'DB validation 101 paise', 'amount_paise', 101,
      'currency', 'INR', 'split_method', 'equal', 'group_id', NULL,
      'creator_id', user_a, 'expense_date', '2026-10-22',
      'category', NULL, 'notes', NULL, 'idempotency_key', test_key
    ),
    jsonb_build_array(
      jsonb_build_object('userId', user_a, 'amountPaise', 60),
      jsonb_build_object('userId', user_b, 'amountPaise', 41)
    ),
    jsonb_build_array(
      jsonb_build_object('userId', user_a, 'amountPaise', 50),
      jsonb_build_object('userId', user_b, 'amountPaise', 51)
    )
  );
  SELECT sum(p.amount_paise) INTO total FROM public.expense_payers AS p WHERE p.expense_id = v_expense_id;
  IF total <> 101 THEN RAISE EXCEPTION 'Payer contributions did not reconcile'; END IF;
  SELECT sum(s.amount_paise) INTO total FROM public.expense_shares AS s WHERE s.expense_id = v_expense_id;
  IF total <> 101 THEN RAISE EXCEPTION 'Participant shares did not reconcile'; END IF;

  retry_id := public.create_expense_with_records(
    jsonb_build_object(
      'title', 'DB validation 101 paise', 'amount_paise', 101,
      'currency', 'INR', 'split_method', 'equal', 'group_id', NULL,
      'creator_id', user_a, 'expense_date', '2026-10-22',
      'category', NULL, 'notes', NULL, 'idempotency_key', test_key
    ),
    jsonb_build_array(
      jsonb_build_object('userId', user_a, 'amountPaise', 60),
      jsonb_build_object('userId', user_b, 'amountPaise', 41)
    ),
    jsonb_build_array(
      jsonb_build_object('userId', user_a, 'amountPaise', 50),
      jsonb_build_object('userId', user_b, 'amountPaise', 51)
    )
  );
  IF retry_id <> v_expense_id THEN RAISE EXCEPTION 'Expense retry did not return its original ID'; END IF;
  RAISE NOTICE 'PASS: 101-paise expense, multiple payers, share reconciliation, idempotent retry';

  failed := FALSE;
  BEGIN
    PERFORM public.create_expense_with_records(
      jsonb_build_object(
        'title', 'Conflicting retry', 'amount_paise', 101,
        'currency', 'INR', 'split_method', 'equal', 'group_id', NULL,
        'creator_id', user_a, 'expense_date', '2026-10-22',
        'category', NULL, 'notes', NULL, 'idempotency_key', test_key
      ),
      jsonb_build_array(
        jsonb_build_object('userId', user_a, 'amountPaise', 60),
        jsonb_build_object('userId', user_b, 'amountPaise', 41)
      ),
      jsonb_build_array(
        jsonb_build_object('userId', user_a, 'amountPaise', 50),
        jsonb_build_object('userId', user_b, 'amountPaise', 51)
      )
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'Conflicting idempotency payload was accepted'; END IF;
  RAISE NOTICE 'PASS: conflicting idempotency payload rejected';

  test_key := 'dbtest-invalid-share-0001';
  failed := FALSE;
  BEGIN
    PERFORM public.create_expense_with_records(
      jsonb_build_object(
        'title', 'Invalid share', 'amount_paise', 101,
        'currency', 'INR', 'split_method', 'equal', 'group_id', NULL,
        'creator_id', user_a, 'expense_date', '2026-10-22',
        'category', NULL, 'notes', NULL, 'idempotency_key', test_key
      ),
      jsonb_build_array(jsonb_build_object('userId', user_a, 'amountPaise', 101)),
      jsonb_build_array(jsonb_build_object('userId', user_a, 'amountPaise', 100))
    );
  EXCEPTION WHEN check_violation THEN failed := TRUE;
  END;
  IF NOT failed OR EXISTS (SELECT 1 FROM public.expenses WHERE idempotency_key = test_key) THEN
    RAISE EXCEPTION 'Invalid share was not rejected atomically';
  END IF;
  RAISE NOTICE 'PASS: invalid shares rejected without a partial expense';

  test_key := 'dbtest-expense-edit-0001';
  v_edit_expense_id := public.create_expense_with_records(
    jsonb_build_object(
      'title', 'Before atomic edit', 'amount_paise', 101,
      'currency', 'INR', 'split_method', 'equal', 'group_id', NULL,
      'creator_id', user_a, 'expense_date', '2026-10-22',
      'category', NULL, 'notes', NULL, 'idempotency_key', test_key
    ),
    jsonb_build_array(
      jsonb_build_object('userId', user_a, 'amountPaise', 100),
      jsonb_build_object('userId', user_b, 'amountPaise', 1)
    ),
    jsonb_build_array(
      jsonb_build_object('userId', user_a, 'amountPaise', 50),
      jsonb_build_object('userId', user_b, 'amountPaise', 51)
    )
  );
  SELECT expense.updated_at INTO v_expected_updated_at
  FROM public.expenses AS expense WHERE expense.id = v_edit_expense_id;

  IF public.update_expense_with_records(
    v_edit_expense_id, v_expected_updated_at, 'After atomic edit', 3,
    '2026-10-22', 'updated atomically', 'Other'
  ) <> v_edit_expense_id THEN
    RAISE EXCEPTION 'Expense edit returned a different expense ID';
  END IF;

  SELECT expense.title, expense.updated_at INTO v_title, v_expected_updated_at
  FROM public.expenses AS expense WHERE expense.id = v_edit_expense_id;
  SELECT sum(payer.amount_paise) INTO v_paid_total
  FROM public.expense_payers AS payer WHERE payer.expense_id = v_edit_expense_id;
  SELECT sum(share.amount_paise) INTO v_share_total
  FROM public.expense_shares AS share WHERE share.expense_id = v_edit_expense_id;
  IF v_title <> 'After atomic edit' OR v_paid_total <> 3 OR v_share_total <> 3
    OR EXISTS (
      SELECT 1 FROM public.expense_payers AS payer
      WHERE payer.expense_id = v_edit_expense_id AND payer.amount_paise < 1
    )
    OR (SELECT payer.amount_paise FROM public.expense_payers AS payer
        WHERE payer.expense_id = v_edit_expense_id AND payer.user_id = user_a) <> 2
    OR (SELECT payer.amount_paise FROM public.expense_payers AS payer
        WHERE payer.expense_id = v_edit_expense_id AND payer.user_id = user_b) <> 1
    OR (SELECT share.amount_paise FROM public.expense_shares AS share
        WHERE share.expense_id = v_edit_expense_id AND share.user_id = user_a) <> 2
    OR (SELECT share.amount_paise FROM public.expense_shares AS share
        WHERE share.expense_id = v_edit_expense_id AND share.user_id = user_b) <> 1 THEN
    RAISE EXCEPTION 'Expense edit failed exact paise reconciliation or minimum payer allocation';
  END IF;

  failed := FALSE;
  BEGIN
    PERFORM public.update_expense_with_records(
      v_edit_expense_id, v_expected_updated_at - INTERVAL '1 second',
      'Stale overwrite', 3, '2026-10-22', NULL, NULL
    );
  EXCEPTION WHEN SQLSTATE '40001' THEN failed := TRUE;
  END;
  SELECT expense.title INTO v_title FROM public.expenses AS expense WHERE expense.id = v_edit_expense_id;
  IF NOT failed OR v_title <> 'After atomic edit' THEN
    RAISE EXCEPTION 'Stale expense edit was accepted or changed data';
  END IF;

  failed := FALSE;
  BEGIN
    PERFORM public.update_expense_with_records(
      v_edit_expense_id, v_expected_updated_at,
      'Invalid overwrite', 0, '2026-10-22', NULL, NULL
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN failed := TRUE;
  END;
  SELECT expense.title INTO v_title FROM public.expenses AS expense WHERE expense.id = v_edit_expense_id;
  IF NOT failed OR v_title <> 'After atomic edit' THEN
    RAISE EXCEPTION 'Invalid expense edit was accepted or partially applied';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', user_b::TEXT, TRUE);
  failed := FALSE;
  BEGIN
    PERFORM public.update_expense_with_records(
      v_edit_expense_id, v_expected_updated_at,
      'Unauthorized overwrite', 3, '2026-10-22', NULL, NULL
    );
  EXCEPTION WHEN insufficient_privilege THEN failed := TRUE;
  END;
  SELECT expense.title INTO v_title FROM public.expenses AS expense WHERE expense.id = v_edit_expense_id;
  IF NOT failed OR v_title <> 'After atomic edit' THEN
    RAISE EXCEPTION 'Non-creator was allowed to edit or partially change the expense';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', user_a::TEXT, TRUE);
  RAISE NOTICE 'PASS: atomic equal-split edit, minimum payer paise, share/payer reconciliation, stale/invalid/cross-user rejection';

  -- The schema has no cross-table constraint tying item rows to split_method.
  -- Protect header/payer/share/item reconciliation even if legacy or privileged
  -- writes have left item rows attached to an otherwise equal-split expense.
  INSERT INTO public.expense_items (
    expense_id, name, quantity, unit_price_paise, total_paise, sort_order
  ) VALUES (v_edit_expense_id, 'legacy inconsistent line', 1, 3, 3, 0);
  failed := FALSE;
  BEGIN
    PERFORM public.update_expense_with_records(
      v_edit_expense_id, v_expected_updated_at,
      'Must remain unchanged', 4, '2026-10-22', NULL, NULL
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN failed := TRUE;
  END;
  SELECT expense.title, expense.amount_paise INTO v_title, total
  FROM public.expenses AS expense WHERE expense.id = v_edit_expense_id;
  IF NOT failed OR v_title <> 'After atomic edit' OR total <> 3
    OR (SELECT sum(payer.amount_paise) FROM public.expense_payers AS payer
        WHERE payer.expense_id = v_edit_expense_id) <> 3
    OR (SELECT sum(share.amount_paise) FROM public.expense_shares AS share
        WHERE share.expense_id = v_edit_expense_id) <> 3
    OR (SELECT sum(item.total_paise) FROM public.expense_items AS item
        WHERE item.expense_id = v_edit_expense_id) <> 3 THEN
    RAISE EXCEPTION 'Itemized records were not preserved when an amount edit was rejected';
  END IF;
  RAISE NOTICE 'PASS: amount edits reject itemized records without changing header, payers, shares, or items';
  DELETE FROM public.expense_items AS item WHERE item.expense_id = v_edit_expense_id;

  test_key := 'dbtest-cross-user-spoof-0001';
  PERFORM set_config('request.jwt.claim.sub', user_b::TEXT, TRUE);
  failed := FALSE;
  BEGIN
    PERFORM public.create_expense_with_records(
      jsonb_build_object(
        'title', 'Spoofed creator', 'amount_paise', 1,
        'currency', 'INR', 'split_method', 'equal', 'group_id', NULL,
        'creator_id', user_a, 'expense_date', '2026-10-22',
        'category', NULL, 'notes', NULL, 'idempotency_key', test_key
      ),
      jsonb_build_array(jsonb_build_object('userId', user_b, 'amountPaise', 1)),
      jsonb_build_array(jsonb_build_object('userId', user_b, 'amountPaise', 1))
    );
  EXCEPTION WHEN insufficient_privilege THEN failed := TRUE;
  END;
  IF NOT failed OR EXISTS (SELECT 1 FROM public.expenses WHERE idempotency_key = test_key) THEN
    RAISE EXCEPTION 'Cross-user creator spoof was not rejected';
  END IF;
  RAISE NOTICE 'PASS: cross-user creator spoof rejected';

  PERFORM set_config('request.jwt.claim.sub', user_a::TEXT, TRUE);
  test_key := 'dbtest-itemized-expense-01';
  v_itemized_id := public.create_itemized_expense_with_records(
    jsonb_build_object(
      'title', 'DB validation itemized', 'amount_paise', 300,
      'currency', 'INR', 'split_method', 'itemized', 'group_id', NULL,
      'creator_id', user_a, 'expense_date', '2026-10-22',
      'category', NULL, 'notes', NULL, 'idempotency_key', test_key
    ),
    jsonb_build_array(jsonb_build_object('userId', user_a, 'amountPaise', 300)),
    jsonb_build_array(
      jsonb_build_object('userId', user_a, 'amountPaise', 150),
      jsonb_build_object('userId', user_b, 'amountPaise', 150)
    ),
    jsonb_build_array(
      jsonb_build_object(
        'name', 'Item 1', 'quantity', 1, 'unit_price_paise', 100,
        'total_paise', 100, 'sort_order', 0,
        'allocations', jsonb_build_array(
          jsonb_build_object('userId', user_a, 'amountPaise', 50),
          jsonb_build_object('userId', user_b, 'amountPaise', 50)
        )
      ),
      jsonb_build_object(
        'name', 'Item 2', 'quantity', 1, 'unit_price_paise', 200,
        'total_paise', 200, 'sort_order', 1,
        'allocations', jsonb_build_array(
          jsonb_build_object('userId', user_a, 'amountPaise', 100),
          jsonb_build_object('userId', user_b, 'amountPaise', 100)
        )
      )
    )
  );
  SELECT sum(i.total_paise) INTO total FROM public.expense_items AS i WHERE i.expense_id = v_itemized_id;
  IF total <> 300 THEN RAISE EXCEPTION 'Itemized lines did not reconcile'; END IF;
  RAISE NOTICE 'PASS: itemized expense lines and allocations reconcile at paise precision';

  test_key := 'dbtest-itemized-invalid-01';
  failed := FALSE;
  BEGIN
    PERFORM public.create_itemized_expense_with_records(
      jsonb_build_object(
        'title', 'Invalid itemized', 'amount_paise', 300,
        'currency', 'INR', 'split_method', 'itemized', 'group_id', NULL,
        'creator_id', user_a, 'expense_date', '2026-10-22',
        'category', NULL, 'notes', NULL, 'idempotency_key', test_key
      ),
      jsonb_build_array(jsonb_build_object('userId', user_a, 'amountPaise', 300)),
      jsonb_build_array(
        jsonb_build_object('userId', user_a, 'amountPaise', 150),
        jsonb_build_object('userId', user_b, 'amountPaise', 150)
      ),
      jsonb_build_array(
        jsonb_build_object(
          'name', 'Bad item', 'quantity', 1, 'unit_price_paise', 250,
          'total_paise', 250, 'sort_order', 0,
          'allocations', jsonb_build_array(jsonb_build_object('userId', user_a, 'amountPaise', 250))
        )
      )
    );
  EXCEPTION WHEN check_violation THEN failed := TRUE;
  END;
  IF NOT failed OR EXISTS (SELECT 1 FROM public.expenses WHERE idempotency_key = test_key) THEN
    RAISE EXCEPTION 'Invalid itemized write did not roll back atomically';
  END IF;
  RAISE NOTICE 'PASS: invalid itemized write rolled back with no header';

  INSERT INTO public.friend_requests (sender_id, receiver_id, status)
  VALUES (user_a, user_b, 'accepted');
  PERFORM public.create_expense_with_records(
    jsonb_build_object(
      'title', 'Settlement debt', 'amount_paise', 101,
      'currency', 'INR', 'split_method', 'equal', 'group_id', NULL,
      'creator_id', user_a, 'expense_date', '2026-10-22',
      'category', NULL, 'notes', NULL, 'idempotency_key', 'dbtest-settlement-debt-01'
    ),
    jsonb_build_array(jsonb_build_object('userId', user_a, 'amountPaise', 101)),
    jsonb_build_array(
      jsonb_build_object('userId', user_a, 'amountPaise', 50),
      jsonb_build_object('userId', user_b, 'amountPaise', 51)
    )
  );
  PERFORM set_config('request.jwt.claim.sub', user_b::TEXT, TRUE);
  settlement_id := public.propose_settlement(user_a, 51, 'dbtest-settlement-idem-01');
  IF public.propose_settlement(user_a, 51, 'dbtest-settlement-idem-01') <> settlement_id THEN
    RAISE EXCEPTION 'Settlement retry was not idempotent';
  END IF;
  failed := FALSE;
  BEGIN
    PERFORM public.respond_to_settlement(settlement_id, 'confirm');
  EXCEPTION WHEN insufficient_privilege THEN failed := TRUE;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'Settlement payer was allowed to confirm as recipient'; END IF;
  PERFORM set_config('request.jwt.claim.sub', user_a::TEXT, TRUE);
  PERFORM public.respond_to_settlement(settlement_id, 'confirm');
  IF (SELECT status FROM public.settlements WHERE id = settlement_id) <> 'confirmed' THEN
    RAISE EXCEPTION 'Authorized recipient confirmation failed';
  END IF;
  RAISE NOTICE 'PASS: settlement debt bounds, retry, wrong-party rejection, recipient confirmation';
END;
$tests$;

ROLLBACK;
