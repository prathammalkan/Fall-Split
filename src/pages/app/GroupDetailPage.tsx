import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Plus, Receipt, UserPlus, CheckSquare, Square, Trash2, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, db } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { PageHeader } from '../../components/layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { EmptyState } from '../../components/ui/EmptyState';
import { SheetDialog } from '../../components/ui/SheetDialog';
import { ShareInviteModal } from '../../components/ui/ShareInviteModal';
import { format } from 'date-fns';
import type { Group, GroupMember, Profile, Expense } from '../../types';

export function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Array<GroupMember & { profile: Profile }>>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);

  // Bulk delete state
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ deleted: number; skipped: number } | null>(
    null
  );

  const load = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    setError(null);
    try {
      const [groupResult, membersResult, expensesResult] = await Promise.all([
        supabase.from('groups').select('*').eq('id', groupId).single(),
        supabase
          .from('group_members')
          .select('*, profile:user_id (id, display_name, avatar_url, username)')
          .eq('group_id', groupId)
          .is('removed_at', null),
        supabase
          .from('expenses')
          .select('id, title, amount_paise, expense_date, status, creator_id')
          .eq('group_id', groupId)
          .in('status', ['active', 'confirmed', 'pending_approval', 'disputed'])
          .order('expense_date', { ascending: false })
          .limit(30),
      ]);
      if (groupResult.error || membersResult.error || expensesResult.error) {
        setGroup(null);
        setError('Group details could not be loaded. Please try again.');
        return;
      }
      const { data: g } = groupResult;
      const { data: m } = membersResult;
      const { data: e } = expensesResult;
      if (!g) {
        setError('Group not found.');
        return;
      }
      setGroup(g);
      setMembers((m ?? []) as unknown as Array<GroupMember & { profile: Profile }>);
      setExpenses(e ?? []);
    } catch {
      setGroup(null);
      setError('Group details could not be loaded. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const ownedExpenseIds = expenses.filter((e) => e.creator_id === user?.id).map((e) => e.id);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === ownedExpenseIds.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(ownedExpenseIds));
    }
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
    setDeleteResult(null);
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    setBulkDeleting(true);
    try {
      const ids = Array.from(selected);
      const { data, error: rpcError } = await db.rpc('bulk_delete_my_expenses', {
        p_expense_ids: ids,
      });
      if (rpcError) throw rpcError;
      const result = data as { deleted: number; skipped: number };
      setDeleteResult({ deleted: result.deleted, skipped: result.skipped });
      setSelected(new Set());
      setShowDeleteConfirm(false);
      await load();
    } catch {
      setDeleteResult({ deleted: 0, skipped: selected.size });
      setShowDeleteConfirm(false);
    } finally {
      setBulkDeleting(false);
    }
  };

  if (loading)
    return (
      <div className="flex justify-center py-16">
        <Spinner size={32} />
      </div>
    );
  if (error || !group)
    return (
      <div className="p-4">
        <ErrorMessage
          message={error ?? 'Group not found.'}
          retry={
            error === 'Group details could not be loaded. Please try again.'
              ? () => void load()
              : undefined
          }
        />
      </div>
    );

  const confirmedExpenses = expenses.filter(
    (e) => e.status === 'active' || e.status === 'confirmed'
  );
  const pendingExpenses = expenses.filter(
    (e) => e.status === 'pending_approval' || e.status === 'disputed'
  );
  const confirmedTotalPaise = confirmedExpenses.reduce((a, e) => a + e.amount_paise, 0);
  const pendingTotalPaise = pendingExpenses.reduce((a, e) => a + e.amount_paise, 0);
  const isAdmin =
    members.some((m) => m.user_id === user?.id && m.role === 'admin') ||
    group.creator_id === user?.id;

  return (
    <div>
      <PageHeader
        title={group.name}
        back
        actions={
          <div className="flex items-center gap-2">
            {selectMode ? (
              <>
                <button
                  type="button"
                  onClick={exitSelectMode}
                  className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm"
                  aria-label="Cancel selection"
                >
                  <X size={16} /> Cancel
                </button>
                {selected.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[rgb(var(--color-negative))] px-3 py-1.5 text-sm font-medium text-white"
                  >
                    <Trash2 size={16} /> Delete ({selected.size})
                  </button>
                )}
              </>
            ) : (
              <>
                {ownedExpenseIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectMode(true)}
                    className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm"
                    aria-label="Select expenses to delete"
                  >
                    <CheckSquare size={16} /> Select
                  </button>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setShowInviteModal(true)}
                    className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm"
                    aria-label="Invite to group"
                  >
                    <UserPlus size={16} /> Invite
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => navigate(`/expenses/new?groupId=${group.id}`)}
                  className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm"
                >
                  <Plus size={16} /> Add
                </button>
              </>
            )}
          </div>
        }
      />
      <div className="page-content space-y-4 pt-4">
        {group.description && <p className="text-secondary text-sm">{group.description}</p>}

        {/* Delete result banner */}
        {deleteResult && (
          <div
            className={`card flex items-center justify-between gap-3 border-l-4 ${deleteResult.deleted > 0 ? 'border-l-[rgb(var(--color-positive))]' : 'border-l-[rgb(var(--color-negative))]'}`}
          >
            <p className="text-primary text-sm">
              {deleteResult.deleted > 0
                ? `${deleteResult.deleted} expense${deleteResult.deleted !== 1 ? 's' : ''} deleted.`
                : 'No expenses deleted.'}
              {deleteResult.skipped > 0 &&
                ` ${deleteResult.skipped} skipped (settled or not owned).`}
            </p>
            <button
              type="button"
              onClick={() => setDeleteResult(null)}
              className="text-muted hover:text-primary flex-shrink-0"
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {selectMode && ownedExpenseIds.length > 0 && (
          <div className="flex items-center justify-between">
            <p className="text-muted text-xs">
              {selected.size} of {ownedExpenseIds.length} selected
            </p>
            <button
              type="button"
              onClick={toggleSelectAll}
              className="text-accent text-xs font-medium"
            >
              {selected.size === ownedExpenseIds.length ? 'Deselect all' : 'Select all'}
            </button>
          </div>
        )}

        <div>
          <p className="section-title mb-2">Members ({members.length})</p>
          <div className="flex flex-wrap gap-2">
            {members.map((m) => (
              <div
                key={m.user_id}
                className="bg-tertiary flex items-center gap-1.5 rounded-full px-3 py-1.5"
              >
                <Avatar
                  src={m.profile?.avatar_url}
                  name={m.profile?.display_name ?? ''}
                  size={20}
                />
                <span className="text-primary text-xs">{m.profile?.display_name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Confirmed Ledger Total */}
        <div className="card">
          <p className="text-muted mb-1 text-xs">Confirmed group expenses</p>
          <p className="text-primary text-2xl font-bold tabular-nums">
            {formatINR(confirmedTotalPaise)}
          </p>
          <p className="text-muted mt-1 text-xs">
            {confirmedExpenses.length} confirmed expense{confirmedExpenses.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Requirement F: In-Flight & Pending Breakdown */}
        {pendingExpenses.length > 0 && (
          <div className="card space-y-1.5 border-l-4 border-l-[rgb(var(--color-pending))]">
            <p className="text-muted text-xs font-semibold tracking-wider uppercase">
              In-Flight & Pending Breakdown
            </p>
            <p className="text-secondary text-xs">
              {pendingExpenses.length} expense{pendingExpenses.length !== 1 ? 's' : ''} awaiting
              participant approval ({formatINR(pendingTotalPaise)}) — excluded from confirmed
              balances until accepted.
            </p>
          </div>
        )}

        <div>
          <p className="section-title mb-2">Expenses</p>
          {expenses.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No expenses"
              description="Add the first expense for this group"
            />
          ) : (
            <div className="card overflow-hidden p-0">
              {expenses.map((e) => {
                const isOwned = e.creator_id === user?.id;
                if (selectMode) {
                  return (
                    <button
                      key={e.id}
                      type="button"
                      disabled={!isOwned}
                      onClick={() => isOwned && toggleSelect(e.id)}
                      className={`list-item w-full text-left ${!isOwned ? 'opacity-50' : ''}`}
                    >
                      <div className="mr-2 flex-shrink-0">
                        {isOwned ? (
                          selected.has(e.id) ? (
                            <CheckSquare size={18} className="text-accent" />
                          ) : (
                            <Square size={18} className="text-muted" />
                          )
                        ) : (
                          <Square size={18} className="text-muted opacity-30" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-primary truncate text-sm font-medium">{e.title}</p>
                          {e.status === 'pending_approval' && (
                            <span className="badge-pending text-[10px]">Pending approval</span>
                          )}
                          {e.status === 'disputed' && (
                            <span className="badge-negative text-[10px]">Disputed</span>
                          )}
                        </div>
                        <p className="text-muted text-xs">
                          {format(new Date(e.expense_date), 'MMM d')}
                        </p>
                      </div>
                      <p className="text-primary text-sm font-semibold tabular-nums">
                        {formatINR(e.amount_paise)}
                      </p>
                    </button>
                  );
                }
                return (
                  <Link key={e.id} to={`/expenses/${e.id}`} className="list-item">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-primary truncate text-sm font-medium">{e.title}</p>
                        {e.status === 'pending_approval' && (
                          <span className="badge-pending text-[10px]">Pending approval</span>
                        )}
                        {e.status === 'disputed' && (
                          <span className="badge-negative text-[10px]">Disputed</span>
                        )}
                      </div>
                      <p className="text-muted text-xs">
                        {format(new Date(e.expense_date), 'MMM d')}
                      </p>
                    </div>
                    <p className="text-primary text-sm font-semibold tabular-nums">
                      {formatINR(e.amount_paise)}
                    </p>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {showInviteModal && (
        <ShareInviteModal
          type="group"
          groupId={group.id}
          onClose={() => setShowInviteModal(false)}
        />
      )}

      {/* Bulk delete confirmation dialog */}
      {showDeleteConfirm && (
        <SheetDialog
          title="Delete expenses"
          onClose={() => !bulkDeleting && setShowDeleteConfirm(false)}
        >
          <div className="space-y-4 p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[rgb(var(--color-negative)/0.1)]">
                <Trash2 size={20} className="text-[rgb(var(--color-negative))]" />
              </div>
              <div>
                <h2 className="text-primary text-base font-semibold">Delete expenses</h2>
                <p className="text-muted text-sm">This cannot be undone.</p>
              </div>
            </div>

            <div className="card">
              <p className="text-primary text-sm font-semibold">
                {selected.size} expense{selected.size !== 1 ? 's' : ''} will be deleted
              </p>
              <p className="text-muted mt-1 text-xs">
                Only expenses you created and that are not part of a completed settlement will be
                deleted.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={bulkDeleting}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleBulkDelete()}
                disabled={bulkDeleting}
                className="flex-1 rounded-xl bg-[rgb(var(--color-negative))] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {bulkDeleting ? 'Deleting…' : `Delete ${selected.size}`}
              </button>
            </div>
          </div>
        </SheetDialog>
      )}
    </div>
  );
}
