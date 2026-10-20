import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase, db } from '../../lib/supabase';
import { parseINR, formatINR } from '../../lib/money';
import { equalSplit } from '../../lib/splits';
import { PageHeader } from '../../components/layout/PageHeader';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorMessage } from '../../components/ui/ErrorMessage';

const CATEGORIES = [
  'Food & Drink', 'Transport', 'Accommodation', 'Entertainment',
  'Shopping', 'Utilities', 'Healthcare', 'Travel', 'Other',
];

interface ExistingExpense {
  id: string;
  title: string;
  amount_paise: number;
  expense_date: string;
  notes: string | null;
  category: string | null;
  split_method: string;
  creator_id: string;
  status: string;
  expense_payers: { user_id: string; amount_paise: number }[];
  expense_shares: { user_id: string; amount_paise: number; percentage: number | null; share_weight: number | null }[];
}

export function EditExpensePage() {
  const { expenseId } = useParams<{ expenseId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [original, setOriginal] = useState<ExistingExpense | null>(null);
  const [title, setTitle] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [expenseDate, setExpenseDate] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState('');

  const load = useCallback(async () => {
    if (!expenseId || !user) return;
    const { data: rawData } = await supabase
      .from('expenses')
      .select('*, expense_payers (user_id, amount_paise), expense_shares (user_id, amount_paise, percentage, share_weight)')
      .eq('id', expenseId)
      .eq('creator_id', user.id)
      .eq('status', 'active')
      .single();
    const data = rawData as unknown as ExistingExpense | null;
    if (data) {
      setOriginal(data);
      setTitle(data.title);
      setAmountStr((data.amount_paise / 100).toFixed(2));
      setExpenseDate(data.expense_date);
      setNotes(data.notes ?? '');
      setCategory(data.category ?? '');
    }
    setLoading(false);
  }, [expenseId, user]);

  useEffect(() => { void load(); }, [load]);

  const handleSave = async () => {
    if (!expenseId || !user || !original) return;
    setError(null);

    const newAmount = parseINR(amountStr);
    if (!newAmount || newAmount <= 0) { setError('Enter a valid amount.'); return; }
    if (!title.trim()) { setError('Enter a title.'); return; }

    const amountChanged = newAmount !== original.amount_paise;
    const sharesExist = original.expense_shares.length > 0;

    // If amount changed and this is an equal split, recalculate shares automatically.
    // For other split methods, we cannot safely recalculate without participant input,
    // so we block the save and explain to the user.
    if (amountChanged && sharesExist && original.split_method !== 'equal') {
      setError(
        `The amount has changed but this expense uses a "${original.split_method}" split. ` +
        `To change the amount, please delete this expense and create a new one with the updated amounts ` +
        `so all participant shares are correctly recalculated.`
      );
      return;
    }

    setSaving(true);
    try {
      // Update the expense header
      const { error: expErr } = await db
        .from('expenses')
        .update({
          title: title.trim(),
          amount_paise: newAmount,
          expense_date: expenseDate,
          notes: notes || null,
          category: category || null,
        })
        .eq('id', expenseId)
        .eq('creator_id', user.id)
        .eq('status', 'active');

      if (expErr) { setError('Failed to save changes. Please try again.'); return; }

      // If it's an equal split and amount changed, recalculate shares and payers
      if (amountChanged && original.split_method === 'equal') {
        const participantIds = original.expense_shares.map(s => s.user_id);
        const payerIds = original.expense_payers.map(p => p.user_id);

        // Recalculate equal shares
        const newShares = equalSplit(newAmount, participantIds).allocations;

        // For payers: if single payer, update to new total. Multi-payer: proportional.
        let newPayers: { user_id: string; amount_paise: number }[];
        if (payerIds.length === 1 && original.expense_payers[0]) {
          newPayers = [{ user_id: original.expense_payers[0].user_id, amount_paise: newAmount }];
        } else {
          // Proportional rescaling of payer contributions
          const oldTotal = original.amount_paise;
          newPayers = original.expense_payers.map(p => ({
            user_id: p.user_id,
            amount_paise: Math.round(p.amount_paise * newAmount / oldTotal),
          }));
          // Fix any rounding error by adjusting the first payer
          const payerSum = newPayers.reduce((acc, p) => acc + p.amount_paise, 0);
          if (newPayers[0] && payerSum !== newAmount) {
            newPayers[0] = { ...newPayers[0], amount_paise: newPayers[0].amount_paise + (newAmount - payerSum) };
          }
        }

        // Delete old shares and payers, then reinsert
        const [delSharesErr, delPayersErr] = await Promise.all([
          db.from('expense_shares').delete().eq('expense_id', expenseId),
          db.from('expense_payers').delete().eq('expense_id', expenseId),
        ]).then(([s, p]) => [s.error, p.error]);

        if (delSharesErr || delPayersErr) {
          setError('Failed to update expense shares. Please try again.');
          return;
        }

        const [newSharesResult, newPayersResult] = await Promise.all([
          db.from('expense_shares').insert(
            newShares.map(s => ({ expense_id: expenseId, user_id: s.userId, amount_paise: s.amountPaise }))
          ),
          db.from('expense_payers').insert(
            newPayers.map(p => ({ expense_id: expenseId, user_id: p.user_id, amount_paise: p.amount_paise }))
          ),
        ]);

        if (newSharesResult.error || newPayersResult.error) {
          setError('Failed to save updated participant shares. The expense amount was reverted. Please try again.');
          // Revert the expense header amount to original to keep consistency
          await db.from('expenses').update({ amount_paise: original.amount_paise }).eq('id', expenseId).eq('creator_id', user.id);
          return;
        }
      }

      navigate(`/expenses/${expenseId}`, { replace: true });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-16"><Spinner size={32} /></div>;
  if (!original) return <div className="p-4"><ErrorMessage message="Expense not found or you cannot edit it." /></div>;

  const newAmount = parseINR(amountStr) ?? 0;
  const amountChanged = newAmount > 0 && newAmount !== original.amount_paise;
  const isNonEqualSplit = original.split_method !== 'equal' && original.expense_shares.length > 0;
  const canSave = !isNonEqualSplit || !amountChanged;

  return (
    <div>
      <PageHeader title="Edit expense" back />
      <div className="page-content pt-4 space-y-4">
        {error && <ErrorMessage message={error} />}

        <div>
          <label className="block text-xs text-muted mb-1">Amount (₹)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xl font-semibold text-secondary">₹</span>
            <input
              type="number"
              inputMode="decimal"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className="input pl-8 text-xl font-bold h-12"
              min="0"
              step="0.01"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-muted mb-1">Title</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="input" maxLength={120} />
        </div>

        <div>
          <label className="block text-xs text-muted mb-1">Date</label>
          <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className="input" />
        </div>

        <div>
          <label className="block text-xs text-muted mb-1">Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
            <option value="">No category</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-muted mb-1">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="input" rows={2} maxLength={500} />
        </div>

        {amountChanged && original.split_method === 'equal' && (
          <div className="rounded-lg p-3 bg-[rgb(var(--color-positive)/0.08)] border border-[rgb(var(--color-positive)/0.2)]">
            <p className="text-xs text-[rgb(var(--color-positive))]">
              ✓ Amount changed — participant shares will be automatically recalculated using equal split
              ({original.expense_shares.length} participant{original.expense_shares.length !== 1 ? 's' : ''}).
              New share: {original.expense_shares.length > 0 ? formatINR(Math.round(newAmount / original.expense_shares.length)) : '—'} each.
            </p>
          </div>
        )}

        {amountChanged && isNonEqualSplit && (
          <div className="rounded-lg p-3 bg-[rgb(var(--color-negative)/0.08)] border border-[rgb(var(--color-negative)/0.2)]">
            <p className="text-xs text-[rgb(var(--color-negative))]">
              ⚠ This expense uses a "{original.split_method}" split. Changing the amount requires
              recreating the expense so all participant shares can be correctly recalculated.
              To keep this expense, restore the original amount ({formatINR(original.amount_paise)}).
            </p>
          </div>
        )}

        <button
          onClick={() => void handleSave()}
          className="btn-primary w-full"
          disabled={saving || !canSave}
        >
          {saving ? <Spinner size={18} /> : null}
          Save changes
        </button>
      </div>
    </div>
  );
}
