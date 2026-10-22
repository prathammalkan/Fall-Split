import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus,
  ChevronRight,
  Bell,
  Users,
  ArrowUpRight,
  ArrowDownLeft,
  RefreshCw,
  Handshake,
} from 'lucide-react';
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
  netPaise: number; // overall: positive = you are owed, negative = you owe
  owedToPaise: number; // total others owe you (confirmed)
  owingPaise: number; // total you owe others (confirmed)
  youOwe: FriendBalance[]; // negative netPaise: you owe them
  owedToYou: FriendBalance[]; // positive netPaise: they owe you
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

      let rawBalances = (balances ?? []) as { other_user_id: string; net_paise: number }[];

      if (rawBalances.length === 0) {
        setData({ netPaise: 0, owedToPaise: 0, owingPaise: 0, youOwe: [], owedToYou: [] });
        setLoadState('empty');
        return;
      }

      const otherIds = rawBalances.map((b) => b.other_user_id);
      const { data: profileData, error: profileError } = await supabase
        .from('discoverable_profiles')
        .select('id, username, display_name, avatar_url')
        .in('id', otherIds);
      if (profileError) throw profileError;
      const profiles = (profileData ?? []) as unknown as Profile[];
      const missingProfileIds = otherIds.filter(
        (id) => !profiles.some((profile) => profile.id === id)
      );
      if (missingProfileIds.length > 0) {
        // Soft-deleted or missing profiles are intentionally excluded from the current
        // balance view rather than crashing the whole dashboard.
        rawBalances = rawBalances.filter(
          (balance) => !missingProfileIds.includes(balance.other_user_id)
        );
      }

      let owedToPaise = 0;
      let owingPaise = 0;
      const youOwe: FriendBalance[] = [];
      const owedToYou: FriendBalance[] = [];

      for (const b of rawBalances) {
        if (Math.abs(b.net_paise) < 1) continue; // ignore sub-paise noise
        const prof = profiles.find((p) => p.id === b.other_user_id);
        if (!prof) continue;

        const entry: FriendBalance = {
          userId: b.other_user_id,
          profile: prof,
          netPaise: b.net_paise,
        };

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
  const isEmpty =
    loadState === 'empty' || (data && data.owedToPaise === 0 && data.owingPaise === 0);

  const summaryHeadline = (() => {
    if (!data) return 'Checking your balances…';
    if (data.owingPaise === 0 && data.owedToPaise === 0) return "You're all caught up.";
    if (data.owingPaise > 0 && data.owedToPaise > 0) {
      return `You need to pay ${formatINR(data.owingPaise)}. You should receive ${formatINR(data.owedToPaise)}.`;
    }
    if (data.owingPaise > 0) {
      return `You need to pay ${formatINR(data.owingPaise)}.`;
    }
    return `You should receive ${formatINR(data.owedToPaise)}.`;
  })();

  return (
    <div className="page-content">
      {/* Header */}
      <header className="mb-6 flex items-center justify-between">
        <LogoFull />
        <div className="flex items-center gap-2">
          <Link
            to="/settlements"
            className="btn-ghost rounded-full p-2"
            aria-label="Paid, received, and pending payments"
            title="Payments"
          >
            <Handshake size={20} />
          </Link>
          <button
            onClick={() => void loadHomeData()}
            className="btn-ghost rounded-full p-2"
            aria-label="Refresh balances"
            disabled={isLoading}
          >
            <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <Link
            to="/notifications"
            className="btn-ghost relative rounded-full p-2"
            aria-label="Notifications"
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[rgb(var(--color-accent))] text-[10px] font-bold text-white"
                aria-label={`${unreadCount} unread notifications`}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Link>
        </div>
      </header>

      {/* Email verification warning */}
      {!emailVerified && (
        <div
          className="mb-4 rounded-lg border border-[rgb(var(--color-pending)/0.3)] bg-[rgb(var(--color-pending)/0.1)] p-3"
          role="alert"
        >
          <p className="text-sm text-[rgb(var(--color-pending))]">
            📧 Verify your email to send invites, join groups, and create expenses.
          </p>
        </div>
      )}

      {/* Error state */}
      {hasError && (
        <div
          className="mb-4 rounded-lg border border-[rgb(var(--color-negative)/0.2)] bg-[rgb(var(--color-negative)/0.08)] p-4"
          role="alert"
        >
          <p className="mb-2 text-sm font-medium text-[rgb(var(--color-negative))]">
            Could not load balances
          </p>
          <p className="text-muted mb-3 text-xs">Check your connection and try again.</p>
          <button onClick={() => void loadHomeData()} className="btn-secondary text-sm">
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      )}

      {/* Balance hero card */}
      {!isLoading && !hasError && data && (data.owedToPaise > 0 || data.owingPaise > 0) && (
        <div className="balance-hero mb-6" aria-label="Overall balance summary" aria-live="polite">
          <div
            className="absolute -top-8 -right-8 h-40 w-40 rounded-full bg-white/10"
            aria-hidden="true"
          />
          <div
            className="absolute -right-4 -bottom-10 h-28 w-28 rounded-full bg-white/5"
            aria-hidden="true"
          />
          <div className="relative">
            <p className="mb-1 text-sm font-medium text-white/70">Quick summary</p>
            <p className="mb-3 max-w-sm text-lg leading-snug font-semibold text-white">
              {summaryHeadline}
            </p>
            <div className="flex gap-6">
              <div className="stat-item">
                <p className="mb-0.5 text-xs text-white/60">You need to pay</p>
                <p className="text-lg font-bold text-white tabular-nums">
                  {formatINR(data.owingPaise)}
                </p>
              </div>
              <div className="w-px bg-white/20" />
              <div className="stat-item">
                <p className="mb-0.5 text-xs text-white/60">You should receive</p>
                <p className="text-lg font-bold text-white tabular-nums">
                  {formatINR(data.owedToPaise)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {!isLoading && !hasError && data && data.owedToPaise === 0 && data.owingPaise === 0 && (
        <div className="card mb-4" aria-live="polite">
          <p className="text-primary text-center text-base font-semibold">
            You&apos;re all caught up.
          </p>
        </div>
      )}

      {/* Settled up summary for empty state placeholder */}
      {isLoading && (
        <div className="card mb-4" aria-label="Loading balance">
          <div className="py-2 text-center">
            <div className="skeleton mx-auto mb-2 h-10 w-36" aria-hidden="true" />
            <div className="skeleton mx-auto h-4 w-48" aria-hidden="true" />
          </div>
        </div>
      )}

      {/* Who you need to pay */}
      {!isLoading && (data?.youOwe.length ?? 0) > 0 && (
        <div className="mb-4">
          <p className="section-title mb-2 flex items-center gap-1.5">
            <ArrowUpRight
              size={14}
              className="text-[rgb(var(--color-negative))]"
              aria-hidden="true"
            />
            People to pay
          </p>
          <div className="card overflow-hidden p-0" role="list">
            {data!.youOwe.map((b) => (
              <Link
                key={b.userId}
                to={`/friends/${b.userId}`}
                className="list-item"
                role="listitem"
                aria-label={`You need to pay ${b.profile.display_name} ${formatINR(Math.abs(b.netPaise))}`}
              >
                <Avatar src={b.profile.avatar_url} name={b.profile.display_name} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="text-primary truncate text-sm font-medium">
                    {b.profile.display_name}
                  </p>
                  <p className="text-muted text-xs">You need to pay</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-[rgb(var(--color-negative))] tabular-nums">
                    {formatINR(Math.abs(b.netPaise))}
                  </p>
                  <p className="text-muted text-xs">Pay →</p>
                </div>
                <ChevronRight size={16} className="text-muted flex-shrink-0" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* People who need to pay you */}
      {!isLoading && (data?.owedToYou.length ?? 0) > 0 && (
        <div className="mb-4">
          <p className="section-title mb-2 flex items-center gap-1.5">
            <ArrowDownLeft
              size={14}
              className="text-[rgb(var(--color-positive))]"
              aria-hidden="true"
            />
            People who need to pay you
          </p>
          <div className="card overflow-hidden p-0" role="list">
            {data!.owedToYou.map((b) => (
              <Link
                key={b.userId}
                to={`/friends/${b.userId}`}
                className="list-item"
                role="listitem"
                aria-label={`${b.profile.display_name} needs to pay you ${formatINR(b.netPaise)}`}
              >
                <Avatar src={b.profile.avatar_url} name={b.profile.display_name} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="text-primary truncate text-sm font-medium">
                    {b.profile.display_name}
                  </p>
                  <p className="text-muted text-xs">Needs to pay you</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-[rgb(var(--color-positive))] tabular-nums">
                    {formatINR(b.netPaise)}
                  </p>
                  <p className="text-muted text-xs">Review →</p>
                </div>
                <ChevronRight size={16} className="text-muted flex-shrink-0" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Empty state for new users */}
      {!isLoading && isEmpty && !hasError && (
        <div className="card py-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[rgb(var(--color-accent)/0.1)]">
            <Users size={32} className="text-[rgb(var(--color-accent))]" aria-hidden="true" />
          </div>
          <h2 className="text-primary mb-2 text-base font-semibold">
            You have no unpaid expenses.
          </h2>
          <p className="text-muted mx-auto mb-4 max-w-xs text-sm">
            Add a friend or record a new expense to keep things moving.
          </p>
          <div className="mx-auto flex max-w-xs flex-col gap-2">
            <Link to="/friends" className="btn-primary">
              Add a friend
            </Link>
            <button onClick={() => navigate('/expenses/new')} className="btn-secondary">
              Add an expense
            </button>
          </div>
        </div>
      )}

      {/* Loading state list skeleton */}
      {isLoading && (
        <div className="space-y-3" aria-busy="true" aria-label="Loading balances">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card flex items-center gap-3">
              <div className="skeleton h-9 w-9 flex-shrink-0 rounded-full" />
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
        <p className="text-muted mt-4 text-center text-xs">
          Updated{' '}
          {lastRefreshed.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}

      {/* Add expense FAB */}
      <button
        onClick={() => navigate('/expenses/new')}
        className="btn-primary fixed right-4 bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 rounded-full px-5 py-3 shadow-lg"
        aria-label="Add expense"
      >
        <Plus size={20} aria-hidden="true" /> Add expense
      </button>
    </div>
  );
}
