import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { PageHeader } from '../../components/layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import type { Profile } from '../../types';

export function FriendDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  useAuth();
  const navigate = useNavigate();
  const [friendProfile, setFriendProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error: err } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (err || !data) { setError('User not found.'); setLoading(false); return; }
    setFriendProfile(data);
    setLoading(false);
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="flex justify-center py-16"><Spinner size={32} /></div>;
  if (error || !friendProfile) return <div className="p-4"><ErrorMessage message={error ?? 'Not found'} /></div>;

  return (
    <div>
      <PageHeader title={friendProfile.display_name} back />
      <div className="page-content pt-4 space-y-4">
        <div className="card flex flex-col items-center gap-3">
          <Avatar src={friendProfile.avatar_url} name={friendProfile.display_name} size={64} />
          <div className="text-center">
            <p className="font-semibold text-primary">{friendProfile.display_name}</p>
            <p className="text-sm text-muted">@{friendProfile.username}</p>
            {friendProfile.bio && <p className="text-sm text-secondary mt-1">{friendProfile.bio}</p>}
          </div>
        </div>
        <button onClick={() => navigate(`/expenses/new?friendId=${userId}`)} className="btn-primary w-full">
          <Plus size={18} /> Add expense with {friendProfile.display_name}
        </button>
      </div>
    </div>
  );
}
