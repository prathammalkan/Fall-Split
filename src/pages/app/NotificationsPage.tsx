import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, db } from '../../lib/supabase';
import { PageHeader } from '../../components/layout/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { Spinner } from '../../components/ui/Spinner';
import { format } from 'date-fns';
import type { Notification } from '../../types';

function getNotificationDestination(n: Notification): string | null {
  const data =
    typeof n.data === 'object' && n.data !== null ? (n.data as Record<string, unknown>) : null;
  const expenseId = (data?.expense_id ?? data?.expenseId) as string | undefined;
  const settlementId = (data?.settlement_id ?? data?.settlementId) as string | undefined;
  const groupId = (data?.group_id ?? data?.groupId) as string | undefined;
  const friendId = (data?.friend_id ?? data?.friendId ?? data?.user_id) as string | undefined;

  if (expenseId) return `/expenses/${expenseId}`;
  if (settlementId) return `/settlements`;
  if (groupId) return `/groups/${groupId}`;
  if (friendId) return `/friends/${friendId}`;

  // Fallback by notification type
  const typeStr = String(n.type);
  if (typeStr.startsWith('expense_')) {
    return expenseId ? `/expenses/${expenseId}` : '/activity';
  }
  if (typeStr.startsWith('settlement_')) {
    return '/settlements';
  }
  if (typeStr.startsWith('group_')) {
    return groupId ? `/groups/${groupId}` : '/groups';
  }
  if (typeStr.startsWith('friend_')) {
    return '/friends';
  }
  return null;
}

export function NotificationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (loadError) {
      setError('Notifications could not be loaded. Please try again.');
      setNotifications([]);
    } else {
      setNotifications(data ?? []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const markAllRead = async () => {
    if (!user) return;
    const { error: updateError } = await db
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .is('read_at', null);
    if (updateError) {
      setError('Notifications could not be updated. Please try again.');
      return;
    }
    void load();
  };

  const markRead = async (id: string) => {
    const { error: updateError } = await db
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .is('read_at', null);
    if (updateError) {
      setError('Notification could not be updated. Please try again.');
      return;
    }
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
    );
  };

  const handleNotificationClick = async (n: Notification) => {
    if (!n.read_at) {
      void markRead(n.id);
    }
    const dest = getNotificationDestination(n);
    if (dest) {
      navigate(dest);
    }
  };

  const hasUnread = notifications.some((n) => !n.read_at);

  return (
    <div>
      <PageHeader
        title="Notifications"
        back
        actions={
          hasUnread ? (
            <button onClick={() => void markAllRead()} className="btn-ghost text-sm">
              <Check size={16} /> Mark all read
            </button>
          ) : null
        }
      />
      <div className="page-content pt-4">
        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner size={24} />
          </div>
        ) : error ? (
          <ErrorMessage message={error} retry={() => void load()} />
        ) : notifications.length === 0 ? (
          <EmptyState icon={Bell} title="No notifications" description="You're all caught up" />
        ) : (
          <div className="card overflow-hidden p-0">
            {notifications.map((n) => {
              const dest = getNotificationDestination(n);
              return (
                <button
                  key={n.id}
                  onClick={() => void handleNotificationClick(n)}
                  className={`flex list-item w-full items-center gap-3 text-left ${!n.read_at ? 'bg-[rgb(var(--color-accent)/0.05)]' : ''}`}
                >
                  {!n.read_at && (
                    <div className="h-2 w-2 flex-shrink-0 rounded-full bg-[rgb(var(--color-accent))]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-primary text-sm font-medium">{n.title}</p>
                    <p className="text-secondary text-xs">{n.body}</p>
                    <p className="text-muted mt-0.5 text-xs">
                      {format(new Date(n.created_at), 'MMM d, h:mm a')}
                    </p>
                  </div>
                  {dest && <ChevronRight size={16} className="text-muted flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
