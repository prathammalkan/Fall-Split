import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Plus, Receipt, UserPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { PageHeader } from '../../components/layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { EmptyState } from '../../components/ui/EmptyState';
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
          .select('id, title, amount_paise, expense_date, status')
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
          </div>
        }
      />
      <div className="page-content space-y-4 pt-4">
        {group.description && <p className="text-secondary text-sm">{group.description}</p>}

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
              {expenses.map((e) => (
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
              ))}
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
    </div>
  );
}
