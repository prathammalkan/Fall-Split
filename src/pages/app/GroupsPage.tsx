import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Layers } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { PageHeader } from '../../components/layout/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { Spinner } from '../../components/ui/Spinner';
import type { Group } from '../../types';

const GROUP_ICONS: Record<string, string> = {
  trip: '✈️',
  household: '🏠',
  event: '🎉',
  custom: '⚡',
};

export function GroupsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('group_members')
      .select('group_id, groups (*)')
      .eq('user_id', user.id)
      .is('removed_at', null);
    const rows = (data ?? []) as unknown as { groups: Group | null }[];
    setGroups(rows.map(d => d.groups).filter((g): g is Group => g !== null));
    setLoading(false);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <PageHeader title="Groups" actions={
        <button onClick={() => navigate('/groups/new')} className="btn-ghost p-2 rounded-full" aria-label="New group">
          <Plus size={20} />
        </button>
      } />
      <div className="page-content pt-4">
        {loading ? (
          <div className="flex justify-center py-8"><Spinner size={24} /></div>
        ) : groups.length === 0 ? (
          <EmptyState icon={Layers} title="No groups yet" description="Create a group for trips, roommates, events, or anything"
            action={<button onClick={() => navigate('/groups/new')} className="btn-primary"><Plus size={16} /> Create group</button>}
          />
        ) : (
          <div className="card p-0 overflow-hidden">
            {groups.map(g => (
              <Link key={g.id} to={`/groups/${g.id}`} className="list-item">
                <div className="w-10 h-10 rounded-xl bg-tertiary flex items-center justify-center text-xl flex-shrink-0">
                  {GROUP_ICONS[g.type] ?? '⚡'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-primary truncate">{g.name}</p>
                  {g.description && <p className="text-xs text-muted truncate">{g.description}</p>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
