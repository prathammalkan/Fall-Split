import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, Handshake, ExternalLink, AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, db } from '../../lib/supabase';
import { PageHeader } from '../../components/layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { formatINR, parseINR } from '../../lib/money';
import type { Profile } from '../../types';

export function FriendDetailPage() {
  const { userId: friendId } = useParams<{ userId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [friendProfile, setFriendProfile] = useState<Profile | null>(null);
  const [netPaise, setNetPaise] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [settleAmount, setSettleAmount] = useState('');
  const [settleError, setSettleError] = useState<string | null>(null);
  const [showSettle, setShowSettle] = useState(false);
  const [balanceLoaded, setBalanceLoaded] = useState(false);
  const [settlementKey, setSettlementKey] = useState('');

  const load = useCallback(async () => {
    if (!friendId || !user) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', friendId)
        .single();

      if (err || !data) { setError('User not found.'); return; }
      setFriendProfile(data as unknown as Profile);

      // Use the server-side RPC for accurate multi-payer balance
      const { data: balances, error: rpcErr } = await supabase.rpc('get_friend_balances');
      if (rpcErr) throw rpcErr;
      const balanceRows = (balances ?? []) as { other_user_id: string; net_paise: number }[];
      const friendBal = balanceRows.find(b => b.other_user_id === friendId);
      setNetPaise(friendBal ? Number(friendBal.net_paise) : 0);
      setBalanceLoaded(true);
    } catch {
      setError('Could not load this balance. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [friendId, user]);

  useEffect(() => { void load(); }, [load]);

  const proposeSettlement = async () => {
    if (!user || !friendId) return;
    setSettleError(null);
    const paise = parseINR(settleAmount);
    if (!paise || paise <= 0) { setSettleError('Enter a valid amount greater than zero.'); return; }

    // Warn if settling more than outstanding amount
    const outstanding = Math.abs(netPaise);
    if (paise > outstanding && outstanding > 0) {
      setSettleError(`This is more than the outstanding amount (${formatINR(outstanding)}). Are you sure? Enter the correct amount to continue.`);
      return;
    }

    // Direction: if net < 0, we owe friend → we are payer
    // if net > 0, friend owes us → friend is payer (but we propose on their behalf? Actually we can only propose as the payer)
    // For clarity: only allow proposing settlement when we are the debtor (net < 0)
    if (netPaise >= 0) {
      setSettleError(`You are not the one who owes money in this relationship. Ask ${friendProfile?.display_name ?? 'them'} to propose the settlement instead.`);
      return;
    }

    const payerId = user.id;
    const recipientId = friendId;

    // Guard: check for an existing pending/proposed settlement between the pair
    const { data: existing } = await supabase
      .from('settlements')
      .select('id')
      .eq('payer_id', payerId)
      .eq('recipient_id', recipientId)
      .in('status', ['proposed', 'pending'])
      .limit(1);

    if (existing && existing.length > 0) {
      setSettleError('You already have a pending settlement proposal with this person. Cancel it from the Settlements page before creating a new one.');
      return;
    }

    setSettling(true);
    const idempotencyKey = settlementKey || crypto.randomUUID();
    setSettlementKey(idempotencyKey);
    const { error: insErr } = await db.rpc('propose_settlement', {
      p_recipient_id: recipientId,
      p_amount_paise: paise,
      p_idempotency_key: idempotencyKey,
    });
    setSettling(false);
    if (insErr) { setSettleError('Could not create settlement. Please try again.'); return; }
    setShowSettle(false);
    setSettleAmount('');
    setSettlementKey('');
    navigate('/settlements');
  };

  if (loading) return <div className="flex justify-center py-16"><Spinner size={32} /></div>;
  if (error || !friendProfile) return <div className="p-4"><ErrorMessage message={error ?? 'Not found'} /></div>;

  const upiLink = friendProfile.upi_id && netPaise < 0
    ? `upi://pay?pa=${encodeURIComponent(friendProfile.upi_id)}&pn=${encodeURIComponent(friendProfile.display_name.substring(0, 40))}&am=${(Math.abs(netPaise) / 100).toFixed(2)}&cu=INR`
    : null;

  return (
    <div>
      <PageHeader title={friendProfile.display_name} back />
      <div className="page-content pt-4 space-y-4">

        {/* Profile card */}
        <div className="card flex flex-col items-center gap-3">
          <Avatar src={friendProfile.avatar_url} name={friendProfile.display_name} size={64} />
          <div className="text-center">
            <p className="font-semibold text-primary">{friendProfile.display_name}</p>
            <p className="text-sm text-muted">@{friendProfile.username}</p>
            {friendProfile.bio && <p className="text-sm text-secondary mt-1">{friendProfile.bio}</p>}
          </div>
        </div>

        {/* Balance */}
        {balanceLoaded && netPaise !== 0 && (
          <div className="card text-center">
            <p className="text-xs text-muted mb-1">
              {netPaise > 0
                ? `${friendProfile.display_name} owes you`
                : `You owe ${friendProfile.display_name}`}
            </p>
            <p className={`text-2xl font-bold tabular-nums ${netPaise > 0 ? 'text-[rgb(var(--color-positive))]' : 'text-[rgb(var(--color-negative))]'}`}>
              {formatINR(Math.abs(netPaise))}
            </p>
            <p className="text-xs text-muted mt-1">Based on confirmed expenses and settlements</p>
          </div>
        )}

        {balanceLoaded && netPaise === 0 && (
          <div className="card text-center py-4">
            <p className="text-sm text-[rgb(var(--color-positive))] font-medium">✓ All settled up with {friendProfile.display_name}</p>
          </div>
        )}

        {/* Actions */}
        {balanceLoaded && netPaise !== 0 && !showSettle && (
          <div className="flex gap-2">
            {netPaise < 0 && (
              <button onClick={() => setShowSettle(true)} className="btn-secondary flex-1">
                <Handshake size={16} aria-hidden="true" /> Settle up
              </button>
            )}
            {upiLink && (
              <a href={upiLink} className="btn-primary flex-1 text-center" target="_blank" rel="noopener noreferrer" aria-label={`Pay ${friendProfile.display_name} via UPI`}>
                <ExternalLink size={16} aria-hidden="true" /> Pay via UPI
              </a>
            )}
            {netPaise > 0 && (
              <div className="flex-1 rounded-lg p-3 bg-[rgb(var(--color-positive)/0.08)] border border-[rgb(var(--color-positive)/0.2)] text-center">
                <p className="text-xs text-muted">Ask {friendProfile.display_name} to settle up with you</p>
              </div>
            )}
          </div>
        )}

        {/* Settle up form */}
        {showSettle && (
          <div className="card space-y-3">
            <p className="text-sm font-semibold text-primary">Propose a settlement</p>
            <p className="text-xs text-muted">
              Enter the amount you are paying {friendProfile.display_name}.
              They must confirm receipt before your balance updates.
            </p>

            {upiLink && (
              <div className="flex items-center gap-2 rounded-lg p-2.5 bg-[rgb(var(--color-pending)/0.08)]">
                <AlertCircle size={14} className="text-[rgb(var(--color-pending))] flex-shrink-0" aria-hidden="true" />
                <p className="text-xs text-muted">If paying via UPI, also record the amount here so {friendProfile.display_name} can confirm.</p>
              </div>
            )}

            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">₹</span>
              <input
                type="number"
                inputMode="decimal"
                value={settleAmount}
                onChange={e => setSettleAmount(e.target.value)}
                className="input pl-7"
                placeholder={(Math.abs(netPaise) / 100).toFixed(2)}
                aria-label="Settlement amount in rupees"
                min="0.01"
                step="0.01"
              />
            </div>

            {settleError && <ErrorMessage message={settleError} />}

            <div className="flex gap-2">
              <button onClick={() => { setShowSettle(false); setSettleAmount(''); setSettleError(null); setSettlementKey(''); }} className="btn-secondary flex-1">Cancel</button>
              <button onClick={() => void proposeSettlement()} className="btn-primary flex-1" disabled={settling}>
                {settling ? <Spinner size={16} /> : null} Send proposal
              </button>
            </div>
          </div>
        )}

        <button
          onClick={() => navigate(`/expenses/new?friendId=${friendId}`)}
          className="btn-primary w-full"
          aria-label={`Add an expense with ${friendProfile.display_name}`}
        >
          <Plus size={18} aria-hidden="true" /> Add expense with {friendProfile.display_name}
        </button>
      </div>
    </div>
  );
}
