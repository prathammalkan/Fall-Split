import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Minus,
  X,
  ChevronDown,
  Calendar,
  Tag,
  StickyNote,
  Users,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, db } from '../../lib/supabase';
import {
  equalSplit,
  unequalSplit,
  percentageSplit,
  sharesSplit,
  itemizedSplit,
  validateMultiplePayers,
} from '../../lib/splits';
import { parseINR, formatINR } from '../../lib/money';
import { PageHeader } from '../../components/layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { SheetDialog } from '../../components/ui/SheetDialog';
import { queueOfflineOperation } from '../../lib/offlineQueue';
import type { Profile, Group } from '../../types';
import { format } from 'date-fns';

type SplitMethod = 'equal' | 'unequal' | 'percentage' | 'shares' | 'itemized';

const SPLIT_METHODS: { value: SplitMethod; label: string }[] = [
  { value: 'equal', label: 'Equal' },
  { value: 'unequal', label: 'Custom' },
  { value: 'percentage', label: 'Percentages' },
  { value: 'shares', label: 'Shares' },
  { value: 'itemized', label: 'By items' },
];

const CATEGORIES = [
  'Food & Drink',
  'Transport',
  'Accommodation',
  'Entertainment',
  'Shopping',
  'Utilities',
  'Healthcare',
  'Travel',
  'Other',
];

interface Participant {
  userId: string;
  profile: Profile;
  amountPaise?: number;
  percentage?: number;
  shares?: number;
}

interface LineItem {
  id: string;
  name: string;
  quantity: number;
  unitPriceStr: string;
  participants: { userId: string; amountPaise: number }[];
}

interface FriendRequestRow {
  sender_id: string;
  receiver_id: string;
}

export function AddExpensePage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const groupIdParam = searchParams.get('groupId');
  const friendIdParam = searchParams.get('friendId');

  const [step, setStep] = useState<'basic' | 'split'>('basic');
  const [splitMethod, setSplitMethod] = useState<SplitMethod>('equal');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [payers, setPayers] = useState<{ userId: string; profile: Profile; amountStr: string }[]>(
    []
  );
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { id: crypto.randomUUID(), name: '', quantity: 1, unitPriceStr: '', participants: [] },
  ]);
  const [availableProfiles, setAvailableProfiles] = useState<Profile[]>([]);
  const [_group, setGroup] = useState<Group | null>(null);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amountStr, setAmountStr] = useState('');
  const [title, setTitle] = useState('');
  const [expenseDate, setExpenseDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const submissionKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const [submissionSuccess, setSubmissionSuccess] = useState<{
    id: string;
    title: string;
    totalPaise: number;
    userSharePaise: number;
    isPendingApproval: boolean;
  } | null>(null);

  const totalPaise = parseINR(amountStr) ?? 0;

  const loadContacts = useCallback(async () => {
    if (!user || !profile) {
      setContactsLoading(false);
      setContactsError(
        user
          ? 'Your profile could not be loaded. Refresh the page or try again.'
          : 'Sign in before adding an expense.'
      );
      return;
    }
    setContactsLoading(true);
    setContactsError(null);
    try {
      let profiles: Profile[] = [profile];

      if (groupIdParam) {
        const [groupResult, memberResult] = await Promise.all([
          supabase.from('groups').select('*').eq('id', groupIdParam).single(),
          supabase
            .from('group_members')
            .select(
              'user_id, profiles!group_members_user_id_fkey (id, username, display_name, avatar_url)'
            )
            .eq('group_id', groupIdParam)
            .is('removed_at', null),
        ]);
        const groupData = groupResult.data as unknown as Group | null;
        const memberData = memberResult.data as unknown as Array<{ profiles: Profile }> | null;
        if (groupResult.error || memberResult.error || !groupData) {
          throw new Error('Group members could not be loaded. Check access and try again.');
        }
        setGroup(groupData);
        const members = memberData ?? [];
        profiles = members.map((m) => m.profiles).filter(Boolean);
      } else {
        const { data: requestsRaw, error: requestsError } = await supabase
          .from('friend_requests')
          .select('sender_id, receiver_id')
          .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
          .eq('status', 'accepted');
        if (requestsError) throw new Error('Friends could not be loaded. Please try again.');
        const requests = (requestsRaw ?? []) as unknown as FriendRequestRow[];
        const friendIds = requests.map((r) =>
          r.sender_id === user.id ? r.receiver_id : r.sender_id
        );
        const allIds =
          friendIdParam && !friendIds.includes(friendIdParam)
            ? [...friendIds, friendIdParam]
            : friendIds;

        if (allIds.length > 0) {
          const { data, error: profileError } = await supabase
            .from('discoverable_profiles')
            .select('id, username, display_name, avatar_url')
            .in('id', allIds);
          if (profileError)
            throw new Error('Participant profiles could not be loaded. Please try again.');
          profiles = [profile, ...((data ?? []) as unknown as Profile[])];
        }
      }

      setAvailableProfiles(profiles);
      setParticipants(profiles.map((p) => ({ userId: p.id, profile: p })));
      if (!groupIdParam && friendIdParam) {
        const friendProf = profiles.find((p) => p.id === friendIdParam);
        if (friendProf) {
          setParticipants([
            { userId: user.id, profile },
            { userId: friendProf.id, profile: friendProf },
          ]);
        } else {
          setParticipants(profiles.map((p) => ({ userId: p.id, profile: p })));
        }
      }
      setPayers([{ userId: user.id, profile, amountStr: '' }]);
    } catch (loadError) {
      setGroup(null);
      setAvailableProfiles([]);
      setParticipants([]);
      setPayers([]);
      setContactsError(
        loadError instanceof Error
          ? loadError.message
          : 'Participants could not be loaded. Please try again.'
      );
    } finally {
      setContactsLoading(false);
    }
  }, [user, profile, groupIdParam, friendIdParam]);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  const toggleParticipant = (p: Profile) => {
    setParticipants((prev) =>
      prev.some((x) => x.userId === p.id)
        ? prev.filter((x) => x.userId !== p.id)
        : [...prev, { userId: p.id, profile: p }]
    );
  };

  const togglePayer = (p: Profile) => {
    setPayers((prev) =>
      prev.some((x) => x.userId === p.id)
        ? prev.filter((x) => x.userId !== p.id)
        : [...prev, { userId: p.id, profile: p, amountStr: '' }]
    );
  };

  const distributeItemAmount = (item: LineItem, userIds: string[]) => {
    const total = Math.round((parseINR(item.unitPriceStr) ?? 0) * item.quantity);
    return total > 0 && userIds.length > 0
      ? equalSplit(total, userIds).allocations
      : userIds.map((userId) => ({ userId, amountPaise: 0 }));
  };

  const updateLineItem = (
    itemId: string,
    changes: Partial<Pick<LineItem, 'name' | 'quantity' | 'unitPriceStr'>>
  ) => {
    setLineItems((previous) =>
      previous.map((item) => {
        if (item.id !== itemId) return item;
        const updated = { ...item, ...changes };
        if (!('quantity' in changes) && !('unitPriceStr' in changes)) return updated;
        return {
          ...updated,
          participants: distributeItemAmount(
            updated,
            item.participants.map((participant) => participant.userId)
          ),
        };
      })
    );
  };

  const toggleLineItemParticipant = (itemId: string, userId: string) => {
    setLineItems((previous) =>
      previous.map((item) => {
        if (item.id !== itemId) return item;
        const currentIds = item.participants.map((participant) => participant.userId);
        const nextIds = currentIds.includes(userId)
          ? currentIds.filter((currentId) => currentId !== userId)
          : [...currentIds, userId];
        return { ...item, participants: distributeItemAmount(item, nextIds) };
      })
    );
  };

  const updateLineItemAllocation = (itemId: string, userId: string, amountPaise: number) => {
    setLineItems((previous) =>
      previous.map((item) =>
        item.id === itemId
          ? {
              ...item,
              participants: item.participants.map((participant) =>
                participant.userId === userId ? { ...participant, amountPaise } : participant
              ),
            }
          : item
      )
    );
  };

  const computeAllocations = (): { userId: string; amountPaise: number }[] | null => {
    if (totalPaise <= 0 || participants.length === 0) return null;
    try {
      const ids = participants.map((p) => p.userId);
      switch (splitMethod) {
        case 'equal':
          return equalSplit(totalPaise, ids).allocations;
        case 'unequal': {
          const assignments = participants.map((p) => ({
            userId: p.userId,
            amountPaise: p.amountPaise ?? 0,
          }));
          return unequalSplit(totalPaise, assignments).allocations;
        }
        case 'percentage': {
          const assignments = participants.map((p) => ({
            userId: p.userId,
            percentage: p.percentage ?? 0,
          }));
          return percentageSplit(totalPaise, assignments).allocations;
        }
        case 'shares': {
          const assignments = participants.map((p) => ({
            userId: p.userId,
            shares: p.shares ?? 1,
          }));
          return sharesSplit(totalPaise, assignments).allocations;
        }
        case 'itemized': {
          const items = [];
          for (const item of lineItems) {
            const unitPricePaise = parseINR(item.unitPriceStr);
            if (
              !item.name.trim() ||
              unitPricePaise === null ||
              !Number.isFinite(item.quantity) ||
              item.quantity <= 0
            ) {
              return null;
            }
            items.push({
              name: item.name.trim(),
              totalPaise: Math.round(unitPricePaise * item.quantity),
              participants: item.participants,
            });
          }
          return itemizedSplit(totalPaise, items).allocations;
        }
      }
    } catch {
      return null;
    }
  };

  const validatePayers = (): { userId: string; amountPaise: number }[] | null => {
    if (payers.length === 1) {
      return [{ userId: payers[0]!.userId, amountPaise: totalPaise }];
    }
    try {
      const payerAmounts = payers.map((p) => ({
        userId: p.userId,
        amountPaise: parseINR(p.amountStr) ?? 0,
      }));
      validateMultiplePayers(totalPaise, payerAmounts);
      return payerAmounts;
    } catch {
      return null;
    }
  };

  const handleSave = async () => {
    if (!user || contactsLoading || contactsError) return;
    setError(null);
    if (!title.trim()) {
      setError('Please enter a title.');
      return;
    }
    if (totalPaise <= 0) {
      setError('Please enter a valid amount.');
      return;
    }
    if (participants.length === 0) {
      setError('Select at least one participant.');
      return;
    }

    const allocations = computeAllocations();
    if (!allocations) {
      setError('Could not compute split. Check your inputs.');
      return;
    }

    const payerAmounts = validatePayers();
    if (!payerAmounts) {
      setError('Payer contributions do not add up to the expense total.');
      return;
    }

    const expenseShares = allocations.map((allocation) => ({
      ...allocation,
      percentage:
        splitMethod === 'percentage'
          ? (participants.find((participant) => participant.userId === allocation.userId)
              ?.percentage ?? null)
          : null,
      shareWeight:
        splitMethod === 'shares'
          ? (participants.find((participant) => participant.userId === allocation.userId)?.shares ??
            null)
          : null,
    }));
    const expenseInput = {
      title: title.trim(),
      amount_paise: totalPaise,
      currency: 'INR',
      split_method: splitMethod,
      group_id: groupIdParam,
      creator_id: user.id,
      expense_date: expenseDate,
      category: category || null,
      notes: notes || null,
    };
    const itemizedItems =
      splitMethod === 'itemized'
        ? lineItems.map((item, sort_order) => {
            const unitPricePaise = parseINR(item.unitPriceStr) ?? 0;
            return {
              name: item.name.trim(),
              quantity: item.quantity,
              unit_price_paise: unitPricePaise,
              total_paise: Math.round(unitPricePaise * item.quantity),
              sort_order,
              allocations: item.participants,
            };
          })
        : [];
    const fingerprint = JSON.stringify({
      expenseInput,
      payers: payerAmounts,
      shares: expenseShares,
      items: itemizedItems,
    });
    if (submissionKey.current?.fingerprint !== fingerprint) {
      submissionKey.current = {
        fingerprint,
        key: `exp-${user.id}-${Date.now()}-${crypto.randomUUID()}`,
      };
    }
    const idempotencyKey = submissionKey.current.key;

    setSaving(true);

    try {
      if (!navigator.onLine) {
        await queueOfflineOperation({
          type: 'create_expense',
          payload: {
            ...expenseInput,
            idempotency_key: idempotencyKey,
            payers: payerAmounts,
            shares: expenseShares,
            items: itemizedItems,
          },
          idempotencyKey,
        });
        navigate(-1);
        return;
      }

      const rpcName =
        splitMethod === 'itemized'
          ? 'create_itemized_expense_with_records'
          : 'create_expense_with_records';
      const rpcArgs = {
        p_expense: { ...expenseInput, idempotency_key: idempotencyKey },
        p_payers: payerAmounts,
        p_shares: expenseShares,
        ...(splitMethod === 'itemized' ? { p_items: itemizedItems } : {}),
      };
      const { data: expenseId, error: expError } = await db.rpc(rpcName, rpcArgs);

      if (expError || typeof expenseId !== 'string' || !expenseId) {
        setError(
          expError?.message ?? 'Expense was not confirmed as fully persisted. Please retry.'
        );
        return;
      }

      const userShare = allocations?.find((a) => a.userId === user.id)?.amountPaise ?? 0;
      const otherParticipants = participants.filter((p) => p.userId !== user.id);

      setSubmissionSuccess({
        id: expenseId,
        title: title.trim(),
        totalPaise,
        userSharePaise: userShare,
        isPendingApproval: otherParticipants.length > 0,
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : 'Expense could not be saved. Please retry.'
      );
    } finally {
      setSaving(false);
    }
  };

  const allocations = computeAllocations();
  const allocationSum = allocations?.reduce((a, b) => a + b.amountPaise, 0) ?? 0;
  const reconciled = allocations !== null && allocationSum === totalPaise;

  if (submissionSuccess) {
    return (
      <SheetDialog title="Expense submitted" onClose={() => navigate('/', { replace: true })}>
        <div className="p-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[rgb(var(--color-primary)/0.12)] text-[rgb(var(--color-primary))]">
            <CheckCircle2 size={32} />
          </div>
          <h2 className="text-primary text-xl font-bold">Expense submitted</h2>
          <p className="text-secondary mt-2 text-base font-semibold">
            {submissionSuccess.title} — {formatINR(submissionSuccess.totalPaise)}
          </p>
          <p className="text-muted mt-1 text-sm">
            Your share — {formatINR(submissionSuccess.userSharePaise)}
          </p>
          <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[rgb(var(--color-pending)/0.15)] px-3 py-1 text-xs font-medium text-[rgb(var(--color-pending))]">
            Status — {submissionSuccess.isPendingApproval ? 'Pending Approval' : 'Confirmed'}
          </div>
          <p className="text-secondary mt-3 text-sm">
            {submissionSuccess.isPendingApproval
              ? 'Waiting for the other required participants to approve.'
              : 'All required participants have approved this expense.'}
          </p>
          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => navigate(`/expenses/${submissionSuccess.id}`, { replace: true })}
              className="btn-primary w-full px-6 py-2.5 text-sm font-medium sm:w-auto"
            >
              View Expense
            </button>
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="btn-secondary w-full px-6 py-2.5 text-sm font-medium sm:w-auto"
            >
              Done
            </button>
          </div>
        </div>
      </SheetDialog>
    );
  }

  if (step === 'basic') {
    return (
      <SheetDialog title="Add expense" onClose={() => navigate(-1)}>
        <div>
          <PageHeader title="Add expense" back />
          <div className="page-content space-y-5 pt-4">
            {contactsError && (
              <ErrorMessage message={contactsError} retry={() => void loadContacts()} />
            )}
            <div>
              <label className="text-muted mb-1 block text-xs">Amount</label>
              <div className="relative">
                <span className="text-secondary absolute top-1/2 left-3 -translate-y-1/2 text-xl font-semibold">
                  ₹
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  className="input h-14 pl-8 text-2xl font-bold"
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                />
              </div>
            </div>

            <div>
              <label className="text-muted mb-1 block text-xs">What's it for?</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input"
                placeholder="Dinner, taxi, groceries…"
                maxLength={120}
              />
            </div>

            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-muted flex items-center gap-2 text-sm"
            >
              <ChevronDown
                size={16}
                className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
              />
              {showAdvanced ? 'Less options' : 'Date, category, notes'}
            </button>

            {showAdvanced && (
              <div className="space-y-4">
                <div>
                  <label className="text-muted mb-1 block text-xs">
                    <Calendar size={12} className="mr-1 inline" />
                    Date
                  </label>
                  <input
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="input"
                  />
                </div>
                <div>
                  <label className="text-muted mb-1 block text-xs">
                    <Tag size={12} className="mr-1 inline" />
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="input"
                  >
                    <option value="">No category</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-muted mb-1 block text-xs">
                    <StickyNote size={12} className="mr-1 inline" />
                    Notes
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="input"
                    rows={2}
                    placeholder="Optional"
                    maxLength={500}
                  />
                </div>
              </div>
            )}

            <div>
              <label className="text-muted mb-2 block text-xs">
                <Users size={12} className="mr-1 inline" />
                Participants
              </label>
              <div className="flex flex-wrap gap-2">
                {availableProfiles.map((p) => {
                  const selected = participants.some((x) => x.userId === p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => toggleParticipant(p)}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors ${selected ? 'bg-[rgb(var(--color-accent))] text-white' : 'bg-tertiary text-secondary'}`}
                    >
                      <Avatar src={p.avatar_url} name={p.display_name} size={20} />
                      {p.display_name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-muted mb-2 block text-xs">Paid by</label>
              <div className="flex flex-wrap gap-2">
                {availableProfiles.map((p) => {
                  const selected = payers.some((x) => x.userId === p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => togglePayer(p)}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors ${selected ? 'bg-[rgb(var(--color-positive)/0.9)] text-white' : 'bg-tertiary text-secondary'}`}
                    >
                      <Avatar src={p.avatar_url} name={p.display_name} size={20} />
                      {p.display_name}
                    </button>
                  );
                })}
              </div>
              {payers.length > 1 && (
                <div className="mt-3 space-y-2">
                  <p className="text-muted text-xs">
                    Enter each payer's contribution (must total {formatINR(totalPaise)}):
                  </p>
                  {payers.map((payer) => (
                    <div key={payer.userId} className="flex items-center gap-2">
                      <Avatar
                        src={payer.profile.avatar_url}
                        name={payer.profile.display_name}
                        size={28}
                      />
                      <span className="text-primary flex-1 text-sm">
                        {payer.profile.display_name}
                      </span>
                      <div className="relative w-28">
                        <span className="text-muted absolute top-1/2 left-2 -translate-y-1/2 text-sm">
                          ₹
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          value={payer.amountStr}
                          onChange={(e) =>
                            setPayers((prev) =>
                              prev.map((p) =>
                                p.userId === payer.userId ? { ...p, amountStr: e.target.value } : p
                              )
                            )
                          }
                          className="input pl-6 text-sm"
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {error && <ErrorMessage message={error} />}

            <button
              onClick={() => {
                if (contactsLoading || contactsError) return;
                if (!title.trim() || totalPaise <= 0) {
                  setError('Enter an amount and description.');
                  return;
                }
                setError(null);
                setStep('split');
              }}
              className="btn-primary w-full"
              disabled={contactsLoading || !!contactsError}
            >
              Next: Split
            </button>
          </div>
        </div>
      </SheetDialog>
    );
  }

  return (
    <SheetDialog title="Split method" onClose={() => navigate(-1)}>
      <div>
        <PageHeader title="Split method" back={() => setStep('basic')} />
        <div className="page-content space-y-4 pt-4">
          {contactsError && (
            <ErrorMessage message={contactsError} retry={() => void loadContacts()} />
          )}
          <div className="card text-center">
            <p className="text-primary text-2xl font-bold">{formatINR(totalPaise)}</p>
            <p className="text-muted text-sm">{title}</p>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {SPLIT_METHODS.map((m) => (
              <button
                key={m.value}
                onClick={() => setSplitMethod(m.value)}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${splitMethod === m.value ? 'bg-[rgb(var(--color-accent))] text-white' : 'bg-tertiary text-secondary'}`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {splitMethod === 'unequal' && (
            <div className="space-y-2">
              {participants.map((p) => (
                <div key={p.userId} className="flex items-center gap-2">
                  <Avatar src={p.profile.avatar_url} name={p.profile.display_name} size={28} />
                  <span className="text-primary flex-1 text-sm">{p.profile.display_name}</span>
                  <div className="relative w-28">
                    <span className="text-muted absolute top-1/2 left-2 -translate-y-1/2 text-sm">
                      ₹
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={p.amountPaise !== undefined ? (p.amountPaise / 100).toFixed(2) : ''}
                      onChange={(e) => {
                        const paise = Math.round(parseFloat(e.target.value || '0') * 100);
                        setParticipants((prev) =>
                          prev.map((x) =>
                            x.userId === p.userId ? { ...x, amountPaise: paise } : x
                          )
                        );
                      }}
                      className="input pl-6 text-sm"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              ))}
              <p
                className={`text-right text-xs ${allocationSum === totalPaise ? 'text-[rgb(var(--color-positive))]' : 'text-[rgb(var(--color-negative))]'}`}
              >
                {formatINR(allocationSum)} of {formatINR(totalPaise)}
              </p>
            </div>
          )}

          {splitMethod === 'percentage' && (
            <div className="space-y-2">
              {participants.map((p) => (
                <div key={p.userId} className="flex items-center gap-2">
                  <Avatar src={p.profile.avatar_url} name={p.profile.display_name} size={28} />
                  <span className="text-primary flex-1 text-sm">{p.profile.display_name}</span>
                  <div className="relative w-24">
                    <input
                      type="number"
                      inputMode="decimal"
                      value={p.percentage ?? ''}
                      onChange={(e) =>
                        setParticipants((prev) =>
                          prev.map((x) =>
                            x.userId === p.userId
                              ? { ...x, percentage: parseFloat(e.target.value) }
                              : x
                          )
                        )
                      }
                      className="input pr-6 text-sm"
                      placeholder="0"
                      max="100"
                      min="0"
                    />
                    <span className="text-muted absolute top-1/2 right-2 -translate-y-1/2 text-sm">
                      %
                    </span>
                  </div>
                </div>
              ))}
              <p
                className={`text-right text-xs ${Math.abs(participants.reduce((a, p) => a + (p.percentage ?? 0), 0) - 100) < 0.01 ? 'text-[rgb(var(--color-positive))]' : 'text-[rgb(var(--color-negative))]'}`}
              >
                {participants.reduce((a, p) => a + (p.percentage ?? 0), 0).toFixed(1)}% of 100%
              </p>
            </div>
          )}

          {splitMethod === 'shares' && (
            <div className="space-y-2">
              {participants.map((p) => (
                <div key={p.userId} className="flex items-center gap-2">
                  <Avatar src={p.profile.avatar_url} name={p.profile.display_name} size={28} />
                  <span className="text-primary flex-1 text-sm">{p.profile.display_name}</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() =>
                        setParticipants((prev) =>
                          prev.map((x) =>
                            x.userId === p.userId
                              ? { ...x, shares: Math.max(0.5, (x.shares ?? 1) - 0.5) }
                              : x
                          )
                        )
                      }
                      className="bg-tertiary text-secondary flex h-8 w-8 items-center justify-center rounded-full"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="text-primary w-8 text-center text-sm font-semibold">
                      {p.shares ?? 1}
                    </span>
                    <button
                      onClick={() =>
                        setParticipants((prev) =>
                          prev.map((x) =>
                            x.userId === p.userId ? { ...x, shares: (x.shares ?? 1) + 0.5 } : x
                          )
                        )
                      }
                      className="bg-tertiary text-secondary flex h-8 w-8 items-center justify-center rounded-full"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {splitMethod === 'itemized' && (
            <div className="space-y-3">
              {lineItems.map((item, idx) => (
                <div key={item.id} className="card space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={item.name}
                      onChange={(e) => updateLineItem(item.id, { name: e.target.value })}
                      className="input flex-1 text-sm"
                      placeholder={`Item ${idx + 1}`}
                    />
                    <button
                      onClick={() => setLineItems((prev) => prev.filter((x) => x.id !== item.id))}
                      className="text-muted"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-muted mb-1 text-xs">Unit price (₹)</p>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={item.unitPriceStr}
                        onChange={(e) => updateLineItem(item.id, { unitPriceStr: e.target.value })}
                        className="input text-sm"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <p className="text-muted mb-1 text-xs">Qty</p>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={item.quantity}
                        onChange={(e) =>
                          updateLineItem(item.id, { quantity: parseFloat(e.target.value) || 1 })
                        }
                        className="input text-sm"
                        min="1"
                      />
                    </div>
                  </div>
                  <div>
                    <p className="text-muted mb-1 text-xs">Split this item with</p>
                    <div className="space-y-1">
                      {participants.map((participant) => {
                        const allocation = item.participants.find(
                          (entry) => entry.userId === participant.userId
                        );
                        return (
                          <div key={participant.userId} className="flex items-center gap-2">
                            <label className="text-primary flex flex-1 items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={Boolean(allocation)}
                                onChange={() =>
                                  toggleLineItemParticipant(item.id, participant.userId)
                                }
                              />
                              {participant.profile.display_name}
                            </label>
                            {allocation && (
                              <input
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="0.01"
                                aria-label={`${participant.profile.display_name} share for ${item.name || `item ${idx + 1}`}`}
                                value={(allocation.amountPaise / 100).toFixed(2)}
                                onChange={(event) =>
                                  updateLineItemAllocation(
                                    item.id,
                                    participant.userId,
                                    parseINR(event.target.value) ?? 0
                                  )
                                }
                                className="input w-28 text-sm"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-muted mt-1 text-right text-xs">
                      {formatINR(
                        item.participants.reduce(
                          (sum, participant) => sum + participant.amountPaise,
                          0
                        )
                      )}
                      {' / '}
                      {formatINR(Math.round((parseINR(item.unitPriceStr) ?? 0) * item.quantity))}
                    </p>
                  </div>
                </div>
              ))}
              <button
                onClick={() =>
                  setLineItems((prev) => [
                    ...prev,
                    {
                      id: crypto.randomUUID(),
                      name: '',
                      quantity: 1,
                      unitPriceStr: '',
                      participants: [],
                    },
                  ])
                }
                className="btn-secondary w-full text-sm"
              >
                <Plus size={14} /> Add item
              </button>
            </div>
          )}

          {allocations && (
            <div>
              <p className="section-title mb-2">Split preview</p>
              <div className="card overflow-hidden p-0">
                {allocations.map((a) => {
                  const pp = participants.find((p) => p.userId === a.userId)?.profile;
                  return (
                    <div
                      key={a.userId}
                      className="border-app flex items-center gap-3 border-b px-4 py-2.5 last:border-0"
                    >
                      <Avatar src={pp?.avatar_url} name={pp?.display_name ?? a.userId} size={28} />
                      <span className="text-primary flex-1 text-sm">{pp?.display_name}</span>
                      <span className="text-primary text-sm font-semibold tabular-nums">
                        {formatINR(a.amountPaise)}
                      </span>
                    </div>
                  );
                })}
              </div>
              {reconciled && (
                <p className="mt-1 text-right text-xs text-[rgb(var(--color-positive))]">
                  ✓ Sums to {formatINR(totalPaise)}
                </p>
              )}
            </div>
          )}

          {error && <ErrorMessage message={error} />}

          <button
            onClick={() => void handleSave()}
            className="btn-primary w-full"
            disabled={saving || contactsLoading || !!contactsError || !reconciled}
          >
            {saving ? <Spinner size={18} /> : null}
            Save expense
          </button>
        </div>
      </div>
    </SheetDialog>
  );
}
