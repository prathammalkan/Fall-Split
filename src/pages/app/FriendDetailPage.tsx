import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, Handshake, ExternalLink } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, db } from '../../lib/supabase';
import { PageHeader } from '../../components/layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { formatINR, parseINR } from '../../lib/money';
import type { Profile } from '../../types';

interface ShareRow { expense_id: string; amount_paise: number; expenses: { id: string; status: string; expense_payers: { user_id: string; amount_paise: number }[] } | null }
interface PaidRow { expense_id: string; amount_paise: number; expenses: { id: string; status: string; expense_shares: { user_id: string; amount_paise: number }[] } | null }
interface SettlementRow { payer_id: string; recipient_id: string; amount_paise: number; status: string }

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

  const load = useCallback(async () => {
    if (!friendId || !user) return;
    setLoading(true);
    try {
      const { data, error: err } = await supabase.from('profiles').select('*').eq('id', friendId).single();
      if (err || !data) { setError('User not found.'); return; }
      setFriendProfile(data);

      // Calculate net balance with this friend
      const [{ data: shares }, { data: paid }, { data: settlements }] = await Promise.all([
        supabase.from('expense_shares').select('expense_id, amount_paise, expenses (id, status, expense_payers (user_id, amount_paise))').eq('user_id', user.id),
        supabase.from('expense_payers').select('expense_id, amount_paise, expenses (id, status, expense_shares (user_id, amount_paise))').eq('user_id', user.id),
        supabase.from('settlements').select('payer_id, recipient_id, amount_paise, status').or(`payer_id.eq.${user.id},recipient_id.eq.${user.id}`).eq('status', 'confirmed'),
      ]);

      let net = 0;
      for (const s of (shares ?? []) as unknown as ShareRow[]) {
        const exp = s.expenses;
        if (!exp || exp.status !== 'active') continue;
        for (const payer of exp.expense_payers) {
          if (payer.user_id === friendId) net -= s.amount_paise;
        }
      }
      for (const p of (paid ?? []) as unknown as PaidRow[]) {
        const exp = p.expenses;
        if (!exp || exp.status !== 'active') continue;
        for (const share of exp.expense_shares) {
          if (share.user_id === friendId) net += share.amount_paise;
        }
      }
      for (const s of (settlements ?? []) as unknown as SettlementRow[]) {
        if (s.payer_id === user.id && s.recipient_id === friendId) net += s.amount_paise;
        if (s.payer_id === friendId && s.recipient_id === user.id) net -= s.amount_paise;
      }
      setNetPaise(net);
    } finally {
      setLoading(false);
    }
  }, [friendId, user]);

  useEffect(() => { void load(); }, [load]);

  const proposeSettlement = async () => {
    if (!user || !friendId) return;
    setSettleError(null);
    const paise = parseINR(settleAmount);
    if (!paise || paise <= 0) { setSettleError('Enter a valid amount.'); return; }

    // Determine direction: if net > 0, friend owes us → they should pay us
    // If net < 0, we owe friend → we pay them
    const payerId = netPaise < 0 ? user.id : friendId;
    const recipientId = netPaise < 0 ? friendId : user.id;

    setSettling(true);
    const { error: insErr } = await db.from('settlements').insert({
      payer_id: payerId,
      recipient_id: recipientId,
      amount_paise: paise,
      currency: 'INR',
      status: 'proposed',
    });
    setSettling(false);
    if (insErr) { setSettleError('Failed to propose settlement.'); return; }
    setShowSettle(false);
    setSettleAmount('');
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
        <div className="card flex flex-col items-center gap-3">
          <Avatar src={friendProfile.avatar_url} name={friendProfile.display_name} size={64} />
          <div className="text-center">
            <p className="font-semibold text-primary">{friendProfile.display_name}</p>
            <p className="text-sm text-muted">@{friendProfile.username}</p>
            {friendProfile.bio && <p className="text-sm text-secondary mt-1">{friendProfile.bio}</p>}
          </div>
        </div>

        {netPaise !== 0 && (
          <div className="card text-center">
            <p className="text-xs text-muted mb-1">{netPaise > 0 ? `${friendProfile.display_name} owes you` : `You owe ${friendProfile.display_name}`}</p>
            <p className={`text-2xl font-bold tabular-nums ${netPaise > 0 ? 'amount-positive' : 'amount-negative'}`}>
              {formatINR(Math.abs(netPaise))}
            </p>
          </div>
        )}

        {netPaise !== 0 && !showSettle && (
          <div className="flex gap-2">
            <button onClick={() => setShowSettle(true)} className="btn-secondary flex-1">
              <Handshake size={16} /> Settle up
            </button>
            {upiLink && (
              <a href={upiLink} className="btn-primary flex-1 text-center" target="_blank" rel="noopener noreferrer">
                <ExternalLink size={16} /> Pay via UPI
              </a>
            )}
          </div>
        )}

        {showSettle && (
          <div className="card space-y-3">
            <p className="text-sm font-semibold text-primary">Propose settlement</p>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">₹</span>
              <input
                type="number"
                inputMode="decimal"
                value={settleAmount}
                onChange={e => setSettleAmount(e.target.value)}
                className="input pl-7"
                placeholder={(Math.abs(netPaise) / 100).toFixed(2)}
              />
            </div>
            {settleError && <ErrorMessage message={settleError} />}
            <p className="text-xs text-muted">The other party must confirm receipt before balances update.</p>
            <div className="flex gap-2">
              <button onClick={() => { setShowSettle(false); setSettleAmount(''); }} className="btn-secondary flex-1">Cancel</button>
              <button onClick={() => void proposeSettlement()} className="btn-primary flex-1" disabled={settling}>
                {settling ? <Spinner size={16} /> : null} Propose
              </button>
            </div>
          </div>
        )}

        <button onClick={() => navigate(`/expenses/new?friendId=${friendId}`)} className="btn-primary w-full">
          <Plus size={18} /> Add expense with {friendProfile.display_name}
        </button>
      </div>
    </div>
  );
}
