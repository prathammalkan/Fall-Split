import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Edit3, Trash2, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, db } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { removeOperationsForExpense } from '../../lib/offlineQueue';
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const load = useCallback(async () => {
    if (!expenseId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error: err } = await supabase
        .from('expenses')
        .select(
          '*, creator:creator_id (id, display_name, avatar_url, username), group:group_id (id, name, type), expense_payers (user_id, amount_paise, profile:user_id (id, display_name, avatar_url, username)), expense_shares (user_id, amount_paise, percentage, share_weight, profile:user_id (id, display_name, avatar_url, username))'
        )
        .eq('id', expenseId)
        .neq('status', 'deleted')
        .single();
      if (err || !data) {
        setLoadError('Expense not found or access denied.');
        return;
      }
      setExpense(data as unknown as ExpenseData);
    } finally {
      setLoading(false);
    }
  }, [expenseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async () => {
    if (!expense || !user) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const { error: deleteErr } = await db.rpc('delete_expense', {
        p_expense_id: expense.id,
      });
      if (deleteErr) {
        setDeleteError(deleteErr.message || 'Failed to delete expense.');
        setShowDeleteConfirm(false);
        setDeleting(false);
        return;
      }
      await removeOperationsForExpense(expense.id, user.id);
      if (expense.group?.id) {
        navigate(`/groups/${expense.group.id}`, { replace: true });
      } else {
        navigate(-1);
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete expense.');
      setShowDeleteConfirm(false);
      setDeleting(false);
    }
  };

  // Only allow edit/void if this user created the expense AND it's still active
  const isCreator = expense?.creator_id === user?.id && expense?.status === 'active';

  if (loading)
    return (
      <div className="flex justify-center py-16">
        <Spinner size={32} />
      </div>
    );
  if (loadError)
    return (
      <div className="p-4">
        <ErrorMessage message={loadError} />
      </div>
    );
  if (!expense) return null;

  const payers = expense.expense_payers;
  const shares = expense.expense_shares;
  const creator = expense.creator;
  const group = expense.group;

  const splitMethodLabels: Record<string, string> = {
    equal: 'Equal split',
    unequal: 'Custom amounts',
    percentage: 'Percentage split',
    shares: 'Shares',
    itemized: 'Itemized',
    manual: 'Manual',
  };

  return (
    <div>
      <PageHeader
        title="Expense"
        back
        actions={
          isCreator ? (
            <>
              <Link
                to={`/expenses/${expense.id}/edit`}
                className="btn-ghost rounded-full p-2"
                aria-label="Edit expense"
              >
                <Edit3 size={18} />
              </Link>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="btn-ghost rounded-full p-2 text-[rgb(var(--color-negative))]"
                aria-label="Delete expense"
              >
                <Trash2 size={18} />
              </button>
            </>
          ) : null
        }
      />

      <div className="page-content space-y-4 pt-4">
        {deleteError && <ErrorMessage message={deleteError} />}
        <div className="card">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <h1 className="text-primary text-xl font-bold">{expense.title}</h1>
              {expense.description && (
                <p className="text-muted mt-1 text-sm">{expense.description}</p>
              )}
              {group && (
                <Link
                  to={`/groups/${group.id}`}
                  className="text-secondary mt-1 inline-flex items-center gap-1 text-xs hover:underline"
                >
                  {group.name} <ChevronRight size={12} />
                </Link>
              )}
            </div>
            <div className="text-right">
              <p className="text-primary text-2xl font-bold tabular-nums">
                {formatINR(expense.amount_paise)}
              </p>
              <p className="text-muted text-xs">{expense.currency}</p>
            </div>
          </div>
          <div className="divider mt-4 grid grid-cols-2 gap-3 border-t pt-4">
            <div>
              <p className="text-muted text-xs">Date</p>
              <p className="text-primary text-sm">
                {format(new Date(expense.expense_date), 'MMM d, yyyy')}
              </p>
            </div>
            <div>
              <p className="text-muted text-xs">Split</p>
              <p className="text-primary text-sm">
                {splitMethodLabels[expense.split_method] ?? expense.split_method}
              </p>
            </div>
            {expense.category && (
              <div>
                <p className="text-muted text-xs">Category</p>
                <p className="text-primary text-sm">{expense.category}</p>
              </div>
            )}
            {expense.notes && (
              <div className="col-span-2">
                <p className="text-muted text-xs">Notes</p>
                <p className="text-primary text-sm">{expense.notes}</p>
              </div>
            )}
          </div>
        </div>

        <div>
          <p className="section-title mb-2">Paid by</p>
          <div className="card overflow-hidden p-0">
            {payers.map((p) => (
              <div key={p.user_id} className="list-item">
                <Avatar
                  src={p.profile?.avatar_url ?? null}
                  name={p.profile?.display_name ?? 'Unknown'}
                  size={32}
                />
                <span className="text-primary flex-1 text-sm">
                  {p.profile?.display_name ?? 'Unknown'}
                </span>
                <span className="text-primary text-sm font-semibold tabular-nums">
                  {formatINR(p.amount_paise)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="section-title mb-2">Shares</p>
          <div className="card overflow-hidden p-0">
            {shares.map((s) => {
              const isPayer = payers.some((p) => p.user_id === s.user_id);
              const payerAmt = payers.find((p) => p.user_id === s.user_id)?.amount_paise ?? 0;
              // netPaise > 0 means payer covered more than their own share (they are owed)
              // netPaise < 0 means they owe someone else
              const netPaise = isPayer ? payerAmt - s.amount_paise : -s.amount_paise;
              return (
                <div key={s.user_id} className="list-item">
                  <Avatar
                    src={s.profile?.avatar_url ?? null}
                    name={s.profile?.display_name ?? 'Unknown'}
                    size={32}
                  />
                  <div className="flex-1">
                    <p className="text-primary text-sm">{s.profile?.display_name ?? 'Unknown'}</p>
                    {s.percentage != null && <p className="text-muted text-xs">{s.percentage}%</p>}
                    {s.share_weight != null && (
                      <p className="text-muted text-xs">{s.share_weight} shares</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-primary text-sm font-semibold tabular-nums">
                      {formatINR(s.amount_paise)}
                    </p>
                    {isPayer && netPaise !== 0 && (
                      <p
                        className={`text-xs tabular-nums ${netPaise > 0 ? 'text-[rgb(var(--color-positive))]' : 'text-[rgb(var(--color-negative))]'}`}
                      >
                        net {netPaise > 0 ? '+' : ''}
                        {formatINR(netPaise)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <p className="text-muted text-center text-xs">
          Added by {creator?.display_name ?? 'Unknown'} ·{' '}
          {format(new Date(expense.created_at), 'MMM d, yyyy')}
        </p>

        {showDeleteConfirm && (
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            aria-describedby="delete-dialog-desc"
            className="card border-[rgb(var(--color-negative)/0.3)] bg-[rgb(var(--color-negative)/0.05)] p-4"
          >
            <p id="delete-dialog-title" className="text-primary mb-1 text-sm font-semibold">
              Delete &ldquo;{expense.title}&rdquo; ({formatINR(expense.amount_paise)})?
            </p>
            <p id="delete-dialog-desc" className="text-muted mb-4 text-xs">
              This will permanently delete this expense and update all participant balances. This action cannot be undone. Confirmed settlements will not be affected.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="btn-secondary flex-1"
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="btn-danger flex-1 inline-flex items-center justify-center gap-2"
                disabled={deleting}
              >
                {deleting ? <Spinner size={16} /> : <Trash2 size={16} />}
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
