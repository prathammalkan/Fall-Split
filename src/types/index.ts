import type { Tables } from './database.types';

// Re-export database row types
export type Profile = Tables<'profiles'>;
export type FriendRequest = Tables<'friend_requests'>;
export type InvitationToken = Tables<'invitation_tokens'>;
export type Group = Tables<'groups'>;
export type GroupMember = Tables<'group_members'>;
export type Expense = Tables<'expenses'>;
export type ExpensePayer = Tables<'expense_payers'>;
export type ExpenseShare = Tables<'expense_shares'>;
export type ExpenseItem = Tables<'expense_items'>;
export type ExpenseItemAllocation = Tables<'expense_item_allocations'>;
export type ExpenseHistory = Tables<'expense_history'>;
export type Settlement = Tables<'settlements'>;
export type Notification = Tables<'notifications'>;
export type NotificationPreference = Tables<'notification_preferences'>;
export type PushSubscription = Tables<'push_subscriptions'>;
export type ActivityLog = Tables<'activity_log'>;

// Enriched types for UI
export interface ProfileWithFriendStatus extends Profile {
  friendStatus?: 'none' | 'pending_sent' | 'pending_received' | 'accepted';
  friendRequestId?: string;
}

export interface ExpenseWithDetails extends Expense {
  payers: (ExpensePayer & { profile: Profile })[];
  shares: (ExpenseShare & { profile: Profile })[];
  items?: (ExpenseItem & { allocations: (ExpenseItemAllocation & { profile: Profile })[] })[];
  creator: Profile;
  group?: Group | null;
}

export interface GroupWithMembers extends Group {
  members: (GroupMember & { profile: Profile })[];
  memberCount: number;
}

export interface SettlementWithProfiles extends Settlement {
  payer: Profile;
  recipient: Profile;
  group?: Group | null;
}

// Financial domain types
// All monetary values stored as paise (integer); 1 INR = 100 paise
export interface Money {
  paise: number; // always integer
  currency: string;
}

// Sign convention:
//   positive → user is owed money
//   negative → user owes money
//   zero → settled
export interface Balance {
  userId: string;
  netPaise: number;
  owedToPaise: number; // sum of what others owe this user
  owingPaise: number; // sum of what this user owes others
}

export interface PairBalance {
  userId: string;
  otherUserId: string;
  netPaise: number; // positive = other owes user, negative = user owes other
  groupId?: string | null;
}

export interface SimplifiedDebt {
  fromUserId: string;
  toUserId: string;
  amountPaise: number; // always positive
  fromProfile?: Profile;
  toProfile?: Profile;
}

// Split input types
export interface SplitParticipant {
  userId: string;
  profile?: Profile;
}

export interface EqualSplitInput {
  method: 'equal';
  totalPaise: number;
  participants: SplitParticipant[];
}

export interface UnequalSplitInput {
  method: 'unequal';
  totalPaise: number;
  assignments: { userId: string; amountPaise: number }[];
}

export interface PercentageSplitInput {
  method: 'percentage';
  totalPaise: number;
  assignments: { userId: string; percentage: number }[];
}

export interface SharesSplitInput {
  method: 'shares';
  totalPaise: number;
  assignments: { userId: string; shares: number }[];
}

export interface ItemizedSplitInput {
  method: 'itemized';
  totalPaise: number;
  items: {
    name: string;
    quantity: number;
    unitPricePaise: number;
    totalPaise: number;
    itemType: string;
    participants: { userId: string; amountPaise: number }[];
  }[];
}

export interface MultiplePayerInput {
  payers: { userId: string; amountPaise: number }[];
}

export type SplitInput =
  | EqualSplitInput
  | UnequalSplitInput
  | PercentageSplitInput
  | SharesSplitInput
  | ItemizedSplitInput;

export interface SplitResult {
  allocations: { userId: string; amountPaise: number }[];
  reconciled: boolean; // sum of allocations === totalPaise
}

// Offline outbox types
export type OutboxOperationType = 'create_expense' | 'update_expense' | 'void_expense';
export type OutboxState = 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict';

export interface OutboxOperation {
  id: string; // UUID, client-generated
  idempotencyKey: string; // Globally unique, prevents duplicate server-side
  type: OutboxOperationType;
  schemaVersion: number; // For future migrations of stored ops
  payload: unknown; // Typed per operation type
  state: OutboxState;
  createdAt: number; // Unix ms
  updatedAt: number;
  retryCount: number;
  lastError?: string;
  serverId?: string; // Set after successful sync
  conflictInfo?: unknown;
}

// Navigation types
export type NavTab = 'home' | 'friends' | 'groups' | 'activity' | 'profile';

// API response types
export interface ApiError {
  message: string;
  code?: string;
  status?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  count: number;
  hasMore: boolean;
  nextCursor?: string;
}
