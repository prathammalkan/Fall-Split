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
