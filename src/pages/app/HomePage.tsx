import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, TrendingUp, TrendingDown, ChevronRight, Bell } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { Avatar } from '../../components/ui/Avatar';
import { LogoFull } from '../../components/brand/Logo';
import type { Profile } from '../../types';

interface HomeData {
  netPaise: number;
  owedToPaise: number;
  owingPaise: number;
  balanceSummaries: FriendBalance[];
}

interface FriendBalance {
  userId: string;
  profile: Profile;
  netPaise: number;
}

interface ShareWithExpense {
  expense_id: string;
  amount_paise: number;
  expenses: {
    id: string; status: string;
    expense_payers: { user_id: string; amount_paise: number }[];
  } | null;
}

interface PaidExpense {
  expense_id: string;
  amount_paise: number;
  expenses: {
    id: string; status: string;
    expense_shares: { user_id: string; amount_paise: number }[];
  } | null;
}

interface SettlementRow {
  payer_id: string;
  recipient_id: string;
  amount_paise: number;
  status: string;
}

export function HomePage() {
  const { user, emailVerified } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    void loadHomeData();
    void loadUnreadCount();
  }, [user]);

  const loadUnreadCount = async () => {
    if (!user) return;
    const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('read_at', null);
    setUnreadCount(count ?? 0);
  };

  const loadHomeData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: sharesData } = await supabase
        .from('expense_shares')
        .select('expense_id, amount_paise, expenses (id, status, expense_payers (user_id, amount_paise))')
        .eq('user_id', user.id);
      const shares = (sharesData ?? []) as unknown as ShareWithExpense[];

      const { data: settlementsData } = await supabase
        .from('settlements')
        .select('payer_id, recipient_id, amount_paise, status')
        .or(`payer_id.eq.${user.id},recipient_id.eq.${user.id}`)
        .eq('status', 'confirmed');
      const settlements = (settlementsData ?? []) as unknown as SettlementRow[];

      const pairBalances = new Map<string, number>();

      for (const share of shares) {
        const expense = share.expenses;
        if (!expense || expense.status !== 'active') continue;
        for (const payer of (expense.expense_payers ?? [])) {
          if (payer.user_id === user.id) continue;
          const current = pairBalances.get(payer.user_id) ?? 0;
          pairBalances.set(payer.user_id, current - share.amount_paise);
        }
      }

      const { data: myPaidData } = await supabase
        .from('expense_payers')
        .select('expense_id, amount_paise, expenses (id, status, expense_shares (user_id, amount_paise))')
        .eq('user_id', user.id);
      const myPaidShares = (myPaidData ?? []) as unknown as PaidExpense[];

      for (const pe of myPaidShares) {
        const expense = pe.expenses;
        if (!expense || expense.status !== 'active') continue;
        for (const share of (expense.expense_shares ?? [])) {
          if (share.user_id === user.id) continue;
          const current = pairBalances.get(share.user_id) ?? 0;
          pairBalances.set(share.user_id, current + share.amount_paise);
        }
      }

      for (const s of settlements) {
        if (s.payer_id === user.id) {
          const current = pairBalances.get(s.recipient_id) ?? 0;
          pairBalances.set(s.recipient_id, current + s.amount_paise);
        } else {
          const current = pairBalances.get(s.payer_id) ?? 0;
          pairBalances.set(s.payer_id, current - s.amount_paise);
        }
      }

      const otherIds = [...pairBalances.keys()];
      let profiles: Profile[] = [];
      if (otherIds.length > 0) {
        const { data: profileData } = await supabase.from('profiles').select('*').in('id', otherIds.slice(0, 10));
        profiles = (profileData ?? []) as unknown as Profile[];
      }

      let owedToPaise = 0;
      let owingPaise = 0;
      const balanceSummaries: FriendBalance[] = [];

      for (const [userId, amount] of pairBalances) {
        if (Math.abs(amount) < 1) continue;
        if (amount > 0) owedToPaise += amount;
        else owingPaise += Math.abs(amount);
        const prof = profiles.find(p => p.id === userId);
        if (prof) balanceSummaries.push({ userId, profile: prof, netPaise: amount });
      }

      balanceSummaries.sort((a, b) => Math.abs(b.netPaise) - Math.abs(a.netPaise));
      setData({ netPaise: owedToPaise - owingPaise, owedToPaise, owingPaise, balanceSummaries: balanceSummaries.slice(0, 5) });
    } finally {
      setLoading(false);
    }
  };

  const netClass = !data ? '' : data.netPaise > 0 ? 'amount-positive' : data.netPaise < 0 ? 'amount-negative' : 'amount-neutral';

  return (
    <div className="page-content">
      <header className="flex items-center justify-between mb-6">
        <LogoFull />
        <Link to="/notifications" className="relative btn-ghost p-2 rounded-full" aria-label="Notifications">
          <Bell size={20} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[rgb(var(--color-accent))] text-white rounded-full text-[10px] flex items-center justify-center font-bold">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Link>
      </header>

      {!emailVerified && (
        <div className="rounded-lg p-3 mb-4 bg-[rgb(var(--color-pending)/0.1)] border border-[rgb(var(--color-pending)/0.3)]">
          <p className="text-sm text-[rgb(var(--color-pending))]">Verify your email to send invites, join groups, and create expenses.</p>
        </div>
      )}

      <div className="card mb-6">
        <div className="text-center py-4">
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Net balance</p>
          {loading ? <div className="skeleton h-10 w-32 mx-auto" /> : (
            <p className={`text-4xl font-bold ${netClass}`}>{formatINR(data?.netPaise ?? 0)}</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div className="rounded-lg p-3 bg-[rgb(var(--color-positive)/0.08)]">
            <div className="flex items-center gap-1.5 mb-1"><TrendingUp size={14} className="text-[rgb(var(--color-positive))]" /><span className="text-xs text-muted">Owed to you</span></div>
            {loading ? <div className="skeleton h-6 w-20" /> : <p className="text-lg font-semibold text-[rgb(var(--color-positive))]">{formatINR(data?.owedToPaise ?? 0)}</p>}
          </div>
          <div className="rounded-lg p-3 bg-[rgb(var(--color-negative)/0.08)]">
            <div className="flex items-center gap-1.5 mb-1"><TrendingDown size={14} className="text-[rgb(var(--color-negative))]" /><span className="text-xs text-muted">You owe</span></div>
            {loading ? <div className="skeleton h-6 w-20" /> : <p className="text-lg font-semibold text-[rgb(var(--color-negative))]">{formatINR(data?.owingPaise ?? 0)}</p>}
          </div>
        </div>
      </div>

      {!loading && data && data.balanceSummaries.length > 0 && (
        <div className="mb-6">
          <p className="section-title mb-3">Balances</p>
          <div className="card p-0 overflow-hidden">
            {data.balanceSummaries.map((b) => (
              <Link key={b.userId} to={`/friends/${b.userId}`} className="list-item">
                <Avatar src={b.profile.avatar_url} name={b.profile.display_name} size={36} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-primary truncate">{b.profile.display_name}</p>
                  <p className="text-xs text-muted">{b.netPaise > 0 ? 'owes you' : 'you owe'}</p>
                </div>
                <p className={b.netPaise > 0 ? 'amount-positive text-sm' : 'amount-negative text-sm'}>{formatINR(Math.abs(b.netPaise))}</p>
                <ChevronRight size={16} className="text-muted flex-shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      )}

      <button onClick={() => navigate('/expenses/new')} className="btn-primary fixed bottom-[calc(72px+env(safe-area-inset-bottom))] right-4 shadow-lg rounded-full px-5 py-3 z-30" aria-label="Add expense">
        <Plus size={20} /> Add expense
      </button>
    </div>
  );
}
