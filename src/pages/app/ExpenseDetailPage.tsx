import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Edit3, Trash2, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, db } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { PageHeader } from '../../components/layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { format } from 'date-fns';

interface PayerRow {
  user_id: string;
  amount_paise: number;
  profile: { display_name: string; avatar_url: string | null } | null;
}

interface ShareRow {
  user_id: string;
  amount_paise: number;
  percentage: number | null;
  share_weight: number | null;
  profile: { display_name: string; avatar_url: string | null } | null;
}

interface ExpenseData {
  id: string;
  title: string;
  description: string | null;
  amount_paise: number;
  currency: string;
  split_method: string;
  expense_date: string;
  created_at: string;
  category: string | null;
  notes: string | null;
  status: string;
  creator_id: string;
  creator: { display_name: string } | null;
  group: { id: string; name: string } | null;
  expense_payers: PayerRow[];
  expense_shares: ShareRow[];
}

export function ExpenseDetailPage() {
  const { expenseId } = useParams<{ expenseId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [expense, setExpense] = useState<ExpenseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const load = useCallback(async () => {
    if (!expenseId) return;
    setLoading(true);
    try {
      const { data, error: err } = await supabase
        .from('expenses')
        .select('*, creator:creator_id (id, display_name, avatar_url, username), group:group_id (id, name, type), expense_payers (user_id, amount_paise, profile:user_id (id, display_name, avatar_url, username)), expense_shares (user_id, amount_paise, percentage, share_weight, profile:user_id (id, display_name, avatar_url, username))')
        .eq('id', expenseId)
        .neq('status', 'deleted')
        .single();
      if (err || !data) { setError('Expense not found or access denied.'); return; }
      setExpense(data as unknown as ExpenseData);
    } finally {
      setLoading(false);
    }
  }, [expenseId]);

  useEffect(() => { void load(); }, [load]);

  const handleVoid = async () => {
    if (!expense || !user) return;
    setDeleting(true);
    const { error: voidErr } = await db.from('expenses')
      .update({ status: 'voided', voided_at: new Date().toISOString(), voided_by: user.id, void_reason: 'Deleted by creator' })
      .eq('id', expense.id)
      .eq('creator_id', user.id);
    setDeleting(false);
    if (voidErr) { setError('Failed to delete expense.'); return; }
    navigate(-1);
  };

  // Only allow edit/void if this user created the expense AND it's still active
  const isCreator = expense?.creator_id === user?.id && expense?.status === 'active';

  if (loading) return <div className="flex justify-center py-16"><Spinner size={32} /></div>;
  if (error) return <div className="p-4"><ErrorMessage message={error} /></div>;
  if (!expense) return null;

  const payers = expense.expense_payers;
  const shares = expense.expense_shares;
  const creator = expense.creator;
  const group = expense.group;

  const splitMethodLabels: Record<string, string> = {
    equal: 'Equal split', unequal: 'Custom amounts', percentage: 'Percentage split',
    shares: 'Shares', itemized: 'Itemized', manual: 'Manual',
  };

  return (
    <div>
      <PageHeader title="Expense" back actions={isCreator ? (
        <>
          <Link to={`/expenses/${expense.id}/edit`} className="btn-ghost p-2 rounded-full" aria-label="Edit expense"><Edit3 size={18} /></Link>
          <button onClick={() => setShowDeleteConfirm(true)} className="btn-ghost p-2 rounded-full text-[rgb(var(--color-negative))]" aria-label="Delete expense"><Trash2 size={18} /></button>
        </>
      ) : null} />

      <div className="page-content pt-4 space-y-4">
        <div className="card">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <h1 className="text-xl font-bold text-primary">{expense.title}</h1>
              {expense.description && <p className="text-sm text-muted mt-1">{expense.description}</p>}
              {group && (
                <Link to={`/groups/${group.id}`} className="inline-flex items-center gap-1 text-xs text-secondary mt-1 hover:underline">
                  {group.name} <ChevronRight size={12} />
                </Link>
              )}
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-primary tabular-nums">{formatINR(expense.amount_paise)}</p>
              <p className="text-xs text-muted">{expense.currency}</p>
            </div>
          </div>
          <div className="border-t divider mt-4 pt-4 grid grid-cols-2 gap-3">
            <div><p className="text-xs text-muted">Date</p><p className="text-sm text-primary">{format(new Date(expense.expense_date), 'MMM d, yyyy')}</p></div>
            <div><p className="text-xs text-muted">Split</p><p className="text-sm text-primary">{splitMethodLabels[expense.split_method] ?? expense.split_method}</p></div>
            {expense.category && <div><p className="text-xs text-muted">Category</p><p className="text-sm text-primary">{expense.category}</p></div>}
            {expense.notes && <div className="col-span-2"><p className="text-xs text-muted">Notes</p><p className="text-sm text-primary">{expense.notes}</p></div>}
          </div>
        </div>

        <div>
          <p className="section-title mb-2">Paid by</p>
          <div className="card p-0 overflow-hidden">
            {payers.map((p) => (
              <div key={p.user_id} className="list-item">
                <Avatar src={p.profile?.avatar_url ?? null} name={p.profile?.display_name ?? 'Unknown'} size={32} />
                <span className="flex-1 text-sm text-primary">{p.profile?.display_name ?? 'Unknown'}</span>
                <span className="text-sm font-semibold tabular-nums text-primary">{formatINR(p.amount_paise)}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="section-title mb-2">Shares</p>
          <div className="card p-0 overflow-hidden">
            {shares.map((s) => {
              const isPayer = payers.some((p) => p.user_id === s.user_id);
              const payerAmt = payers.find((p) => p.user_id === s.user_id)?.amount_paise ?? 0;
              // netPaise > 0 means payer covered more than their own share (they are owed)
              // netPaise < 0 means they owe someone else
              const netPaise = isPayer ? payerAmt - s.amount_paise : -s.amount_paise;
              return (
                <div key={s.user_id} className="list-item">
                  <Avatar src={s.profile?.avatar_url ?? null} name={s.profile?.display_name ?? 'Unknown'} size={32} />
                  <div className="flex-1">
                    <p className="text-sm text-primary">{s.profile?.display_name ?? 'Unknown'}</p>
                    {s.percentage != null && <p className="text-xs text-muted">{s.percentage}%</p>}
                    {s.share_weight != null && <p className="text-xs text-muted">{s.share_weight} shares</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-primary">{formatINR(s.amount_paise)}</p>
                    {isPayer && netPaise !== 0 && <p className={`text-xs tabular-nums ${netPaise > 0 ? 'text-[rgb(var(--color-positive))]' : 'text-[rgb(var(--color-negative))]'}`}>net {netPaise > 0 ? '+' : ''}{formatINR(netPaise)}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <p className="text-xs text-muted text-center">Added by {creator?.display_name ?? 'Unknown'} · {format(new Date(expense.created_at), 'MMM d, yyyy')}</p>

        {showDeleteConfirm && (
          <div className="card border-[rgb(var(--color-negative)/0.3)]">
            <p className="text-sm font-semibold text-primary mb-2">Delete this expense?</p>
            <p className="text-xs text-muted mb-4">This will void the expense. Confirmed settlements will not be affected.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteConfirm(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={() => void handleVoid()} className="btn-danger flex-1" disabled={deleting}>{deleting ? <Spinner size={16} /> : null}Delete</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
