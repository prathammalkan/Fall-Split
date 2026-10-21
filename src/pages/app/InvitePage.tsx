import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../lib/supabase';
import { LoadingScreen } from '../../components/ui/LoadingScreen';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { Logo } from '../../components/brand/Logo';
import { Spinner } from '../../components/ui/Spinner';

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

  const loadInvite = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!token || !/^[a-zA-Z0-9_-]{16,128}$/.test(token)) {
      setError('Invalid invitation link.');
      setLoading(false);
      return;
    }
    try {
      const previewResult = await db.rpc('get_invitation_preview', { p_token: token }) as {
        data: { type?: string; creator_name?: string } | null;
        error: { message: string } | null;
      };
      const { data, error: previewError } = previewResult;
      if (previewError) throw previewError;
      const preview = data;
      if (!preview || !preview.type) {
        setError('This invitation is invalid, expired, revoked, or has reached its use limit.');
        return;
      }
      setCreatorName(preview.creator_name ?? 'Someone');
      setInviteType(preview.type);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check this invitation. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void loadInvite(); }, [loadInvite]);

  const acceptInvite = async () => {
    if (!user || !token) return;
    setAccepting(true);
    setError(null);
    try {
      const rpcResult = await db.rpc('accept_invitation', { p_token: token }) as {
        data: { success?: boolean; error?: string; type?: string; groupId?: string } | null;
        error: { message: string } | null;
      };
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invitation. Please try again.');
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
              <>
                <Link
                  to={`/login?redirect=${encodeURIComponent(`/invite/${token}`)}`}
                  className="btn-primary w-full"
                >
                  Sign in to accept
                </Link>
                <Link
                  to={`/register?redirect=${encodeURIComponent(`/invite/${token}`)}`}
                  className="btn-secondary w-full mt-2"
                >
                  Create an account
                </Link>
              </>
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
