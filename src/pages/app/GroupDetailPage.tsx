import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Plus, Receipt } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { PageHeader } from '../../components/layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { EmptyState } from '../../components/ui/EmptyState';
import { format } from 'date-fns';
import type { Group, GroupMember, Profile, Expense } from '../../types';

export function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Array<GroupMember & { profile: Profile }>>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    try {
      const [{ data: g }, { data: m }, { data: e }] = await Promise.all([
        supabase.from('groups').select('*').eq('id', groupId).single(),
        supabase.from('group_members').select('*, profile:user_id (id, display_name, avatar_url, username)').eq('group_id', groupId).is('removed_at', null),
        supabase.from('expenses').select('id, title, amount_paise, expense_date, status').eq('group_id', groupId).eq('status', 'active').order('expense_date', { ascending: false }).limit(20),
      ]);
      if (!g) { setError('Group not found.'); return; }
      setGroup(g);
      setMembers((m ?? []) as unknown as Array<GroupMember & { profile: Profile }>);
      setExpenses(e ?? []);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="flex justify-center py-16"><Spinner size={32} /></div>;
  if (error || !group) return <div className="p-4"><ErrorMessage message={error ?? 'Not found'} /></div>;

  const totalPaise = expenses.reduce((a, e) => a + e.amount_paise, 0);

  return (
    <div>
      <PageHeader title={group.name} back actions={
        <button onClick={() => navigate(`/expenses/new?groupId=${group.id}`)} className="btn-primary px-3 py-1.5 text-sm">
          <Plus size={16} /> Add
        </button>
      } />
      <div className="page-content pt-4 space-y-4">
        {group.description && <p className="text-sm text-secondary">{group.description}</p>}

        <div>
          <p className="section-title mb-2">Members ({members.length})</p>
          <div className="flex gap-2 flex-wrap">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center gap-1.5 bg-tertiary rounded-full px-3 py-1.5">
                <Avatar src={m.profile?.avatar_url} name={m.profile?.display_name ?? ''} size={20} />
                <span className="text-xs text-primary">{m.profile?.display_name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <p className="text-xs text-muted mb-1">Total expenses</p>
          <p className="text-2xl font-bold text-primary tabular-nums">{formatINR(totalPaise)}</p>
          <p className="text-xs text-muted mt-1">{expenses.length} expense{expenses.length !== 1 ? 's' : ''}</p>
        </div>

        <div>
          <p className="section-title mb-2">Expenses</p>
          {expenses.length === 0 ? (
            <EmptyState icon={Receipt} title="No expenses" description="Add the first expense for this group" />
          ) : (
            <div className="card p-0 overflow-hidden">
              {expenses.map((e) => (
                <Link key={e.id} to={`/expenses/${e.id}`} className="list-item">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-primary truncate">{e.title}</p>
                    <p className="text-xs text-muted">{format(new Date(e.expense_date), 'MMM d')}</p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-primary">{formatINR(e.amount_paise)}</p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
