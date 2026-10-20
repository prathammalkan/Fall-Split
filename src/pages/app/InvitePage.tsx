import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
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

export function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatorName, setCreatorName] = useState<string>('Someone');
  const [inviteType, setInviteType] = useState<string>('friend');
  const [accepting, setAccepting] = useState(false);
  const [success, setSuccess] = useState(false);

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
    setInviteType(data.type);
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void loadInvite(); }, [token]);

  const acceptInvite = async () => {
    if (!user || !token) return;
    setAccepting(true);
    setError(null);
    try {
      // Use the secure server-side RPC function for safe invitation acceptance
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rpcResult = await (supabase as any).rpc('accept_invitation', { p_token: token }) as { data: { success?: boolean; error?: string; type?: string; groupId?: string } | null; error: { message: string } | null };
      const { data, error: rpcErr } = rpcResult;
      if (rpcErr) {
        setError(rpcErr.message || 'Failed to accept invitation.');
        return;
      }
      const result = data;
      if (result?.error) {
        setError(result.error);
        return;
      }
      setSuccess(true);
      // Navigate to appropriate page after short delay
      setTimeout(() => {
        if (result?.type === 'group' && result.groupId) {
          navigate(`/groups/${result.groupId}`, { replace: true });
        } else {
          navigate('/friends', { replace: true });
        }
      }, 1500);
    } finally {
      setAccepting(false);
    }
  };

  if (loading) return <LoadingScreen />;

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <Logo size={48} className="mx-auto mb-6" />
        {success ? (
          <>
            <div className="w-16 h-16 rounded-full bg-[rgb(var(--color-positive)/0.1)] flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">🎉</span>
            </div>
            <h1 className="text-xl font-bold text-primary mb-2">You're connected!</h1>
            <p className="text-secondary">Redirecting you now…</p>
          </>
        ) : error ? (
          <>
            <ErrorMessage message={error} />
            <button onClick={() => navigate('/')} className="btn-secondary w-full mt-4">Go home</button>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-primary mb-2">You're invited!</h1>
            <p className="text-secondary mb-2">
              <strong>{creatorName}</strong> invited you to connect on Fall Split.
            </p>
            <p className="text-sm text-muted mb-6">
              {inviteType === 'group' ? 'Accept to join their group.' : 'Accept to become friends and split expenses together.'}
            </p>
            {!user ? (
              <button
                onClick={() => {
                  // Accept hex tokens (client-generated) and base64url tokens (server-generated)
                  const safeToken = /^[a-zA-Z0-9_-]{16,128}$/.test(token ?? '') ? token : '';
                  navigate(`/login?redirect=/invite/${safeToken}`);
                }}
                className="btn-primary w-full"
              >
                Sign in to accept
              </button>
            ) : (
              <button
                onClick={() => void acceptInvite()}
                className="btn-primary w-full"
                disabled={accepting}
              >
                {accepting ? <Spinner size={18} /> : null}
                Accept invitation
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
