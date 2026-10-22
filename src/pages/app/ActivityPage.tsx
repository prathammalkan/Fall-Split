import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Receipt, Handshake, Download } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { PageHeader } from '../../components/layout/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { Spinner } from '../../components/ui/Spinner';
import { format } from 'date-fns';

interface ActivityItem {
  id: string;
  type: 'expense' | 'settlement';
  title: string;
  amountPaise: number;
  date: string;
  isPositive: boolean;
  link?: string;
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

export function ActivityPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'expenses' | 'settlements'>('all');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const activityItems: ActivityItem[] = [];

      // Load expenses user is involved in
      const [{ data: paidExpensesRaw }, { data: shareExpensesRaw }] = await Promise.all([
        supabase
          .from('expense_payers')
          .select(
            'expense_id, amount_paise, expenses (id, title, amount_paise, expense_date, status)'
          )
          .eq('user_id', user.id)
          .order('expense_id'),
        supabase
          .from('expense_shares')
          .select(
            'expense_id, amount_paise, expenses (id, title, amount_paise, expense_date, status)'
          )
          .eq('user_id', user.id)
          .order('expense_id'),
      ]);

      const paidExpenses = (paidExpensesRaw ?? []) as unknown as ExpenseJoinRow[];
      const shareExpenses = (shareExpensesRaw ?? []) as unknown as ExpenseJoinRow[];

      // Build set of expenses where user is a payer (positive — they covered money)
      const paidExpenseIds = new Set<string>(paidExpenses.map((r) => r.expense_id));

      const expenseIds = new Set<string>();
      for (const row of [...paidExpenses, ...shareExpenses]) {
        const exp = row.expenses;
        if (!exp || exp.status !== 'active' || expenseIds.has(exp.id)) continue;
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
        });
      }

      // Load settlements
      const { data: settlementsRaw } = await supabase
        .from('settlements')
        .select('id, payer_id, recipient_id, amount_paise, status, created_at, notes')
        .or(`payer_id.eq.${user.id},recipient_id.eq.${user.id}`)
        .in('status', ['confirmed', 'proposed', 'pending']);

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

      // Sort by date desc
      activityItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setItems(activityItems);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = items.filter(
    (i) => filter === 'all' || i.type === (filter === 'expenses' ? 'expense' : 'settlement')
  );

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
          <button
            onClick={exportCSV}
            className="btn-ghost rounded-full p-2"
            aria-label="Export CSV"
          >
            <Download size={20} />
          </button>
        }
      />
      <div className="page-content pt-4">
        {/* Filter tabs */}
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

        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner size={24} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No activity yet"
            description="Add an expense to get started"
          />
        ) : (
          <div className="card overflow-hidden p-0">
            {filtered.map((item) => (
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
                  <p className="text-muted text-xs">{format(new Date(item.date), 'MMM d, yyyy')}</p>
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
