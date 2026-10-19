import { useState, useEffect, useCallback } from 'react';
import { Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { PageHeader } from '../../components/layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { Spinner } from '../../components/ui/Spinner';
import type { Profile } from '../../types';

// Only expose safe public fields — never email, bio, upi_id in search results
type PublicProfile = Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_url'>;

export function SearchPage() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicProfile[]>([]);
  const [searching, setSearching] = useState(false);

  const search = useCallback(async (q: string) => {
    if (!q.trim() || q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      // Only select public-safe fields — username prefix match only (not display_name)
      // to avoid leaking users who have sensitive display names
      const { data } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .ilike('username', `${q}%`)
        .neq('id', user?.id ?? '')
        .limit(15);
      setResults((data ?? []) as PublicProfile[]);
    } finally {
      setSearching(false);
    }
  }, [user?.id]);

  // Debounce: wait 300ms after last keystroke before searching
  useEffect(() => {
    const t = setTimeout(() => { void search(query); }, 300);
    return () => clearTimeout(t);
  }, [query, search]);

  return (
    <div>
      <PageHeader title="Search users" back />
      <div className="page-content pt-4">
        <div className="relative mb-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input pl-9"
            placeholder="Search by username…"
            autoFocus
            autoComplete="off"
            aria-label="Search users by username"
          />
          {searching && <div className="absolute right-3 top-1/2 -translate-y-1/2"><Spinner size={16} /></div>}
        </div>
        {results.length > 0 && (
          <div className="card p-0 overflow-hidden">
            {results.map((p) => (
              <div key={p.id} className="list-item">
                <Avatar src={p.avatar_url} name={p.display_name} size={36} />
                <div className="flex-1">
                  <p className="text-sm font-medium text-primary">{p.display_name}</p>
                  <p className="text-xs text-muted">@{p.username}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {results.length === 0 && query.length >= 2 && !searching && (
          <p className="text-center text-sm text-muted py-8">No users found for &ldquo;{query}&rdquo;</p>
        )}
      </div>
    </div>
  );
}
