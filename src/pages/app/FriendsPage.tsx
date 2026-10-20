import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, Search, Users, ChevronRight, Clock, Check, X, Share2, QrCode } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, db } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { Avatar } from '../../components/ui/Avatar';
import { PageHeader } from '../../components/layout/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { ShareInviteModal } from '../../components/ui/ShareInviteModal';
import type { Profile } from '../../types';

interface FriendWithBalance {
  profile: Profile;
  friendRequestId: string;
  netPaise: number;
}

interface PendingRequest {
  id: string;
  profile: Profile;
  direction: 'received' | 'sent';
  createdAt: string;
}

interface RawRequest {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: string;
  created_at: string;
}

export function FriendsPage() {
  const { user, emailVerified } = useAuth();
  const [friends, setFriends] = useState<FriendWithBalance[]>([]);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: requestsRaw } = await supabase
        .from('friend_requests')
        .select('id, sender_id, receiver_id, status, created_at')
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`);

      const requests = (requestsRaw ?? []) as unknown as RawRequest[];
      if (requests.length === 0) {
        setFriends([]);
        setPending([]);
        return;
      }

      const otherIds = requests.map(r =>
        r.sender_id === user.id ? r.receiver_id : r.sender_id
      );

      let profiles: Profile[] = [];
      if (otherIds.length > 0) {
        const { data } = await supabase.from('profiles').select('*').in('id', otherIds);
        profiles = (data ?? []) as unknown as Profile[];
      }

      // Fetch balances for all friends
      const balanceMap: Record<string, number> = {};
      try {
        const { data: balances } = await supabase.rpc('get_friend_balances');
        if (balances) {
          for (const b of balances as { other_user_id: string; net_paise: number }[]) {
            balanceMap[b.other_user_id] = b.net_paise;
          }
        }
      } catch {
        // Balance fetch failed — show friends without balances
      }

      const accepted: FriendWithBalance[] = [];
      const pendingList: PendingRequest[] = [];

      for (const req of requests) {
        const otherId = req.sender_id === user.id ? req.receiver_id : req.sender_id;
        const prof = profiles.find(p => p.id === otherId);
        if (!prof) continue;

        if (req.status === 'accepted') {
          accepted.push({
            profile: prof,
            friendRequestId: req.id,
            netPaise: balanceMap[otherId] ?? 0,
          });
        } else if (req.status === 'pending') {
          pendingList.push({
            id: req.id,
            profile: prof,
            direction: req.sender_id === user.id ? 'sent' : 'received',
            createdAt: req.created_at,
          });
        }
      }

      // Sort friends: those with outstanding balances first, then alphabetically
      accepted.sort((a, b) => Math.abs(b.netPaise) - Math.abs(a.netPaise) || a.profile.display_name.localeCompare(b.profile.display_name));

      setFriends(accepted);
      setPending(pendingList);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const search = useCallback(async (query: string) => {
    if (!query.trim() || query.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .ilike('username', `${query}%`)
        .neq('id', user?.id ?? '')
        .limit(10);
      if (error) return;
      setSearchResults((data ?? []) as unknown as Profile[]);
    } finally {
      setSearching(false);
    }
  }, [user?.id]);

  useEffect(() => {
    const t = setTimeout(() => { void search(searchQuery); }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, search]);

  const sendRequest = async (receiverId: string) => {
    if (!user) return;
    setActionError(null);
    const { error } = await db.from('friend_requests').insert({ sender_id: user.id, receiver_id: receiverId });
    if (error) {
      setActionError('Could not send friend request. You may already have a connection with this person.');
      return;
    }
    setSearchQuery('');
    setSearchResults([]);
    void load();
  };

  const respondToRequest = async (requestId: string, status: 'accepted' | 'rejected') => {
    setActionError(null);
    const { error } = await db.from('friend_requests').update({ status }).eq('id', requestId);
    if (error) {
      setActionError(status === 'accepted' ? 'Could not accept request.' : 'Could not decline request.');
      return;
    }
    void load();
  };

  const showSearch = searchQuery.length > 0;

  return (
    <div>
      <PageHeader title="Friends" actions={
        <button onClick={() => setShowInviteModal(true)} className="btn-ghost p-2 rounded-full" aria-label="Invite friends via QR code or link">
          <Share2 size={20} />
        </button>
      } />
      <div className="page-content pt-4">
        {actionError && <ErrorMessage message={actionError} />}

        {/* Search */}
        <div className="relative mb-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Find someone by username…"
            className="input pl-9"
            autoComplete="off"
            aria-label="Search users by username"
          />
          {searching && (<div className="absolute right-3 top-1/2 -translate-y-1/2"><Spinner size={16} /></div>)}
        </div>

        {/* Search results */}
        {showSearch && (
          <div className="card p-0 overflow-hidden mb-4" role="listbox" aria-label="Search results">
            {searchResults.length === 0 && !searching && (
              <p className="text-sm text-muted p-4 text-center">No users found for "{searchQuery}"</p>
            )}
            {searching && <div className="p-4 flex justify-center"><Spinner size={20} /></div>}
            {searchResults.map(profile => (
              <div key={profile.id} className="list-item" role="option">
                <Avatar src={profile.avatar_url} name={profile.display_name} size={36} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-primary">{profile.display_name}</p>
                  <p className="text-xs text-muted">@{profile.username}</p>
                </div>
                <button
                  onClick={() => void sendRequest(profile.id)}
                  className="btn-primary px-3 py-1.5 text-xs"
                  disabled={!emailVerified}
                  aria-label={`Send friend request to ${profile.display_name}`}
                  title={!emailVerified ? 'Verify your email to send requests' : undefined}
                >
                  <UserPlus size={14} aria-hidden="true" /> Add
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Pending requests */}
        {pending.length > 0 && (
          <div className="mb-4">
            <p className="section-title mb-2">Pending requests</p>
            <div className="card p-0 overflow-hidden" role="list">
              {pending.map(req => (
                <div key={req.id} className="list-item" role="listitem">
                  <Avatar src={req.profile.avatar_url} name={req.profile.display_name} size={36} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-primary">{req.profile.display_name}</p>
                    <p className="text-xs text-muted">
                      {req.direction === 'received' ? 'Wants to connect with you' : 'Request sent — waiting for them'}
                    </p>
                  </div>
                  {req.direction === 'received' && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => void respondToRequest(req.id, 'accepted')}
                        className="w-8 h-8 rounded-full bg-[rgb(var(--color-positive)/0.1)] flex items-center justify-center text-[rgb(var(--color-positive))]"
                        aria-label={`Accept request from ${req.profile.display_name}`}
                      >
                        <Check size={16} />
                      </button>
                      <button
                        onClick={() => void respondToRequest(req.id, 'rejected')}
                        className="w-8 h-8 rounded-full bg-[rgb(var(--color-negative)/0.1)] flex items-center justify-center text-[rgb(var(--color-negative))]"
                        aria-label={`Decline request from ${req.profile.display_name}`}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  )}
                  {req.direction === 'sent' && (
                    <span className="badge-neutral text-xs flex items-center gap-1">
                      <Clock size={10} aria-hidden="true" /> Pending
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Friends list */}
        {loading ? (
          <div className="flex justify-center py-8"><Spinner size={24} /></div>
        ) : friends.length === 0 && pending.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No friends yet"
            description="Search for someone by username, or share your invite link for them to scan"
            action={
              <div className="flex flex-col gap-2">
                <button className="btn-primary" onClick={() => setShowInviteModal(true)}>
                  <QrCode size={16} aria-hidden="true" /> Share invite link
                </button>
              </div>
            }
          />
        ) : (
          <div>
            {friends.length > 0 && (
              <div>
                <p className="section-title mb-2">Friends ({friends.length})</p>
                <div className="card p-0 overflow-hidden" role="list">
                  {friends.map(f => (
                    <Link
                      key={f.friendRequestId}
                      to={`/friends/${f.profile.id}`}
                      className="list-item"
                      role="listitem"
                      aria-label={`${f.profile.display_name}${f.netPaise !== 0 ? `, ${f.netPaise > 0 ? 'owes you' : 'you owe'} ${formatINR(Math.abs(f.netPaise))}` : ', settled up'}`}
                    >
                      <Avatar src={f.profile.avatar_url} name={f.profile.display_name} size={36} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-primary">{f.profile.display_name}</p>
                        <p className="text-xs text-muted">@{f.profile.username}</p>
                      </div>
                      {f.netPaise !== 0 ? (
                        <div className="text-right">
                          <p className={`text-sm font-semibold tabular-nums ${f.netPaise > 0 ? 'text-[rgb(var(--color-positive))]' : 'text-[rgb(var(--color-negative))]'}`}>
                            {formatINR(Math.abs(f.netPaise))}
                          </p>
                          <p className="text-xs text-muted">{f.netPaise > 0 ? 'owes you' : 'you owe'}</p>
                        </div>
                      ) : (
                        <span className="text-xs text-muted">Settled</span>
                      )}
                      <ChevronRight size={16} className="text-muted" aria-hidden="true" />
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showInviteModal && <ShareInviteModal onClose={() => setShowInviteModal(false)} />}
    </div>
  );
}
