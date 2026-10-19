import { useState } from 'react';
import { Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { PageHeader } from '../../components/layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { Spinner } from '../../components/ui/Spinner';
import type { Profile } from '../../types';

export function SearchPage() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);

  const search = async (q: string) => {
    if (!q.trim() || q.length < 2) { setResults([]); return; }
    setSearching(true);
    const { data } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url')
      .or(`username.ilike.${q}%,display_name.ilike.${q}%`)
      .neq('id', user?.id ?? '')
      .limit(15);
    setResults((data ?? []) as Profile[]);
    setSearching(false);
  };

  return (
    <div>
      <PageHeader title="Search users" back />
      <div className="page-content pt-4">
        <div className="relative mb-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search" value={query}
            onChange={(e) => { setQuery(e.target.value); void search(e.target.value); }}
            className="input pl-9" placeholder="Search by username or name…" autoFocus
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
          <p className="text-center text-sm text-muted py-8">No users found for "{query}"</p>
        )}
      </div>
    </div>
  );
}
