import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  Receipt,
  Handshake,
  Download,
  Trash2,
  CheckSquare,
  Square,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, db } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { PageHeader } from '../../components/layout/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { Spinner } from '../../components/ui/Spinner';
import { SheetDialog } from '../../components/ui/SheetDialog';
import { format } from 'date-fns';

interface ActivityItem {
  id: string;
  type: 'expense' | 'settlement';
  title: string;
  amountPaise: number;
  date: string;
  isPositive: boolean;
  link?: string;
  isOwned?: boolean; // true if the current user is the creator of this expense
}

interface ExpenseJoinRow {
  expense_id: string;
  amount_paise: number;
  expenses: {
    id: string;
    title: string;
    amount_paise: number;
    expense_date: string;
    status: string;
    creator_id: string;
  } | null;
}

interface SettlementRow {
  id: string;
  payer_id: string;
  recipient_id: string;
  amount_paise: number;
  status: string;
  created_at: string;
  notes: string | null;
}

const PAGE_SIZE = 50;

export function ActivityPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'expenses' | 'settlements'>('all');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);

  // Bulk delete state
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const [bulkDeleteResult, setBulkDeleteResult] = useState<{
    deleted: number;
    skipped: number;
  } | null>(null);

  const load = useCallback(
    async (currentLimit = limit) => {
      if (!user) return;
      if (currentLimit === PAGE_SIZE) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError(null);
      try {
        const activityItems: ActivityItem[] = [];

        // Load expenses user is involved in (bounded to currentLimit per query)
        const [paidExpensesResult, shareExpensesResult] = await Promise.all([
          supabase
            .from('expense_payers')
            .select(
              'expense_id, amount_paise, expenses (id, title, amount_paise, expense_date, status, creator_id)'
            )
            .eq('user_id', user.id)
            .order('expense_id', { ascending: false })
            .limit(currentLimit),
          supabase
            .from('expense_shares')
            .select(
              'expense_id, amount_paise, expenses (id, title, amount_paise, expense_date, status, creator_id)'
            )
            .eq('user_id', user.id)
            .order('expense_id', { ascending: false })
            .limit(currentLimit),
        ]);

        if (paidExpensesResult.error || shareExpensesResult.error) {
          setError('Activity could not be loaded. Please try again.');
          setItems([]);
          return;
        }

        const { data: paidExpensesRaw } = paidExpensesResult;
        const { data: shareExpensesRaw } = shareExpensesResult;

        const paidExpenses = (paidExpensesRaw ?? []) as unknown as ExpenseJoinRow[];
        const shareExpenses = (shareExpensesRaw ?? []) as unknown as ExpenseJoinRow[];

        // Build set of expenses where user is a payer (positive — they covered money)
        const paidExpenseIds = new Set<string>(paidExpenses.map((r) => r.expense_id));

        // Ensure related payer records are not omitted because independent queries have separate limits
        const missingPayerCheckIds = Array.from(
          new Set(shareExpenses.map((r) => r.expense_id).filter((id) => !paidExpenseIds.has(id)))
        );
        if (missingPayerCheckIds.length > 0) {
          const { data: additionalPayers } = await supabase
            .from('expense_payers')
            .select('expense_id')
            .eq('user_id', user.id)
            .in('expense_id', missingPayerCheckIds);
          if (additionalPayers) {
            for (const p of additionalPayers as { expense_id: string }[]) {
              paidExpenseIds.add(p.expense_id);
            }
          }
        }

        const expenseIds = new Set<string>();
        for (const row of [...paidExpenses, ...shareExpenses]) {
          const exp = row.expenses;
          if (
            !exp ||
            (exp.status !== 'active' && exp.status !== 'confirmed') ||
            expenseIds.has(exp.id)
          )
            continue;
          expenseIds.add(exp.id);
          activityItems.push({
            id: exp.id,
            type: 'expense',
            title: exp.title,
            amountPaise: exp.amount_paise,
            date: exp.expense_date,
            // Positive (green) = user paid for this expense (covered costs for others)
            // Negative (red) = user only owes a share but didn't pay
            isPositive: paidExpenseIds.has(exp.id),
            link: `/expenses/${exp.id}`,
            isOwned: exp.creator_id === user.id,
          });
        }

        // Load settlements (bounded to currentLimit)
        const { data: settlementsRaw, error: settlementsError } = await supabase
          .from('settlements')
          .select('id, payer_id, recipient_id, amount_paise, status, created_at, notes')
          .or(`payer_id.eq.${user.id},recipient_id.eq.${user.id}`)
          .in('status', ['confirmed', 'proposed', 'pending'])
          .order('created_at', { ascending: false })
          .limit(currentLimit);

        if (settlementsError) {
          setError('Activity could not be loaded. Please try again.');
          setItems([]);
          return;
        }

        const settlements = (settlementsRaw ?? []) as unknown as SettlementRow[];

        for (const s of settlements) {
          const isPayer = s.payer_id === user.id;
          activityItems.push({
            id: s.id,
            type: 'settlement',
            title: isPayer ? 'You paid' : 'Payment received',
            amountPaise: s.amount_paise,
            date: s.created_at,
            isPositive: !isPayer,
            link: `/settlements`,
          });
        }

        // Check if any bounded query reached the current limit, indicating older records exist
        const isPartial =
          (paidExpensesRaw?.length ?? 0) >= currentLimit ||
          (shareExpensesRaw?.length ?? 0) >= currentLimit ||
          (settlementsRaw?.length ?? 0) >= currentLimit;
        setHasMore(isPartial);

        // Sort by date desc
        activityItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setItems(activityItems);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [user, limit]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = items.filter(
    (i) => filter === 'all' || i.type === (filter === 'expenses' ? 'expense' : 'settlement')
  );

  // Items eligible for selection: only creator-owned expenses
  const selectableItems = filtered.filter((i) => i.type === 'expense' && i.isOwned);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const selectableIds = selectableItems.map((i) => i.id);
    const allSelected = selectableIds.every((id) => selected.has(id));
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableIds));
    }
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
    setBulkDeleteError(null);
    setBulkDeleteResult(null);
  };

  const handleBulkDelete = async () => {
    if (!user || selected.size === 0) return;
    setBulkDeleting(true);
    setBulkDeleteError(null);
    try {
      const ids = Array.from(selected);
      const { data, error: rpcError } = await db.rpc('bulk_delete_my_expenses', {
        p_expense_ids: ids,
      });
      if (rpcError) {
        setBulkDeleteError(rpcError.message || 'Failed to delete expenses. Please try again.');
        return;
      }
      const result = data as { deleted: number; skipped: number } | null;
      setBulkDeleteResult({ deleted: result?.deleted ?? 0, skipped: result?.skipped ?? 0 });
      setShowDeleteConfirm(false);
      setSelectMode(false);
      setSelected(new Set());
      // Reload activity after deletion
      void load(PAGE_SIZE);
      setLimit(PAGE_SIZE);
    } catch (err) {
      setBulkDeleteError(
        err instanceof Error ? err.message : 'Failed to delete expenses. Please try again.'
      );
    } finally {
      setBulkDeleting(false);
    }
  };

  const exportCSV = () => {
    const headers = ['Date', 'Type', 'Title', 'Amount (INR)'];
    const rows = filtered.map((i) => [
      i.date.substring(0, 10),
      i.type,
      // Escape for CSV injection
      `"${i.title.replace(/[-"|=+@]/g, (c) => `'${c}`).replace(/"/g, '""')}"`,
      (i.amountPaise / 100).toFixed(2),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fall-split-activity-${new Date().toISOString().substring(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="Activity"
        actions={
          <div className="flex items-center gap-1">
            {selectMode ? (
              <button
                type="button"
                onClick={exitSelectMode}
                className="btn-ghost rounded-full p-2"
                aria-label="Exit selection mode"
              >
                <X size={20} />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setSelectMode(true);
                    setFilter('expenses');
                  }}
                  className="btn-ghost rounded-full p-2"
                  aria-label="Select expenses to delete"
                  title="Select to delete"
                >
                  <CheckSquare size={20} />
                </button>
                <button
                  onClick={exportCSV}
                  className="btn-ghost rounded-full p-2"
                  aria-label="Export CSV"
                >
                  <Download size={20} />
                </button>
              </>
            )}
          </div>
        }
      />
      <div className="page-content pt-4">
        {/* Bulk result banner */}
        {bulkDeleteResult && (
          <div
            className="mb-4 flex items-center justify-between rounded-lg border border-[rgb(var(--color-positive)/0.3)] bg-[rgb(var(--color-positive)/0.1)] p-3"
            role="status"
          >
            <p className="text-sm font-medium text-[rgb(var(--color-positive))]">
              {bulkDeleteResult.deleted} expense{bulkDeleteResult.deleted !== 1 ? 's' : ''} deleted
              {bulkDeleteResult.skipped > 0 && `, ${bulkDeleteResult.skipped} skipped`}.
            </p>
            <button
              type="button"
              onClick={() => setBulkDeleteResult(null)}
              className="text-muted"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Select mode toolbar */}
        {selectMode && (
          <div className="mb-4 rounded-xl border border-[rgb(var(--color-border))] bg-[rgb(var(--color-bg-secondary))] p-3">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={toggleSelectAll}
                className="flex items-center gap-2 text-sm font-medium text-[rgb(var(--color-text-secondary))]"
              >
                {selectableItems.length > 0 && selectableItems.every((i) => selected.has(i.id)) ? (
                  <CheckSquare size={16} className="text-[rgb(var(--color-accent))]" />
                ) : (
                  <Square size={16} />
                )}
                {selected.size > 0 ? `${selected.size} selected` : 'Select all mine'}
              </button>
              {selected.size > 0 && (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[rgb(var(--color-negative))] px-3 py-1.5 text-xs font-semibold text-white"
                  aria-label={`Delete ${selected.size} selected expenses`}
                >
                  <Trash2 size={14} />
                  Delete {selected.size}
                </button>
              )}
            </div>
            <p className="text-muted mt-1.5 text-xs">
              Only expenses you created can be selected. Tap to select.
            </p>
          </div>
        )}

        {/* Filter tabs */}
        {!selectMode && (
          <div className="mb-4 flex gap-2">
            {(['all', 'expenses', 'settlements'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  filter === f
                    ? 'bg-[rgb(var(--color-accent))] text-white'
                    : 'bg-tertiary text-secondary'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner size={24} />
          </div>
        ) : error ? (
          <ErrorMessage message={error} retry={() => void load()} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No activity yet"
            description="Add an expense to get started"
          />
        ) : (
          <div>
            <div className="card overflow-hidden p-0">
              {filtered.map((item) => {
                const isSelectable = selectMode && item.type === 'expense' && item.isOwned;
                const isSelected = selected.has(item.id);
                return selectMode ? (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => isSelectable && toggleSelect(item.id)}
                    disabled={!isSelectable}
                    className={`list-item w-full text-left ${
                      isSelected ? 'bg-[rgb(var(--color-accent)/0.08)]' : ''
                    } ${!isSelectable ? 'opacity-50' : ''}`}
                    aria-pressed={isSelectable ? isSelected : undefined}
                    aria-label={
                      isSelectable
                        ? `${isSelected ? 'Deselect' : 'Select'} ${item.title}`
                        : `${item.title} (not selectable)`
                    }
                  >
                    <div className="flex-shrink-0">
                      {isSelectable ? (
                        isSelected ? (
                          <CheckSquare
                            size={18}
                            className="text-[rgb(var(--color-accent))]"
                            aria-hidden="true"
                          />
                        ) : (
                          <Square size={18} className="text-muted" aria-hidden="true" />
                        )
                      ) : (
                        <div
                          className="bg-tertiary flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
                          aria-hidden="true"
                        >
                          {item.type === 'expense' ? (
                            <Receipt size={16} className="text-muted" />
                          ) : (
                            <Handshake size={16} className="text-muted" />
                          )}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-primary truncate text-sm font-medium">{item.title}</p>
                      <p className="text-muted text-xs">
                        {format(new Date(item.date), 'MMM d, yyyy')}
                        {item.type === 'settlement' && ' · Settlement'}
                      </p>
                    </div>
                    <p
                      className={
                        item.isPositive ? 'amount-positive text-sm' : 'amount-negative text-sm'
                      }
                    >
                      {item.isPositive ? '+' : '-'}
                      {formatINR(item.amountPaise)}
                    </p>
                  </button>
                ) : (
                  <Link key={item.id} to={item.link ?? '#'} className="list-item">
                    <div className="bg-tertiary flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg">
                      {item.type === 'expense' ? (
                        <Receipt size={16} className="text-muted" />
                      ) : (
                        <Handshake size={16} className="text-muted" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-primary truncate text-sm font-medium">{item.title}</p>
                      <p className="text-muted text-xs">
                        {format(new Date(item.date), 'MMM d, yyyy')}
                      </p>
                    </div>
                    <p
                      className={
                        item.isPositive ? 'amount-positive text-sm' : 'amount-negative text-sm'
                      }
                    >
                      {item.isPositive ? '+' : '-'}
                      {formatINR(item.amountPaise)}
                    </p>
                  </Link>
                );
              })}
            </div>

            {hasMore && (
              <div className="mt-4 flex flex-col items-center justify-center gap-2 pb-4 text-center">
                <p className="text-muted text-xs">Showing recent activity. Older records exist.</p>
                <button
                  type="button"
                  onClick={() => {
                    const nextLimit = limit + PAGE_SIZE;
                    setLimit(nextLimit);
                    void load(nextLimit);
                  }}
                  disabled={loadingMore}
                  className="btn-secondary rounded-lg px-4 py-2 text-xs font-medium"
                >
                  {loadingMore ? 'Loading older activity...' : 'Load older activity'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

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
                Only your created expenses will be deleted. Any expense with a pending settlement
                between participants will be skipped. Audit history is preserved.
              </p>
            </div>

            {bulkDeleteError && <ErrorMessage message={bulkDeleteError} />}

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
                className="btn-danger flex-1"
              >
                {bulkDeleting ? (
                  <Spinner size={16} />
                ) : (
                  <>
                    <Trash2 size={16} /> Delete {selected.size}
                  </>
                )}
              </button>
            </div>
          </div>
        </SheetDialog>
      )}
    </div>
  );
}
