import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase, db } from '../../lib/supabase';
import { parseINR } from '../../lib/money';
import { PageHeader } from '../../components/layout/PageHeader';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorMessage } from '../../components/ui/ErrorMessage';

export function EditExpensePage() {
  const { expenseId } = useParams<{ expenseId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expenseExists, setExpenseExists] = useState(false);
  const [title, setTitle] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [expenseDate, setExpenseDate] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState('');

  const load = useCallback(async () => {
    if (!expenseId || !user) return;
    const { data: rawData } = await supabase.from('expenses').select('*').eq('id', expenseId).eq('creator_id', user.id).eq('status', 'active').single();
    const data = rawData as unknown as { title: string; amount_paise: number; expense_date: string; notes: string | null; category: string | null } | null;
    if (data) {
      setExpenseExists(true);
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
    if (!expenseId || !user) return;
    const newAmount = parseINR(amountStr);
    if (!newAmount || newAmount <= 0) { setError('Enter a valid amount.'); return; }
    if (!title.trim()) { setError('Enter a title.'); return; }
    setSaving(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await db.from('expenses').update({ title: title.trim(), amount_paise: newAmount, expense_date: expenseDate, notes: notes || null, category: category || null }).eq('id', expenseId).eq('creator_id', user.id).eq('status', 'active');
    setSaving(false);
    if (err) { setError('Failed to save changes.'); return; }
    navigate(`/expenses/${expenseId}`, { replace: true });
  };

  if (loading) return <div className="flex justify-center py-16"><Spinner size={32} /></div>;
  if (!expenseExists) return <div className="p-4"><ErrorMessage message="Expense not found or you cannot edit it." /></div>;

  return (
    <div>
      <PageHeader title="Edit expense" back />
      <div className="page-content pt-4 space-y-4">
        {error && <ErrorMessage message={error} />}
        <div>
          <label className="block text-xs text-muted mb-1">Amount (₹)</label>
          <input type="number" inputMode="decimal" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} className="input text-xl font-bold h-12" />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Description</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="input" maxLength={120} />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Date</label>
          <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className="input" />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="input" rows={2} />
        </div>
        <div className="rounded-lg p-3 bg-[rgb(var(--color-pending)/0.1)] border border-[rgb(var(--color-pending)/0.2)]">
          <p className="text-xs text-[rgb(var(--color-pending))]">Note: editing the amount does not automatically recalculate existing shares. Notify participants of any changes.</p>
        </div>
        <button onClick={() => void handleSave()} className="btn-primary w-full" disabled={saving}>
          {saving ? <Spinner size={18} /> : null}Save changes
        </button>
      </div>
    </div>
  );
}
