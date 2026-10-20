import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, ChevronRight, Bell, Users, ArrowUpRight, ArrowDownLeft, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { Avatar } from '../../components/ui/Avatar';
import { LogoFull } from '../../components/brand/Logo';
import type { Profile } from '../../types';

interface FriendBalance {
  userId: string;
  profile: Profile;
  netPaise: number; // positive = they owe you, negative = you owe them
}

interface HomeData {
  netPaise: number;       // overall: positive = you are owed, negative = you owe
  owedToPaise: number;    // total others owe you (confirmed)
  owingPaise: number;     // total you owe others (confirmed)
  youOwe: FriendBalance[];      // negative netPaise: you owe them
  owedToYou: FriendBalance[];   // positive netPaise: they owe you
}

type LoadState = 'loading' | 'loaded' | 'error' | 'empty';

export function HomePage() {
  const { user, emailVerified } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<HomeData | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [unreadCount, setUnreadCount] = useState(0);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const loadHomeData = useCallback(async () => {
    if (!user) return;
    setLoadState('loading');
    try {
      const { data: balances, error: rpcError } = await supabase.rpc('get_friend_balances');
      if (rpcError) throw rpcError;

      const rawBalances = (balances ?? []) as { other_user_id: string; net_paise: number }[];

      if (rawBalances.length === 0) {
        setData({ netPaise: 0, owedToPaise: 0, owingPaise: 0, youOwe: [], owedToYou: [] });
        setLoadState('empty');
        return;
      }

      const otherIds = rawBalances.map(b => b.other_user_id);
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .in('id', otherIds);
      const profiles = (profileData ?? []) as unknown as Profile[];

      let owedToPaise = 0;
      let owingPaise = 0;
      const youOwe: FriendBalance[] = [];
      const owedToYou: FriendBalance[] = [];

      for (const b of rawBalances) {
        if (Math.abs(b.net_paise) < 1) continue; // ignore sub-paise noise
        const prof = profiles.find(p => p.id === b.other_user_id);
        if (!prof) continue;

        const entry: FriendBalance = { userId: b.other_user_id, profile: prof, netPaise: b.net_paise };

        if (b.net_paise > 0) {
          owedToPaise += b.net_paise;
          owedToYou.push(entry);
        } else {
          owingPaise += Math.abs(b.net_paise);
          youOwe.push(entry);
        }
      }

      // Sort by absolute amount descending for priority display
      owedToYou.sort((a, b) => b.netPaise - a.netPaise);
      youOwe.sort((a, b) => Math.abs(b.netPaise) - Math.abs(a.netPaise));

      setData({
        netPaise: owedToPaise - owingPaise,
        owedToPaise,
        owingPaise,
        youOwe: youOwe.slice(0, 5),
        owedToYou: owedToYou.slice(0, 5),
      });
      setLastRefreshed(new Date());
      setLoadState('loaded');
    } catch {
      setLoadState('error');
    }
  }, [user]);

  const loadUnreadCount = useCallback(async () => {
    if (!user) return;
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('read_at', null);
    setUnreadCount(count ?? 0);
  }, [user]);

  useEffect(() => {
    void loadHomeData();
    void loadUnreadCount();
  }, [loadHomeData, loadUnreadCount]);

  const isLoading = loadState === 'loading';
  const hasError = loadState === 'error';
  const isEmpty = loadState === 'empty' || (data && data.owedToPaise === 0 && data.owingPaise === 0);

  return (
    <div className="page-content">
      {/* Header */}
      <header className="flex items-center justify-between mb-6">
        <LogoFull />
        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadHomeData()}
            className="btn-ghost p-2 rounded-full"
            aria-label="Refresh balances"
            disabled={isLoading}
          >
            <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <Link to="/notifications" className="relative btn-ghost p-2 rounded-full" aria-label="Notifications">
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[rgb(var(--color-accent))] text-white rounded-full text-[10px] flex items-center justify-center font-bold" aria-label={`${unreadCount} unread notifications`}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Link>
        </div>
      </header>

      {/* Email verification warning */}
      {!emailVerified && (
        <div className="rounded-lg p-3 mb-4 bg-[rgb(var(--color-pending)/0.1)] border border-[rgb(var(--color-pending)/0.3)]" role="alert">
          <p className="text-sm text-[rgb(var(--color-pending))]">
            📧 Verify your email to send invites, join groups, and create expenses.
          </p>
        </div>
      )}

      {/* Error state */}
      {hasError && (
        <div className="rounded-lg p-4 mb-4 bg-[rgb(var(--color-negative)/0.08)] border border-[rgb(var(--color-negative)/0.2)]" role="alert">
          <p className="text-sm font-medium text-[rgb(var(--color-negative))] mb-2">Could not load balances</p>
          <p className="text-xs text-muted mb-3">Check your connection and try again.</p>
          <button onClick={() => void loadHomeData()} className="btn-secondary text-sm">
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      )}

      {/* Overall balance summary card */}
      <div className="card mb-4" aria-label="Overall balance summary">
        <div className="text-center py-2 mb-4">
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Overall balance</p>
          {isLoading ? (
            <div className="skeleton h-10 w-36 mx-auto" aria-hidden="true" />
          ) : isEmpty ? (
            <p className="text-3xl font-bold text-[rgb(var(--color-text-secondary))]">All settled up</p>
          ) : (
            <p className={`text-4xl font-bold tabular-nums ${
              (data?.netPaise ?? 0) > 0
                ? 'text-[rgb(var(--color-positive))]'
                : (data?.netPaise ?? 0) < 0
                  ? 'text-[rgb(var(--color-negative))]'
                  : 'text-secondary'
            }`}>
              {data ? (
                data.netPaise > 0
                  ? `+${formatINR(data.netPaise)}`
                  : data.netPaise < 0
                    ? `-${formatINR(Math.abs(data.netPaise))}`
                    : '₹0.00'
              ) : '₹0.00'}
            </p>
          )}
          {!isLoading && !isEmpty && data && (
            <p className="text-xs text-muted mt-1">
              {data.netPaise > 0
                ? 'You are owed more than you owe'
                : data.netPaise < 0
                  ? 'You owe more than you are owed'
                  : 'Your debts and credits cancel out'}
            </p>
          )}
        </div>

        {/* Two-column breakdown */}
        <div className="grid grid-cols-2 gap-3">
          {/* Owed to you */}
          <div className="rounded-lg p-3 bg-[rgb(var(--color-positive)/0.08)]" aria-label="Amount owed to you">
            <div className="flex items-center gap-1.5 mb-1">
              <ArrowDownLeft size={14} className="text-[rgb(var(--color-positive))]" aria-hidden="true" />
              <span className="text-xs text-muted">Owed to you</span>
            </div>
            {isLoading
              ? <div className="skeleton h-6 w-20" aria-hidden="true" />
              : <p className="text-lg font-semibold text-[rgb(var(--color-positive))] tabular-nums">{formatINR(data?.owedToPaise ?? 0)}</p>
            }
            {!isLoading && (data?.owedToYou.length ?? 0) > 0 && (
              <p className="text-xs text-muted mt-0.5">from {data!.owedToYou.length} {data!.owedToYou.length === 1 ? 'person' : 'people'}</p>
            )}
          </div>

          {/* You owe */}
          <div className="rounded-lg p-3 bg-[rgb(var(--color-negative)/0.08)]" aria-label="Amount you owe">
            <div className="flex items-center gap-1.5 mb-1">
              <ArrowUpRight size={14} className="text-[rgb(var(--color-negative))]" aria-hidden="true" />
              <span className="text-xs text-muted">You owe</span>
            </div>
            {isLoading
              ? <div className="skeleton h-6 w-20" aria-hidden="true" />
              : <p className="text-lg font-semibold text-[rgb(var(--color-negative))] tabular-nums">{formatINR(data?.owingPaise ?? 0)}</p>
            }
            {!isLoading && (data?.youOwe.length ?? 0) > 0 && (
              <p className="text-xs text-muted mt-0.5">to {data!.youOwe.length} {data!.youOwe.length === 1 ? 'person' : 'people'}</p>
            )}
          </div>
        </div>
      </div>

      {/* Who you need to pay */}
      {!isLoading && (data?.youOwe.length ?? 0) > 0 && (
        <div className="mb-4">
          <p className="section-title mb-2 flex items-center gap-1.5">
            <ArrowUpRight size={14} className="text-[rgb(var(--color-negative))]" aria-hidden="true" />
            Who you need to pay
          </p>
          <div className="card p-0 overflow-hidden" role="list">
            {data!.youOwe.map((b) => (
              <Link
                key={b.userId}
                to={`/friends/${b.userId}`}
                className="list-item"
                role="listitem"
                aria-label={`You owe ${b.profile.display_name} ${formatINR(Math.abs(b.netPaise))}`}
              >
                <Avatar src={b.profile.avatar_url} name={b.profile.display_name} size={36} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-primary truncate">{b.profile.display_name}</p>
                  <p className="text-xs text-muted">You owe them</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-[rgb(var(--color-negative))] tabular-nums">{formatINR(Math.abs(b.netPaise))}</p>
                  <p className="text-xs text-muted">Settle up →</p>
                </div>
                <ChevronRight size={16} className="text-muted flex-shrink-0" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Who owes you */}
      {!isLoading && (data?.owedToYou.length ?? 0) > 0 && (
        <div className="mb-4">
          <p className="section-title mb-2 flex items-center gap-1.5">
            <ArrowDownLeft size={14} className="text-[rgb(var(--color-positive))]" aria-hidden="true" />
            Who owes you
          </p>
          <div className="card p-0 overflow-hidden" role="list">
            {data!.owedToYou.map((b) => (
              <Link
                key={b.userId}
                to={`/friends/${b.userId}`}
                className="list-item"
                role="listitem"
                aria-label={`${b.profile.display_name} owes you ${formatINR(b.netPaise)}`}
              >
                <Avatar src={b.profile.avatar_url} name={b.profile.display_name} size={36} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-primary truncate">{b.profile.display_name}</p>
                  <p className="text-xs text-muted">Owes you</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-[rgb(var(--color-positive))] tabular-nums">{formatINR(b.netPaise)}</p>
                  <p className="text-xs text-muted">Request →</p>
                </div>
                <ChevronRight size={16} className="text-muted flex-shrink-0" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Empty state for new users */}
      {!isLoading && isEmpty && !hasError && (
        <div className="card text-center py-8">
          <div className="w-16 h-16 rounded-2xl bg-[rgb(var(--color-accent)/0.1)] flex items-center justify-center mx-auto mb-4">
            <Users size={32} className="text-[rgb(var(--color-accent))]" aria-hidden="true" />
          </div>
          <h2 className="text-base font-semibold text-primary mb-2">No outstanding balances</h2>
          <p className="text-sm text-muted mb-4 max-w-xs mx-auto">
            Add a friend and create your first expense to start tracking who owes what.
          </p>
          <div className="flex flex-col gap-2 max-w-xs mx-auto">
            <Link to="/friends" className="btn-primary">Add a friend</Link>
            <button onClick={() => navigate('/expenses/new')} className="btn-secondary">Add an expense</button>
          </div>
        </div>
      )}

      {/* Loading state list skeleton */}
      {isLoading && (
        <div className="space-y-3" aria-busy="true" aria-label="Loading balances">
          {[1, 2, 3].map(i => (
            <div key={i} className="card flex items-center gap-3">
              <div className="skeleton w-9 h-9 rounded-full flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="skeleton h-4 w-32" />
                <div className="skeleton h-3 w-20" />
              </div>
              <div className="skeleton h-5 w-16" />
            </div>
          ))}
        </div>
      )}

      {/* Last synced indicator */}
      {lastRefreshed && !isLoading && (
        <p className="text-xs text-muted text-center mt-4">
          Updated {lastRefreshed.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}

      {/* Add expense FAB */}
      <button
        onClick={() => navigate('/expenses/new')}
        className="btn-primary fixed bottom-[calc(72px+env(safe-area-inset-bottom))] right-4 shadow-lg rounded-full px-5 py-3 z-30"
        aria-label="Add expense"
      >
        <Plus size={20} aria-hidden="true" /> Add expense
      </button>
    </div>
  );
}
