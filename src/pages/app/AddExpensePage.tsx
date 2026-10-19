import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Minus, X, ChevronDown, Calendar, Tag, StickyNote, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, db } from '../../lib/supabase';
import { equalSplit, unequalSplit, percentageSplit, sharesSplit, itemizedSplit, validateMultiplePayers } from '../../lib/splits';
import { parseINR, formatINR } from '../../lib/money';
import { PageHeader } from '../../components/layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
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
  'Food & Drink', 'Transport', 'Accommodation', 'Entertainment',
  'Shopping', 'Utilities', 'Healthcare', 'Travel', 'Other',
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
  const [payers, setPayers] = useState<{ userId: string; profile: Profile; amountStr: string }[]>([]);
  const [lineItems, setLineItems] = useState<LineItem[]>([{ id: crypto.randomUUID(), name: '', quantity: 1, unitPriceStr: '', participants: [] }]);
  const [availableProfiles, setAvailableProfiles] = useState<Profile[]>([]);
  const [_group, setGroup] = useState<Group | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amountStr, setAmountStr] = useState('');
  const [title, setTitle] = useState('');
  const [expenseDate, setExpenseDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const totalPaise = parseINR(amountStr) ?? 0;

  const loadContacts = useCallback(async () => {
    if (!user || !profile) return;
    let profiles: Profile[] = [profile];

    if (groupIdParam) {
      const { data: gData } = await supabase.from('groups').select('*').eq('id', groupIdParam).single();
      if (gData) setGroup(gData as unknown as Group);
      const { data: members } = await supabase
        .from('group_members')
        .select('user_id, profiles!group_members_user_id_fkey (*)')
        .eq('group_id', groupIdParam)
        .is('removed_at', null);
      profiles = (members ?? []).map((m: unknown) => (m as { profiles: Profile }).profiles).filter(Boolean);
      setAvailableProfiles(profiles);
      setParticipants(profiles.map((p) => ({ userId: p.id, profile: p })));
    } else {
      const { data: requestsRaw } = await supabase
        .from('friend_requests')
        .select('sender_id, receiver_id')
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .eq('status', 'accepted');
      const requests = (requestsRaw ?? []) as unknown as FriendRequestRow[];
      const friendIds = requests.map((r) => r.sender_id === user.id ? r.receiver_id : r.sender_id);
      const allIds = friendIdParam && !friendIds.includes(friendIdParam)
        ? [...friendIds, friendIdParam]
        : friendIds;

      if (allIds.length > 0) {
        const { data } = await supabase.from('profiles').select('*').in('id', allIds);
        profiles = [profile, ...(data ?? []) as unknown as Profile[]];
      }

      setAvailableProfiles(profiles);

      if (friendIdParam) {
        const friendProf = profiles.find((p) => p.id === friendIdParam);
        if (friendProf) {
          setParticipants([
            { userId: user.id, profile },
            { userId: friendProf.id, profile: friendProf },
          ]);
        } else {
          setParticipants(profiles.map((p) => ({ userId: p.id, profile: p })));
        }
      } else {
        setParticipants(profiles.map((p) => ({ userId: p.id, profile: p })));
      }
    }

    setPayers([{ userId: user.id, profile, amountStr: '' }]);
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

  const computeAllocations = (): { userId: string; amountPaise: number }[] | null => {
    if (totalPaise <= 0 || participants.length === 0) return null;
    try {
      const ids = participants.map((p) => p.userId);
      switch (splitMethod) {
        case 'equal':
          return equalSplit(totalPaise, ids).allocations;
        case 'unequal': {
          const assignments = participants.map((p) => ({ userId: p.userId, amountPaise: p.amountPaise ?? 0 }));
          return unequalSplit(totalPaise, assignments).allocations;
        }
        case 'percentage': {
          const assignments = participants.map((p) => ({ userId: p.userId, percentage: p.percentage ?? 0 }));
          return percentageSplit(totalPaise, assignments).allocations;
        }
        case 'shares': {
          const assignments = participants.map((p) => ({ userId: p.userId, shares: p.shares ?? 1 }));
          return sharesSplit(totalPaise, assignments).allocations;
        }
        case 'itemized': {
          const items = lineItems
            .filter((i) => i.name && parseINR(i.unitPriceStr))
            .map((i) => ({
              name: i.name,
              totalPaise: Math.round((parseINR(i.unitPriceStr) ?? 0) * i.quantity),
              participants: i.participants,
            }));
          if (items.length === 0) return null;
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
      const payerAmounts = payers.map((p) => ({ userId: p.userId, amountPaise: parseINR(p.amountStr) ?? 0 }));
      validateMultiplePayers(totalPaise, payerAmounts);
      return payerAmounts;
    } catch {
      return null;
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setError(null);
    if (!title.trim()) { setError('Please enter a title.'); return; }
    if (totalPaise <= 0) { setError('Please enter a valid amount.'); return; }
    if (participants.length === 0) { setError('Select at least one participant.'); return; }

    const allocations = computeAllocations();
    if (!allocations) { setError('Could not compute split. Check your inputs.'); return; }

    const payerAmounts = validatePayers();
    if (!payerAmounts) { setError('Payer contributions do not add up to the expense total.'); return; }

    setSaving(true);
    const idempotencyKey = `exp-${user.id}-${Date.now()}-${crypto.randomUUID()}`;

    try {
      if (!navigator.onLine) {
        await queueOfflineOperation({
          type: 'create_expense',
          payload: { title: title.trim(), amount_paise: totalPaise, currency: 'INR', split_method: splitMethod, group_id: groupIdParam, creator_id: user.id, expense_date: expenseDate, category: category || null, notes: notes || null, idempotency_key: idempotencyKey, payers: payerAmounts, shares: allocations },
          idempotencyKey,
        });
        navigate(-1);
        return;
      }

      const { data: expense, error: expError } = await db
        .from('expenses')
        .insert({ title: title.trim(), amount_paise: totalPaise, currency: 'INR', split_method: splitMethod, group_id: groupIdParam, creator_id: user.id, expense_date: expenseDate, category: category || null, notes: notes || null, idempotency_key: idempotencyKey })
        .select()
        .single();

      if (expError || !expense) { setError(expError?.message ?? 'Failed to create expense.'); return; }

      await Promise.all([
        db.from('expense_payers').insert(payerAmounts.map((p: { userId: string; amountPaise: number }) => ({ expense_id: expense.id, user_id: p.userId, amount_paise: p.amountPaise }))),
        db.from('expense_shares').insert(allocations.map((a: { userId: string; amountPaise: number }) => ({
          expense_id: expense.id, user_id: a.userId, amount_paise: a.amountPaise,
          percentage: splitMethod === 'percentage' ? participants.find((p) => p.userId === a.userId)?.percentage ?? null : null,
          share_weight: splitMethod === 'shares' ? participants.find((p) => p.userId === a.userId)?.shares ?? null : null,
        }))),
      ]);

      if (splitMethod === 'itemized') {
        for (const item of lineItems.filter((i) => i.name && parseINR(i.unitPriceStr))) {
          const unitPrice = parseINR(item.unitPriceStr) ?? 0;
          const { data: ins } = await db.from('expense_items').insert({ expense_id: expense.id, name: item.name, quantity: item.quantity, unit_price_paise: unitPrice, total_paise: Math.round(unitPrice * item.quantity) }).select().single();
          if (ins && item.participants.length > 0) {
            await db.from('expense_item_allocations').insert(item.participants.map((p: { userId: string; amountPaise: number }) => ({ item_id: ins.id, user_id: p.userId, amount_paise: p.amountPaise })));
          }
        }
      }

      navigate(`/expenses/${expense.id}`, { replace: true });
    } finally {
      setSaving(false);
    }
  };

  const allocations = computeAllocations();
  const allocationSum = allocations?.reduce((a, b) => a + b.amountPaise, 0) ?? 0;
  const reconciled = allocations !== null && allocationSum === totalPaise;

  if (step === 'basic') {
    return (
      <div>
        <PageHeader title="Add expense" back />
        <div className="page-content pt-4 space-y-5">
          <div>
            <label className="block text-xs text-muted mb-1">Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xl font-semibold text-secondary">₹</span>
              <input type="number" inputMode="decimal" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} className="input pl-8 text-2xl font-bold h-14" placeholder="0.00" min="0" step="0.01" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">What's it for?</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="input" placeholder="Dinner, taxi, groceries…" maxLength={120} />
          </div>

          <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-2 text-sm text-muted">
            <ChevronDown size={16} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            {showAdvanced ? 'Less options' : 'Date, category, notes'}
          </button>

          {showAdvanced && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-muted mb-1"><Calendar size={12} className="inline mr-1" />Date</label>
                <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className="input" />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1"><Tag size={12} className="inline mr-1" />Category</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
                  <option value="">No category</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1"><StickyNote size={12} className="inline mr-1" />Notes</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="input" rows={2} placeholder="Optional" maxLength={500} />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs text-muted mb-2"><Users size={12} className="inline mr-1" />Participants</label>
            <div className="flex flex-wrap gap-2">
              {availableProfiles.map((p) => {
                const selected = participants.some((x) => x.userId === p.id);
                return (
                  <button key={p.id} onClick={() => toggleParticipant(p)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${selected ? 'bg-[rgb(var(--color-accent))] text-white' : 'bg-tertiary text-secondary'}`}>
                    <Avatar src={p.avatar_url} name={p.display_name} size={20} />
                    {p.display_name}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted mb-2">Paid by</label>
            <div className="flex flex-wrap gap-2">
              {availableProfiles.map((p) => {
                const selected = payers.some((x) => x.userId === p.id);
                return (
                  <button key={p.id} onClick={() => togglePayer(p)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${selected ? 'bg-[rgb(var(--color-positive)/0.9)] text-white' : 'bg-tertiary text-secondary'}`}>
                    <Avatar src={p.avatar_url} name={p.display_name} size={20} />
                    {p.display_name}
                  </button>
                );
              })}
            </div>
            {payers.length > 1 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-muted">Enter each payer's contribution (must total {formatINR(totalPaise)}):</p>
                {payers.map((payer) => (
                  <div key={payer.userId} className="flex items-center gap-2">
                    <Avatar src={payer.profile.avatar_url} name={payer.profile.display_name} size={28} />
                    <span className="flex-1 text-sm text-primary">{payer.profile.display_name}</span>
                    <div className="relative w-28">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted text-sm">₹</span>
                      <input type="number" inputMode="decimal" value={payer.amountStr} onChange={(e) => setPayers((prev) => prev.map((p) => p.userId === payer.userId ? { ...p, amountStr: e.target.value } : p))} className="input pl-6 text-sm" placeholder="0.00" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <ErrorMessage message={error} />}

          <button onClick={() => { if (!title.trim() || totalPaise <= 0) { setError('Enter an amount and description.'); return; } setError(null); setStep('split'); }} className="btn-primary w-full">
            Next: Split
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Split method" back={() => setStep('basic')} />
      <div className="page-content pt-4 space-y-4">
        <div className="card text-center">
          <p className="text-2xl font-bold text-primary">{formatINR(totalPaise)}</p>
          <p className="text-sm text-muted">{title}</p>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {SPLIT_METHODS.map((m) => (
            <button key={m.value} onClick={() => setSplitMethod(m.value)} className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors ${splitMethod === m.value ? 'bg-[rgb(var(--color-accent))] text-white' : 'bg-tertiary text-secondary'}`}>
              {m.label}
            </button>
          ))}
        </div>

        {splitMethod === 'unequal' && (
          <div className="space-y-2">
            {participants.map((p) => (
              <div key={p.userId} className="flex items-center gap-2">
                <Avatar src={p.profile.avatar_url} name={p.profile.display_name} size={28} />
                <span className="flex-1 text-sm text-primary">{p.profile.display_name}</span>
                <div className="relative w-28">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted text-sm">₹</span>
                  <input type="number" inputMode="decimal" value={p.amountPaise !== undefined ? (p.amountPaise / 100).toFixed(2) : ''} onChange={(e) => { const paise = Math.round(parseFloat(e.target.value || '0') * 100); setParticipants((prev) => prev.map((x) => x.userId === p.userId ? { ...x, amountPaise: paise } : x)); }} className="input pl-6 text-sm" placeholder="0.00" />
                </div>
              </div>
            ))}
            <p className={`text-xs text-right ${allocationSum === totalPaise ? 'text-[rgb(var(--color-positive))]' : 'text-[rgb(var(--color-negative))]'}`}>
              {formatINR(allocationSum)} of {formatINR(totalPaise)}
            </p>
          </div>
        )}

        {splitMethod === 'percentage' && (
          <div className="space-y-2">
            {participants.map((p) => (
              <div key={p.userId} className="flex items-center gap-2">
                <Avatar src={p.profile.avatar_url} name={p.profile.display_name} size={28} />
                <span className="flex-1 text-sm text-primary">{p.profile.display_name}</span>
                <div className="relative w-24">
                  <input type="number" inputMode="decimal" value={p.percentage ?? ''} onChange={(e) => setParticipants((prev) => prev.map((x) => x.userId === p.userId ? { ...x, percentage: parseFloat(e.target.value) } : x))} className="input pr-6 text-sm" placeholder="0" max="100" min="0" />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted text-sm">%</span>
                </div>
              </div>
            ))}
            <p className={`text-xs text-right ${Math.abs(participants.reduce((a, p) => a + (p.percentage ?? 0), 0) - 100) < 0.01 ? 'text-[rgb(var(--color-positive))]' : 'text-[rgb(var(--color-negative))]'}`}>
              {participants.reduce((a, p) => a + (p.percentage ?? 0), 0).toFixed(1)}% of 100%
            </p>
          </div>
        )}

        {splitMethod === 'shares' && (
          <div className="space-y-2">
            {participants.map((p) => (
              <div key={p.userId} className="flex items-center gap-2">
                <Avatar src={p.profile.avatar_url} name={p.profile.display_name} size={28} />
                <span className="flex-1 text-sm text-primary">{p.profile.display_name}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setParticipants((prev) => prev.map((x) => x.userId === p.userId ? { ...x, shares: Math.max(0.5, (x.shares ?? 1) - 0.5) } : x))} className="w-8 h-8 bg-tertiary rounded-full flex items-center justify-center text-secondary"><Minus size={14} /></button>
                  <span className="w-8 text-center text-sm font-semibold text-primary">{p.shares ?? 1}</span>
                  <button onClick={() => setParticipants((prev) => prev.map((x) => x.userId === p.userId ? { ...x, shares: (x.shares ?? 1) + 0.5 } : x))} className="w-8 h-8 bg-tertiary rounded-full flex items-center justify-center text-secondary"><Plus size={14} /></button>
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
                  <input type="text" value={item.name} onChange={(e) => setLineItems((prev) => prev.map((x) => x.id === item.id ? { ...x, name: e.target.value } : x))} className="input flex-1 text-sm" placeholder={`Item ${idx + 1}`} />
                  <button onClick={() => setLineItems((prev) => prev.filter((x) => x.id !== item.id))} className="text-muted"><X size={16} /></button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-xs text-muted mb-1">Unit price (₹)</p>
                    <input type="number" inputMode="decimal" value={item.unitPriceStr} onChange={(e) => setLineItems((prev) => prev.map((x) => x.id === item.id ? { ...x, unitPriceStr: e.target.value } : x))} className="input text-sm" placeholder="0.00" />
                  </div>
                  <div>
                    <p className="text-xs text-muted mb-1">Qty</p>
                    <input type="number" inputMode="numeric" value={item.quantity} onChange={(e) => setLineItems((prev) => prev.map((x) => x.id === item.id ? { ...x, quantity: parseFloat(e.target.value) || 1 } : x))} className="input text-sm" min="1" />
                  </div>
                </div>
              </div>
            ))}
            <button onClick={() => setLineItems((prev) => [...prev, { id: crypto.randomUUID(), name: '', quantity: 1, unitPriceStr: '', participants: [] }])} className="btn-secondary w-full text-sm">
              <Plus size={14} /> Add item
            </button>
          </div>
        )}

        {allocations && (
          <div>
            <p className="section-title mb-2">Split preview</p>
            <div className="card p-0 overflow-hidden">
              {allocations.map((a) => {
                const pp = participants.find((p) => p.userId === a.userId)?.profile;
                return (
                  <div key={a.userId} className="flex items-center gap-3 px-4 py-2.5 border-b border-app last:border-0">
                    <Avatar src={pp?.avatar_url} name={pp?.display_name ?? a.userId} size={28} />
                    <span className="flex-1 text-sm text-primary">{pp?.display_name}</span>
                    <span className="text-sm font-semibold tabular-nums text-primary">{formatINR(a.amountPaise)}</span>
                  </div>
                );
              })}
            </div>
            {reconciled && <p className="text-xs text-[rgb(var(--color-positive))] mt-1 text-right">✓ Sums to {formatINR(totalPaise)}</p>}
          </div>
        )}

        {error && <ErrorMessage message={error} />}

        <button onClick={() => void handleSave()} className="btn-primary w-full" disabled={saving || !reconciled}>
          {saving ? <Spinner size={18} /> : null}
          Save expense
        </button>
      </div>
    </div>
  );
}
