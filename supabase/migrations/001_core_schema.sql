-- ============================================================
-- Fall Split — Migration 001: Core Schema
-- ============================================================
-- Financial sign convention:
--   positive net_balance  → user is owed money
--   negative net_balance  → user owes money
--   zero                  → settled
-- All monetary amounts stored as INTEGER (paise, 1 INR = 100 paise)
-- Displayed divided by 100 with 2 decimal places.
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── PROFILES ─────────────────────────────────────────────────────────────────
CREATE TABLE public.profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username        TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL,
  avatar_url      TEXT,
  bio             TEXT,
  upi_id          TEXT,                        -- for UPI payment links
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,                 -- soft-delete timestamp

  CONSTRAINT username_format CHECK (
    username ~ '^[a-z0-9_]{3,30}$'
  ),
  CONSTRAINT display_name_length CHECK (
    char_length(display_name) BETWEEN 1 AND 60
  ),
  CONSTRAINT upi_id_format CHECK (
    upi_id IS NULL OR upi_id ~ '^[a-zA-Z0-9._\-]+@[a-zA-Z0-9]+$'
  )
);

CREATE INDEX idx_profiles_username ON public.profiles (username);
CREATE INDEX idx_profiles_deleted_at ON public.profiles (deleted_at) WHERE deleted_at IS NULL;

-- ─── FRIEND REQUESTS & RELATIONSHIPS ──────────────────────────────────────────
CREATE TYPE public.friendship_status AS ENUM (
  'pending',    -- request sent, awaiting response
  'accepted',   -- mutual friends
  'rejected',   -- declined
  'cancelled',  -- withdrawn by requester
  'blocked'     -- blocked (future use)
);

CREATE TABLE public.friend_requests (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status      public.friendship_status NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT no_self_friend CHECK (sender_id <> receiver_id),
  CONSTRAINT unique_friendship UNIQUE (
    LEAST(sender_id, receiver_id),
    GREATEST(sender_id, receiver_id)
  )
);

CREATE INDEX idx_friend_requests_sender   ON public.friend_requests (sender_id);
CREATE INDEX idx_friend_requests_receiver ON public.friend_requests (receiver_id);
CREATE INDEX idx_friend_requests_status   ON public.friend_requests (status);

-- ─── INVITATION TOKENS ────────────────────────────────────────────────────────
CREATE TYPE public.invitation_type AS ENUM ('friend', 'group');

CREATE TABLE public.invitation_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token       TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'base64url'),
  type        public.invitation_type NOT NULL,
  creator_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_id   UUID,                           -- group_id for group invitations
  max_uses    INT NOT NULL DEFAULT 1,
  use_count   INT NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ,

  CONSTRAINT max_uses_positive CHECK (max_uses > 0),
  CONSTRAINT use_count_valid CHECK (use_count >= 0 AND use_count <= max_uses)
);

CREATE INDEX idx_invitation_tokens_token      ON public.invitation_tokens (token);
CREATE INDEX idx_invitation_tokens_creator_id ON public.invitation_tokens (creator_id);

-- ─── GROUPS ───────────────────────────────────────────────────────────────────
CREATE TYPE public.group_type AS ENUM (
  'trip',
  'household',
  'event',
  'custom'
);

CREATE TABLE public.groups (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  description TEXT,
  type        public.group_type NOT NULL DEFAULT 'custom',
  currency    TEXT NOT NULL DEFAULT 'INR',
  creator_id  UUID NOT NULL REFERENCES public.profiles(id),
  archived_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT name_length CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT currency_format CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE INDEX idx_groups_creator_id ON public.groups (creator_id);
CREATE INDEX idx_groups_archived   ON public.groups (archived_at) WHERE archived_at IS NULL;

-- ─── GROUP MEMBERSHIP ─────────────────────────────────────────────────────────
CREATE TYPE public.member_role AS ENUM ('admin', 'member');

CREATE TABLE public.group_members (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id    UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role        public.member_role NOT NULL DEFAULT 'member',
  invited_by  UUID REFERENCES public.profiles(id),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at  TIMESTAMPTZ,

  CONSTRAINT unique_group_member UNIQUE (group_id, user_id)
);

CREATE INDEX idx_group_members_group_id ON public.group_members (group_id);
CREATE INDEX idx_group_members_user_id  ON public.group_members (user_id);
CREATE INDEX idx_group_members_active   ON public.group_members (group_id, user_id)
  WHERE removed_at IS NULL;

-- ─── EXPENSES ─────────────────────────────────────────────────────────────────
CREATE TYPE public.split_method AS ENUM (
  'equal',
  'unequal',
  'percentage',
  'shares',
  'itemized',
  'manual'
);

CREATE TYPE public.expense_status AS ENUM (
  'active',
  'voided',
  'deleted'
);

CREATE TABLE public.expenses (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title           TEXT NOT NULL,
  description     TEXT,
  amount_paise    BIGINT NOT NULL,             -- total in paise (1 INR = 100 paise)
  currency        TEXT NOT NULL DEFAULT 'INR',
  split_method    public.split_method NOT NULL DEFAULT 'equal',
  group_id        UUID REFERENCES public.groups(id),
  creator_id      UUID NOT NULL REFERENCES public.profiles(id),
  expense_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  category        TEXT,
  notes           TEXT,
  receipt_url     TEXT,
  status          public.expense_status NOT NULL DEFAULT 'active',
  idempotency_key TEXT UNIQUE,                -- client-generated, prevents duplicate creation
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_at       TIMESTAMPTZ,
  voided_by       UUID REFERENCES public.profiles(id),
  void_reason     TEXT,

  CONSTRAINT amount_positive CHECK (amount_paise > 0),
  CONSTRAINT currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT title_length CHECK (char_length(title) BETWEEN 1 AND 120),
  CONSTRAINT void_consistency CHECK (
    (status = 'voided') = (voided_at IS NOT NULL)
  )
);

CREATE INDEX idx_expenses_group_id    ON public.expenses (group_id);
CREATE INDEX idx_expenses_creator_id  ON public.expenses (creator_id);
CREATE INDEX idx_expenses_status      ON public.expenses (status);
CREATE INDEX idx_expenses_date        ON public.expenses (expense_date DESC);
CREATE INDEX idx_expenses_idempotency ON public.expenses (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ─── EXPENSE PAYER CONTRIBUTIONS ──────────────────────────────────────────────
-- Who actually paid, and how much (supports multiple payers)
CREATE TABLE public.expense_payers (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_id    UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.profiles(id),
  amount_paise  BIGINT NOT NULL,

  CONSTRAINT amount_positive CHECK (amount_paise > 0),
  CONSTRAINT unique_payer_per_expense UNIQUE (expense_id, user_id)
);

CREATE INDEX idx_expense_payers_expense_id ON public.expense_payers (expense_id);
CREATE INDEX idx_expense_payers_user_id    ON public.expense_payers (user_id);

-- ─── EXPENSE PARTICIPANT SHARES ───────────────────────────────────────────────
-- What each participant owes (their allocated share)
CREATE TABLE public.expense_shares (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_id    UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.profiles(id),
  amount_paise  BIGINT NOT NULL,             -- their share in paise
  share_weight  NUMERIC,                     -- for shares method
  percentage    NUMERIC(5,2),               -- for percentage method

  CONSTRAINT amount_non_negative CHECK (amount_paise >= 0),
  CONSTRAINT unique_share_per_expense UNIQUE (expense_id, user_id),
  CONSTRAINT percentage_valid CHECK (
    percentage IS NULL OR (percentage >= 0 AND percentage <= 100)
  )
);

CREATE INDEX idx_expense_shares_expense_id ON public.expense_shares (expense_id);
CREATE INDEX idx_expense_shares_user_id    ON public.expense_shares (user_id);

-- ─── EXPENSE LINE ITEMS (for itemized splitting) ───────────────────────────────
CREATE TABLE public.expense_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_id    UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  quantity      NUMERIC NOT NULL DEFAULT 1,
  unit_price_paise BIGINT NOT NULL,
  total_paise   BIGINT NOT NULL,
  item_type     TEXT NOT NULL DEFAULT 'item',  -- 'item', 'tax', 'discount', 'tip'
  sort_order    INT NOT NULL DEFAULT 0,

  CONSTRAINT quantity_positive CHECK (quantity > 0),
  CONSTRAINT unit_price_non_negative CHECK (unit_price_paise >= 0),
  CONSTRAINT total_non_negative CHECK (total_paise >= 0),
  CONSTRAINT name_length CHECK (char_length(name) BETWEEN 1 AND 100)
);

CREATE INDEX idx_expense_items_expense_id ON public.expense_items (expense_id);

-- ─── EXPENSE ITEM PARTICIPANT ALLOCATIONS ─────────────────────────────────────
CREATE TABLE public.expense_item_allocations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id       UUID NOT NULL REFERENCES public.expense_items(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.profiles(id),
  amount_paise  BIGINT NOT NULL,

  CONSTRAINT amount_non_negative CHECK (amount_paise >= 0),
  CONSTRAINT unique_item_user UNIQUE (item_id, user_id)
);

CREATE INDEX idx_item_alloc_item_id ON public.expense_item_allocations (item_id);
CREATE INDEX idx_item_alloc_user_id ON public.expense_item_allocations (user_id);

-- ─── EXPENSE AUDIT HISTORY ────────────────────────────────────────────────────
CREATE TABLE public.expense_history (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_id    UUID NOT NULL REFERENCES public.expenses(id),
  changed_by    UUID NOT NULL REFERENCES public.profiles(id),
  change_type   TEXT NOT NULL,               -- 'created', 'edited', 'voided', 'deleted'
  previous_data JSONB,
  new_data      JSONB,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expense_history_expense_id ON public.expense_history (expense_id);

-- ─── SETTLEMENTS ──────────────────────────────────────────────────────────────
CREATE TYPE public.settlement_status AS ENUM (
  'proposed',   -- initiated by payer
  'pending',    -- awaiting recipient confirmation
  'confirmed',  -- both parties confirmed
  'rejected',   -- recipient rejected
  'disputed',   -- under dispute
  'cancelled'   -- cancelled by payer before confirmation
);

CREATE TABLE public.settlements (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payer_id         UUID NOT NULL REFERENCES public.profiles(id),
  recipient_id     UUID NOT NULL REFERENCES public.profiles(id),
  amount_paise     BIGINT NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'INR',
  group_id         UUID REFERENCES public.groups(id),
  status           public.settlement_status NOT NULL DEFAULT 'proposed',
  payment_method   TEXT,                     -- 'upi', 'cash', 'bank_transfer', 'other'
  upi_ref          TEXT,                     -- UPI transaction reference if available
  notes            TEXT,
  idempotency_key  TEXT UNIQUE,
  proposed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at     TIMESTAMPTZ,
  rejected_at      TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT no_self_settlement CHECK (payer_id <> recipient_id),
  CONSTRAINT amount_positive CHECK (amount_paise > 0),
  CONSTRAINT currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT confirmed_consistency CHECK (
    (status = 'confirmed') = (confirmed_at IS NOT NULL)
  )
);

CREATE INDEX idx_settlements_payer_id     ON public.settlements (payer_id);
CREATE INDEX idx_settlements_recipient_id ON public.settlements (recipient_id);
CREATE INDEX idx_settlements_group_id     ON public.settlements (group_id);
CREATE INDEX idx_settlements_status       ON public.settlements (status);

-- ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
CREATE TYPE public.notification_type AS ENUM (
  'friend_request',
  'friend_accepted',
  'expense_added',
  'expense_updated',
  'expense_deleted',
  'settlement_proposed',
  'settlement_confirmed',
  'settlement_rejected',
  'group_invitation',
  'group_member_added',
  'group_member_removed',
  'debt_reminder',
  'balance_summary'
);

CREATE TABLE public.notifications (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type         public.notification_type NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  data         JSONB,                        -- safe non-sensitive metadata
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT title_length CHECK (char_length(title) BETWEEN 1 AND 100),
  CONSTRAINT body_length  CHECK (char_length(body) BETWEEN 1 AND 300)
);

CREATE INDEX idx_notifications_user_id    ON public.notifications (user_id);
CREATE INDEX idx_notifications_read       ON public.notifications (user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_created_at ON public.notifications (created_at DESC);

-- ─── NOTIFICATION PREFERENCES ─────────────────────────────────────────────────
CREATE TABLE public.notification_preferences (
  user_id                 UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  push_enabled            BOOLEAN NOT NULL DEFAULT true,
  email_enabled           BOOLEAN NOT NULL DEFAULT true,
  expense_notifications   BOOLEAN NOT NULL DEFAULT true,
  settlement_notifications BOOLEAN NOT NULL DEFAULT true,
  friend_notifications    BOOLEAN NOT NULL DEFAULT true,
  reminder_enabled        BOOLEAN NOT NULL DEFAULT true,
  reminder_day            SMALLINT NOT NULL DEFAULT 1,  -- ISO weekday (1=Monday)
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT reminder_day_valid CHECK (reminder_day BETWEEN 1 AND 7)
);

-- ─── PUSH SUBSCRIPTIONS ───────────────────────────────────────────────────────
CREATE TABLE public.push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX idx_push_subs_user_id ON public.push_subscriptions (user_id);

-- ─── IDEMPOTENCY RECORDS ──────────────────────────────────────────────────────
-- Server-side idempotency for sync operations
CREATE TABLE public.idempotency_records (
  key         TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  operation   TEXT NOT NULL,
  result_id   UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'
);

CREATE INDEX idx_idempotency_user_id   ON public.idempotency_records (user_id);
CREATE INDEX idx_idempotency_expires   ON public.idempotency_records (expires_at);

-- ─── ACTIVITY LOG ─────────────────────────────────────────────────────────────
CREATE TABLE public.activity_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_id    UUID REFERENCES public.profiles(id),
  entity_type TEXT NOT NULL,   -- 'expense', 'settlement', 'group', 'friend'
  entity_id   UUID,
  action      TEXT NOT NULL,   -- 'created', 'updated', 'deleted', 'confirmed', etc.
  metadata    JSONB,           -- safe, non-sensitive context
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_log_user_id    ON public.activity_log (user_id);
CREATE INDEX idx_activity_log_created_at ON public.activity_log (created_at DESC);
CREATE INDEX idx_activity_log_entity     ON public.activity_log (entity_type, entity_id);

-- ─── UPDATED_AT TRIGGER ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_updated_at_profiles
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_groups
  BEFORE UPDATE ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_expenses
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_settlements
  BEFORE UPDATE ON public.settlements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_friend_requests
  BEFORE UPDATE ON public.friend_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_notification_prefs
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── AUTO-CREATE PROFILE ON SIGNUP ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  base_username TEXT;
  final_username TEXT;
  counter INT := 0;
BEGIN
  -- Generate a unique username from email prefix
  base_username := lower(regexp_replace(
    split_part(NEW.email, '@', 1),
    '[^a-z0-9_]', '', 'g'
  ));

  -- Ensure minimum length
  IF char_length(base_username) < 3 THEN
    base_username := base_username || 'usr';
  END IF;

  -- Truncate to max allowed
  base_username := substring(base_username, 1, 25);

  -- Find unique username
  final_username := base_username;
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = final_username) LOOP
    counter := counter + 1;
    final_username := base_username || counter::TEXT;
  END LOOP;

  INSERT INTO public.profiles (id, username, display_name, avatar_url)
  VALUES (
    NEW.id,
    final_username,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;

  -- Create default notification preferences
  INSERT INTO public.notification_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
