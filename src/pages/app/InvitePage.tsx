import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase, db } from '../../lib/supabase';
import { LoadingScreen } from '../../components/ui/LoadingScreen';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { Logo } from '../../components/brand/Logo';
import { Spinner } from '../../components/ui/Spinner';

interface InvitationTokenData {
  id: string;
  type: string;
  use_count: number;
  max_uses: number;
  expires_at: string | null;
  revoked_at: string | null;
  creator: { display_name: string } | null;
}

interface InvitationTokenMini {
  use_count: number;
  creator_id: string;
  type: string;
}

export function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatorName, setCreatorName] = useState<string>('Someone');
  const [accepting, setAccepting] = useState(false);

  useEffect(() => { void loadInvite(); }, [token]);

  const loadInvite = async () => {
    if (!token) { setError('Invalid invitation link.'); setLoading(false); return; }
    const { data: rawData, error: err } = await supabase
      .from('invitation_tokens')
      .select('id, type, use_count, max_uses, expires_at, revoked_at, creator:creator_id (display_name)')
      .eq('token', token)
      .single();

    if (err || !rawData) { setError('This invitation is invalid or has already been used.'); setLoading(false); return; }
    const data = rawData as unknown as InvitationTokenData;

    if (data.revoked_at) { setError('This invitation has been revoked.'); setLoading(false); return; }
    if (data.expires_at && new Date(data.expires_at) < new Date()) { setError('This invitation has expired.'); setLoading(false); return; }
    if (data.use_count >= data.max_uses) { setError('This invitation has reached its maximum uses.'); setLoading(false); return; }

    setCreatorName(data.creator?.display_name ?? 'Someone');
    setLoading(false);
  };

  const acceptInvite = async () => {
    if (!user || !token) return;
    setAccepting(true);
    const { data: rawTokenData } = await supabase
      .from('invitation_tokens')
      .select('use_count, creator_id, type')
      .eq('token', token)
      .single();

    const tokenData = rawTokenData as unknown as InvitationTokenMini | null;

    if (tokenData) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.from('invitation_tokens').update({ use_count: tokenData.use_count + 1 }).eq('token', token);
      if (tokenData.type === 'friend' && tokenData.creator_id !== user.id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await db.from('friend_requests').insert({ sender_id: tokenData.creator_id, receiver_id: user.id }).select();
      }
    }
    setAccepting(false);
    navigate('/', { replace: true });
  };

  if (loading) return <LoadingScreen />;

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <Logo size={48} className="mx-auto mb-6" />
        {error ? (
          <>
            <ErrorMessage message={error} />
            <button onClick={() => navigate('/')} className="btn-secondary w-full mt-4">Go home</button>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-primary mb-2">You're invited!</h1>
            <p className="text-secondary mb-6"><strong>{creatorName}</strong> invited you to join Fall Split.</p>
            {!user ? (
              <button onClick={() => navigate('/login')} className="btn-primary w-full">Sign in to accept</button>
            ) : (
              <button onClick={() => void acceptInvite()} className="btn-primary w-full" disabled={accepting}>
                {accepting ? <Spinner size={18} /> : null}Accept invitation
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
