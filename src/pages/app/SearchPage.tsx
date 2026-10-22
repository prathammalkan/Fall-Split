import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, UserPlus, Check } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, db } from '../../lib/supabase';
import { PageHeader } from '../../components/layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import type { Profile } from '../../types';

// Only expose safe public fields — never email, bio, upi_id in search results
type PublicProfile = Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_url'>;

export function SearchPage() {
  const { user } = useAuth();
  const userId = user?.id;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchVersion = useRef(0);

  const search = useCallback(
    async (q: string, version: number) => {
      const term = q.trim();
      if (term.length < 2) {
        setResults([]);
        setSearchError(null);
        setSearching(false);
        return;
      }
      setSearching(true);
      setSearchError(null);
      try {
        // The view exposes only fields approved for profile discovery.
        const { data, error } = await supabase
          .from('discoverable_profiles')
          .select('id, username, display_name, avatar_url')
          .ilike('username', `${term}%`)
          .neq('id', userId ?? '')
          .limit(15);
        if (version !== searchVersion.current) return;
        if (error) {
          setResults([]);
          setSearchError('User search failed. Please try again.');
          return;
        }
        setResults((data ?? []) as PublicProfile[]);
      } catch {
        if (version !== searchVersion.current) return;
        setResults([]);
        setSearchError('User search failed. Please try again.');
      } finally {
        if (version === searchVersion.current) setSearching(false);
      }
    },
    [userId]
  );

  // Debounce: wait 300ms after last keystroke before searching
  useEffect(() => {
    const version = ++searchVersion.current;
    const t = setTimeout(() => {
      void search(query, version);
    }, 300);
    return () => clearTimeout(t);
  }, [query, search]);

  const sendRequest = async (receiverId: string) => {
    if (!user) return;
    setActionError(null);
    setSending(receiverId);
    try {
      const { error } = await db
        .from('friend_requests')
        .insert({ sender_id: user.id, receiver_id: receiverId });
      if (error) {
        setActionError(
          'Could not send request. You may already have a connection with this person.'
        );
      } else {
        setSent((prev) => new Set(prev).add(receiverId));
      }
    } catch {
      setActionError('Could not send request. Check your connection and try again.');
    } finally {
      setSending(null);
    }
  };

  return (
    <div>
      <PageHeader title="Search users" back />
      <div className="page-content pt-4">
        <div className="relative mb-4">
          <Search size={16} className="text-muted absolute top-1/2 left-3 -translate-y-1/2" />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              searchVersion.current += 1;
              setQuery(e.target.value);
              setResults([]);
              setSearchError(null);
              setSearching(false);
            }}
            className="input pl-9"
            placeholder="Search by username…"
            autoFocus
            autoComplete="off"
            aria-label="Search users by username"
          />
          {searching && (
            <div className="absolute top-1/2 right-3 -translate-y-1/2">
              <Spinner size={16} />
            </div>
          )}
        </div>

        {actionError && (
          <p className="mb-3 px-1 text-xs text-[rgb(var(--color-negative))]">{actionError}</p>
        )}

        {searchError && (
          <ErrorMessage
            message={searchError}
            retry={() => void search(query, ++searchVersion.current)}
          />
        )}

        {!searchError && results.length > 0 && (
          <div className="card overflow-hidden p-0">
            {results.map((p) => (
              <div key={p.id} className="list-item">
                <Avatar src={p.avatar_url} name={p.display_name} size={36} />
                <div className="flex-1">
                  <p className="text-primary text-sm font-medium">{p.display_name}</p>
                  <p className="text-muted text-xs">@{p.username}</p>
                </div>
                {sent.has(p.id) ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-[rgb(var(--color-positive))]">
                    <Check size={14} /> Sent
                  </span>
                ) : (
                  <button
                    onClick={() => void sendRequest(p.id)}
                    disabled={sending === p.id}
                    className="btn-secondary flex items-center gap-1 px-3 py-1.5 text-xs"
                    aria-label={`Send friend request to ${p.display_name}`}
                  >
                    {sending === p.id ? <Spinner size={12} /> : <UserPlus size={14} />}
                    Add
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {!searchError && results.length === 0 && query.trim().length >= 2 && !searching && (
          <p className="text-muted py-8 text-center text-sm">
            No users found for &ldquo;{query}&rdquo;
          </p>
        )}
      </div>
    </div>
  );
}
