import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase, db } from '../../lib/supabase';
import { parseINR, formatINR } from '../../lib/money';
import { PageHeader } from '../../components/layout/PageHeader';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorMessage } from '../../components/ui/ErrorMessage';

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
  updated_at: string;
  expense_payers: { user_id: string; amount_paise: number }[];
  expense_shares: {
    user_id: string;
    amount_paise: number;
    percentage: number | null;
    share_weight: number | null;
  }[];
}

export function EditExpensePage() {
  const { expenseId } = useParams<{ expenseId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [original, setOriginal] = useState<ExistingExpense | null>(null);
  const [title, setTitle] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [expenseDate, setExpenseDate] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState('');

  const load = useCallback(async () => {
    if (!expenseId || !user) return;
    setLoading(true);
    setLoadError(null);
    try {
      const { data: rawData, error: loadErr } = await supabase
        .from('expenses')
        .select(
          '*, expense_payers (user_id, amount_paise), expense_shares (user_id, amount_paise, percentage, share_weight)'
        )
        .eq('id', expenseId)
        .eq('creator_id', user.id)
        .eq('status', 'active')
        .single();
      if (loadErr) {
        setLoadError(
          loadErr.code === 'PGRST116'
            ? 'Expense not found or you cannot edit it.'
            : 'Expense could not be loaded. Please try again.'
        );
        return;
      }
      const data = rawData as unknown as ExistingExpense | null;
      if (!data) {
        setLoadError('Expense not found or you cannot edit it.');
        return;
      }
      setOriginal(data);
      setTitle(data.title);
      setAmountStr((data.amount_paise / 100).toFixed(2));
      setExpenseDate(data.expense_date);
      setNotes(data.notes ?? '');
      setCategory(data.category ?? '');
    } catch {
      setLoadError('Expense could not be loaded. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [expenseId, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    if (!expenseId || !user || !original) return;
    setError(null);

    const newAmount = parseINR(amountStr);
    if (!newAmount || newAmount <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    if (!title.trim()) {
      setError('Enter a title.');
      return;
    }

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
      const { data: updatedExpenseId, error: updateError } = await db.rpc(
        'update_expense_with_records',
        {
          p_expense_id: expenseId,
          p_expected_updated_at: original.updated_at,
          p_title: title.trim(),
          p_amount_paise: newAmount,
          p_expense_date: expenseDate,
          p_notes: notes || null,
          p_category: category || null,
        }
      );

      if (updateError || updatedExpenseId !== expenseId) {
        setError(
          updateError?.code === '40001'
            ? 'This expense changed while you were editing it. Reload it and try again.'
            : 'Failed to save changes. The expense was not updated. Please try again.'
        );
        return;
      }

      navigate(`/expenses/${expenseId}`, { replace: true });
    } catch {
      setError('Failed to save changes. The expense was not updated. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <div className="flex justify-center py-16">
        <Spinner size={32} />
      </div>
    );
  if (loadError)
    return (
      <div className="p-4">
        <ErrorMessage message={loadError} retry={() => void load()} />
      </div>
    );
  if (!original) return null;

  const newAmount = parseINR(amountStr) ?? 0;
  const amountChanged = newAmount > 0 && newAmount !== original.amount_paise;
  const isNonEqualSplit = original.split_method !== 'equal' && original.expense_shares.length > 0;
  const canSave = !isNonEqualSplit || !amountChanged;

  return (
    <div>
      <PageHeader title="Edit expense" back />
      <div className="page-content space-y-4 pt-4">
        {error && <ErrorMessage message={error} />}

        <div>
          <label className="text-muted mb-1 block text-xs">Amount (₹)</label>
          <div className="relative">
            <span className="text-secondary absolute top-1/2 left-3 -translate-y-1/2 text-xl font-semibold">
              ₹
            </span>
            <input
              type="number"
              inputMode="decimal"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className="input h-12 pl-8 text-xl font-bold"
              min="0"
              step="0.01"
            />
          </div>
        </div>

        <div>
          <label className="text-muted mb-1 block text-xs">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input"
            maxLength={120}
          />
        </div>

        <div>
          <label className="text-muted mb-1 block text-xs">Date</label>
          <input
            type="date"
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
            className="input"
          />
        </div>

        <div>
          <label className="text-muted mb-1 block text-xs">Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
            <option value="">No category</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-muted mb-1 block text-xs">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input"
            rows={2}
            maxLength={500}
          />
        </div>

        {amountChanged && original.split_method === 'equal' && (
          <div className="rounded-lg border border-[rgb(var(--color-positive)/0.2)] bg-[rgb(var(--color-positive)/0.08)] p-3">
            <p className="text-xs text-[rgb(var(--color-positive))]">
              ✓ Amount changed — participant shares will be automatically recalculated using equal
              split ({original.expense_shares.length} participant
              {original.expense_shares.length !== 1 ? 's' : ''}). New share:{' '}
              {original.expense_shares.length > 0
                ? formatINR(Math.round(newAmount / original.expense_shares.length))
                : '—'}{' '}
              each.
            </p>
          </div>
        )}

        {amountChanged && isNonEqualSplit && (
          <div className="rounded-lg border border-[rgb(var(--color-negative)/0.2)] bg-[rgb(var(--color-negative)/0.08)] p-3">
            <p className="text-xs text-[rgb(var(--color-negative))]">
              ⚠ This expense uses a "{original.split_method}" split. Changing the amount requires
              recreating the expense so all participant shares can be correctly recalculated. To
              keep this expense, restore the original amount ({formatINR(original.amount_paise)}).
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
