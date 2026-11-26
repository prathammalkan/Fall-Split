import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Layers, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { readCache, writeCache, CacheKey } from '../../lib/pageCache';
import { PageHeader } from '../../components/layout/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import type { Group } from '../../types';

const GROUP_ICONS: Record<string, string> = {
  trip: '🌊',
  household: '🏠',
  event: '🎉',
  custom: '📋',
};

export function GroupsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState('');

  const load = useCallback(
    async (forceRefresh = false) => {
      if (!user) return;
      const userId = user.id;
      const cached = readCache<Group[]>(userId, CacheKey.groupsList);
      if (cached.data !== null) {
        setGroups(cached.data);
        setLoading(false);
        if (!cached.isStale && !forceRefresh) {
          return;
        }
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const { data, error: loadError } = await supabase
          .from('group_members')
          .select('group_id, groups (*)')
          .eq('user_id', user.id)
          .is('removed_at', null);
        if (loadError) {
          if (cached.data === null) {
            setGroups([]);
            setError('Groups could not be loaded. Please try again.');
          }
          return;
        }
        const rows = (data ?? []) as unknown as { groups: Group | null }[];
        const freshGroups = rows.map((d) => d.groups).filter((g): g is Group => g !== null);
        setGroups(freshGroups);
        writeCache(userId, CacheKey.groupsList, freshGroups);
      } catch {
        if (cached.data === null) {
          setGroups([]);
          setError('Groups could not be loaded. Please try again.');
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [user]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const filteredGroups = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        (g.description?.toLowerCase().includes(q) ?? false) ||
        g.type.toLowerCase().includes(q)
    );
  }, [groups, filterQuery]);

  return (
    <div>
      <PageHeader
        title="Groups"
        subtitle={refreshing ? 'Refreshing…' : undefined}
        actions={
          <button
            onClick={() => navigate('/groups/new')}
            className="btn-ghost rounded-full p-2"
            aria-label="New group"
          >
            <Plus size={20} />
          </button>
        }
      />
      <div className="page-content pt-4">
        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner size={24} />
          </div>
        ) : error ? (
          <ErrorMessage message={error} retry={() => void load(true)} />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No groups yet"
            description="Create a group for trips, roommates, events, or anything"
            action={
              <button onClick={() => navigate('/groups/new')} className="btn-primary">
                <Plus size={16} /> Create group
              </button>
            }
          />
        ) : (
          <div className="space-y-3">
            {groups.length >= 4 && (
              <div className="relative">
                <Search
                  size={16}
                  className="text-muted absolute top-1/2 left-3 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  placeholder="Filter your groups…"
                  className="input pl-9"
                  aria-label="Filter groups"
                />
              </div>
            )}
            {filteredGroups.length === 0 ? (
              <p className="text-muted py-6 text-center text-sm">
                No groups match &ldquo;{filterQuery}&rdquo;
              </p>
            ) : (
              <div className="card overflow-hidden p-0">
                {filteredGroups.map((g) => (
                  <Link key={g.id} to={`/groups/${g.id}`} className="list-item">
                    <div className="bg-tertiary flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-xl">
                      {GROUP_ICONS[g.type] ?? '⚡'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-primary truncate text-sm font-medium">{g.name}</p>
                      {g.description && (
                        <p className="text-muted truncate text-xs">{g.description}</p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
