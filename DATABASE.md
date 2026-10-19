# Fall Split — Database Reference

## Overview

Fall Split uses **Supabase PostgreSQL**. All tables have **Row Level Security (RLS)** enabled. Users only access data they are authorized to see.

## Schema

### `profiles`

User profile data. One row per authenticated user.

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` | References `auth.users.id` |
| `username` | `text` | Unique, lowercase, 3–30 chars |
| `display_name` | `text` | Up to 60 chars |
| `avatar_url` | `text?` | Public URL |
| `bio` | `text?` | Up to 160 chars |
| `upi_id` | `text?` | For payment reminders |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

### `friend_requests`

Friendship relationships and requests.

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` | PK |
| `sender_id` | `uuid` | References `profiles.id` |
| `receiver_id` | `uuid` | References `profiles.id` |
| `status` | `enum` | `pending` \| `accepted` \| `rejected` \| `cancelled` \| `blocked` |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

### `groups`

Expense groups.

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` | PK |
| `name` | `text` | Up to 80 chars |
| `description` | `text?` | |
| `type` | `enum` | `trip` \| `household` \| `event` \| `custom` |
| `currency` | `text` | Default `INR` |
| `creator_id` | `uuid` | References `profiles.id` |
| `archived_at` | `timestamptz?` | |

### `group_members`

| Column | Type | Description |
|---|---|---|
| `group_id` | `uuid` | |
| `user_id` | `uuid` | |
| `role` | `enum` | `admin` \| `member` |
| `invited_by` | `uuid?` | |
| `joined_at` | `timestamptz` | |
| `removed_at` | `timestamptz?` | Soft delete |

### `expenses`

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` | PK |
| `title` | `text` | |
| `amount_paise` | `integer` | **Always in paise (integer). Never rupees float.** |
| `currency` | `text` | Default `INR` |
| `split_method` | `enum` | `equal` \| `unequal` \| `percentage` \| `shares` \| `itemized` \| `manual` |
| `group_id` | `uuid?` | `null` for friend-to-friend |
| `creator_id` | `uuid` | |
| `expense_date` | `date` | |
| `status` | `enum` | `active` \| `voided` \| `deleted` |
| `idempotency_key` | `text?` | Prevents duplicate submissions |
| `voided_at` | `timestamptz?` | |
| `voided_by` | `uuid?` | |

### `expense_payers`

Who paid how much for an expense (supports multiple payers).

| Column | Type | Description |
|---|---|---|
| `expense_id` | `uuid` | |
| `user_id` | `uuid` | |
| `amount_paise` | `integer` | |

Invariant: `SUM(amount_paise) = expenses.amount_paise`

### `expense_shares`

How much each participant owes for an expense.

| Column | Type | Description |
|---|---|---|
| `expense_id` | `uuid` | |
| `user_id` | `uuid` | |
| `amount_paise` | `integer` | |
| `share_weight` | `numeric?` | For shares split method |
| `percentage` | `numeric?` | For percentage split method |

Invariant: `SUM(amount_paise) = expenses.amount_paise`

### `settlements`

Payment settlements between users.

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` | PK |
| `payer_id` | `uuid` | Who pays |
| `recipient_id` | `uuid` | Who receives |
| `amount_paise` | `integer` | |
| `status` | `enum` | `proposed` \| `pending` \| `confirmed` \| `rejected` \| `disputed` \| `cancelled` |
| `payment_method` | `text?` | e.g. `upi` |
| `upi_ref` | `text?` | UPI transaction reference |
| `confirmed_at` | `timestamptz?` | Set when recipient confirms |

**Settlement lifecycle:**
```
proposed → pending → confirmed
 ↓
 rejected / cancelled
```

Only `confirmed` settlements affect balance calculations.

### `notifications`

| Column | Type | Description |
|---|---|---|
| `user_id` | `uuid` | |
| `type` | `enum` | e.g. `friend_request`, `expense_added`, `settlement_proposed`, ... |
| `title` | `text` | |
| `body` | `text` | |
| `data` | `jsonb?` | Structured metadata |
| `read_at` | `timestamptz?` | `null` = unread |

### `invitation_tokens`

| Column | Type | Description |
|---|---|---|
| `token` | `text` | Unique, random, URL-safe. Never contains private data. |
| `type` | `enum` | `friend` \| `group` |
| `creator_id` | `uuid` | |
| `target_id` | `uuid?` | Group ID for group invitations |
| `max_uses` | `integer` | Default 1 |
| `use_count` | `integer` | |
| `expires_at` | `timestamptz?` | |
| `revoked_at` | `timestamptz?` | |

## Financial Invariants

These invariants must hold at all times:

1. `SUM(expense_payers.amount_paise) = expenses.amount_paise` for every active expense.
2. `SUM(expense_shares.amount_paise) = expenses.amount_paise` for every active expense.
3. `SUM(expense_items.total_paise) = expenses.amount_paise` for itemized expenses.
4. All `amount_paise` values are non-negative integers.
5. Balances are derived from ledger records — never stored independently.

## Server-side Functions

### `accept_invitation(p_token TEXT) → JSONB`

Securely accepts a friend or group invitation token. Runs with `SECURITY DEFINER` to enforce atomicity and prevent race conditions.

### `get_friend_balances() → TABLE`

Returns net paise balances between the calling user and all their connections, computed from expense shares and confirmed settlements.

## Migrations

| File | Description |
|---|---|
| `001_core_schema.sql` | All tables, indexes, triggers |
| `002_rls_policies.sql` | Row Level Security policies |
| `003_functions.sql` | Server-side RPCs |

Run migrations in order. They are idempotent (`CREATE OR REPLACE`, `IF NOT EXISTS`).
