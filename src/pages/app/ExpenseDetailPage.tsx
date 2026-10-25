import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Edit3,
  Trash2,
  ChevronRight,
  Check,
  Clock,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, db } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { removeOperationsForExpense } from '../../lib/offlineQueue';
import { PageHeader } from '../../components/layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { SheetDialog } from '../../components/ui/SheetDialog';
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

interface ApprovalRow {
  id: string;
  user_id: string;
  status: 'pending' | 'approved' | 'disputed';
  dispute_reason: string | null;
  dispute_category: string | null;
  created_at: string;
  responded_at: string | null;
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
  expense_approvals?: ApprovalRow[];
}

const DISPUTE_CATEGORIES = [
  'Incorrect total',
  'Incorrect personal share',
  'Incorrect payer',
  'Incorrect participant list',
  'Other',
];

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

  // Approval and Dispute state
  const [approving, setApproving] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [disputeCategory, setDisputeCategory] = useState<string>('Incorrect personal share');
  const [disputeReason, setDisputeReason] = useState<string>('');
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [showConfirmedModal, setShowConfirmedModal] = useState(false);

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

      let approvals: ApprovalRow[] = [];
      try {
        const { data: approvalData, error: approvalErr } = await supabase
          .from('expense_approvals')
          .select(
            'id, user_id, status, dispute_reason, dispute_category, created_at, responded_at, profile:user_id (id, display_name, avatar_url, username)'
          )
          .eq('expense_id', expenseId);
        if (!approvalErr && approvalData) {
          approvals = approvalData as unknown as ApprovalRow[];
        }
      } catch {
        // Table not present yet in unmigrated database
      }

      setExpense({
        ...(data as unknown as ExpenseData),
        expense_approvals: approvals,
      });
    } finally {
      setLoading(false);
    }
  }, [expenseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleApprove = async () => {
    if (!expense || !user) return;
    setApproving(true);
    setApprovalError(null);
    try {
      const { data: res, error: err } = (await db.rpc('respond_to_expense_approval', {
        p_expense_id: expense.id,
        p_action: 'approve',
      })) as {
        data: { success?: boolean; all_approved?: boolean; expense_status?: string } | null;
        error: { message: string } | null;
      };

      if (err) {
        setApprovalError(err.message || 'Could not approve expense.');
        return;
      }

      if (res?.all_approved || res?.expense_status === 'confirmed') {
        setShowConfirmedModal(true);
      }
      await load();
    } catch (e) {
      setApprovalError(e instanceof Error ? e.message : 'Failed to approve expense.');
    } finally {
      setApproving(false);
    }
  };

  const handleDispute = async () => {
    if (!expense || !user) return;
    const cleanReason = disputeReason.trim();
    if (cleanReason.length < 3) {
      setApprovalError('A valid dispute reason of at least 3 characters is required.');
      return;
    }
    setDisputing(true);
    setApprovalError(null);
    try {
      const { error: err } = (await db.rpc('respond_to_expense_approval', {
        p_expense_id: expense.id,
        p_action: 'dispute',
        p_dispute_category: disputeCategory,
        p_dispute_reason: cleanReason,
      })) as { error: { message: string } | null };

      if (err) {
        setApprovalError(err.message || 'Could not record dispute.');
        return;
      }

      setShowDisputeModal(false);
      setDisputeReason('');
      await load();
    } catch (e) {
      setApprovalError(e instanceof Error ? e.message : 'Failed to record dispute.');
    } finally {
      setDisputing(false);
    }
  };

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

  // Only allow edit/void if this user created the expense AND it's not deleted
  const isCreator =
    expense?.creator_id === user?.id &&
    expense?.status !== 'deleted' &&
    expense?.status !== 'voided';

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
  const approvals = expense.expense_approvals ?? [];
  const creator = expense.creator;
  const group = expense.group;

  const userShare = shares.find((s) => s.user_id === user?.id);
  const myApproval = approvals.find((a) => a.user_id === user?.id);
  const canApproveOrDispute = myApproval && myApproval.status === 'pending';

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

        {/* Expense Header Card */}
        <div className="card">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-primary text-xl font-bold">{expense.title}</h1>
                {expense.status === 'pending_approval' && (
                  <span className="badge-pending inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium">
                    <Clock size={12} /> Pending Approval
                  </span>
                )}
                {expense.status === 'disputed' && (
                  <span className="badge-negative inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium">
                    <AlertTriangle size={12} /> Disputed
                  </span>
                )}
                {(expense.status === 'confirmed' || expense.status === 'active') && (
                  <span className="badge-positive inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium">
                    <Check size={12} /> Confirmed
                  </span>
                )}
                {(expense.status === 'voided' || expense.status === 'cancelled') && (
                  <span className="badge-neutral inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium">
                    Cancelled
                  </span>
                )}
              </div>
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

        {/* Action card for participant approval */}
        {canApproveOrDispute && (
          <div className="card border-[rgb(var(--color-pending)/0.3)] bg-[rgb(var(--color-pending)/0.05)] p-4">
            <div className="flex items-start gap-3">
              <Clock className="mt-0.5 text-[rgb(var(--color-pending))]" size={20} />
              <div className="flex-1">
                <p className="text-primary text-sm font-semibold">Your approval is required</p>
                <p className="text-muted mt-0.5 text-xs">
                  Review your allocated share of {formatINR(userShare?.amount_paise ?? 0)} and
                  confirm or dispute this expense.
                </p>
                {approvalError && (
                  <p className="mt-2 text-xs text-[rgb(var(--color-negative))]">{approvalError}</p>
                )}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleApprove()}
                    disabled={approving}
                    className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium"
                  >
                    {approving ? <Spinner size={14} /> : <Check size={14} />} Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDisputeModal(true)}
                    disabled={approving}
                    className="btn-secondary inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-[rgb(var(--color-negative))]"
                  >
                    <AlertTriangle size={14} /> Dispute
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Participant Approvals List */}
        {approvals.length > 0 && (
          <div>
            <p className="section-title mb-2">Participant approvals</p>
            <div className="card overflow-hidden p-0">
              {approvals.map((app) => (
                <div key={app.id} className="list-item">
                  <Avatar
                    src={app.profile?.avatar_url ?? null}
                    name={app.profile?.display_name ?? 'Participant'}
                    size={32}
                  />
                  <div className="flex-1">
                    <p className="text-primary text-sm font-medium">
                      {app.profile?.display_name ?? 'Participant'}
                    </p>
                    {app.status === 'disputed' && (
                      <p className="mt-0.5 text-xs text-[rgb(var(--color-negative))]">
                        Disputed: {app.dispute_category ?? 'General dispute'}
                        {app.dispute_reason ? ` — "${app.dispute_reason}"` : ''}
                      </p>
                    )}
                  </div>
                  <div>
                    {app.status === 'approved' && (
                      <span className="badge-positive inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs">
                        <Check size={12} /> Approved
                      </span>
                    )}
                    {app.status === 'disputed' && (
                      <span className="badge-negative inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs">
                        <AlertTriangle size={12} /> Disputed
                      </span>
                    )}
                    {app.status === 'pending' && (
                      <span className="badge-pending inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs">
                        <Clock size={12} /> Pending
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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

        {/* Delete Confirmation Card */}
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
              This will permanently delete this expense and update all participant balances. This
              action cannot be undone. Confirmed settlements will not be affected.
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
                className="btn-danger inline-flex flex-1 items-center justify-center gap-2"
                disabled={deleting}
              >
                {deleting ? <Spinner size={16} /> : <Trash2 size={16} />}
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        )}

        {/* Dispute Modal (Requirement B7) */}
        {showDisputeModal && (
          <SheetDialog title="Dispute expense" onClose={() => setShowDisputeModal(false)}>
            <div className="space-y-4 p-5">
              <h2 className="text-primary text-lg font-bold">Dispute expense</h2>
              <p className="text-secondary text-sm">
                Select a reason why you are disputing this expense:
              </p>
              <div className="space-y-2">
                {DISPUTE_CATEGORIES.map((cat) => (
                  <label
                    key={cat}
                    className="text-primary flex cursor-pointer items-center gap-2.5 text-sm"
                  >
                    <input
                      type="radio"
                      name="disputeCategory"
                      value={cat}
                      checked={disputeCategory === cat}
                      onChange={() => setDisputeCategory(cat)}
                      className="accent-[rgb(var(--color-primary))]"
                    />
                    <span>{cat}</span>
                  </label>
                ))}
              </div>
              <div>
                <label className="text-muted mb-1 block text-xs">
                  Reason for dispute <span className="text-[rgb(var(--color-negative))]">*</span>
                </label>
                <textarea
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  className="input min-h-[80px] w-full text-sm"
                  placeholder="Explain what needs to be corrected (minimum 3 characters)..."
                  maxLength={500}
                />
                <p className="text-muted mt-1 text-[11px]">
                  Provide a specific explanation so other participants understand why this expense
                  is disputed.
                </p>
              </div>
              {approvalError && <ErrorMessage message={approvalError} />}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowDisputeModal(false)}
                  className="btn-secondary flex-1"
                  disabled={disputing}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleDispute()}
                  className="btn-danger inline-flex flex-1 items-center justify-center gap-1.5"
                  disabled={disputing || !disputeCategory || disputeReason.trim().length < 3}
                >
                  {disputing ? <Spinner size={16} /> : null} Submit dispute
                </button>
              </div>
            </div>
          </SheetDialog>
        )}

        {/* Final Confirmation Modal (Requirement C2) */}
        {showConfirmedModal && (
          <SheetDialog title="Expense confirmed" onClose={() => setShowConfirmedModal(false)}>
            <div className="p-6 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[rgb(var(--color-positive)/0.12)] text-[rgb(var(--color-positive))]">
                <CheckCircle2 size={32} />
              </div>
              <h2 className="text-primary text-xl font-bold">Expense confirmed</h2>
              <p className="text-secondary mt-2 text-sm">
                All required participants have approved this expense. Confirmed balances have been
                updated.
              </p>
              <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
                <button
                  type="button"
                  onClick={() => navigate('/friends')}
                  className="btn-primary w-full px-6 py-2.5 text-sm font-medium sm:w-auto"
                >
                  View Balances
                </button>
                <button
                  type="button"
                  onClick={() => setShowConfirmedModal(false)}
                  className="btn-secondary w-full px-6 py-2.5 text-sm font-medium sm:w-auto"
                >
                  Done
                </button>
              </div>
            </div>
          </SheetDialog>
        )}
      </div>
    </div>
  );
}
