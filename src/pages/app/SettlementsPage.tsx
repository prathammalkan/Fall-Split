import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Handshake, Plus, Check, X, ExternalLink } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, db } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { PageHeader } from '../../components/layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { EmptyState } from '../../components/ui/EmptyState';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { format } from 'date-fns';

interface Settlement {
  id: string;
  payer_id: string;
  recipient_id: string;
  amount_paise: number;
  currency: string;
  group_id: string | null;
  status: string;
  payment_method: string | null;
  upi_ref: string | null;
  notes: string | null;
  proposed_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  payer: { id: string; display_name: string; avatar_url: string | null; upi_id?: string | null };
  recipient: { id: string; display_name: string; avatar_url: string | null; upi_id?: string | null };
}

export function SettlementsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('settlements')
      .select(`*, payer:payer_id (id, display_name, avatar_url, upi_id), recipient:recipient_id (id, display_name, avatar_url, upi_id)`)
      .or(`payer_id.eq.${user.id},recipient_id.eq.${user.id}`)
      .order('created_at', { ascending: false });
    setSettlements((data ?? []) as unknown as Settlement[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const confirmSettlement = async (id: string) => {
    setActionLoading(id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await db.from('settlements').update({ status: 'confirmed', confirmed_at: new Date().toISOString() }).eq('id', id).eq('recipient_id', user?.id ?? '');
    setActionLoading(null);
    if (error) { setError('Failed to confirm settlement.'); return; }
    void load();
  };

  const rejectSettlement = async (id: string) => {
    setActionLoading(id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await db.from('settlements').update({ status: 'rejected', rejected_at: new Date().toISOString() }).eq('id', id).eq('recipient_id', user?.id ?? '');
    setActionLoading(null);
    if (error) { setError('Failed to reject.'); return; }
    void load();
  };

  const cancelSettlement = async (id: string) => {
    setActionLoading(id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await db.from('settlements').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', id).eq('payer_id', user?.id ?? '');
    setActionLoading(null);
    if (error) { setError('Failed to cancel.'); return; }
    void load();
  };

  const buildUpiLink = (upiId: string, amount: number, name: string): string => {
    const rupees = (amount / 100).toFixed(2);
    return `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(name.substring(0, 40))}&am=${rupees}&cu=INR`;
  };

  const statusLabel: Record<string, string> = { proposed: 'Proposed', pending: 'Pending', confirmed: 'Confirmed', rejected: 'Rejected', disputed: 'Disputed', cancelled: 'Cancelled' };
  const statusClass: Record<string, string> = { proposed: 'badge-pending', pending: 'badge-pending', confirmed: 'badge-positive', rejected: 'badge-negative', disputed: 'badge-negative', cancelled: 'badge-neutral' };

  return (
    <div>
      <PageHeader title="Settlements" back actions={
        <button onClick={() => navigate('/friends')} className="btn-ghost p-2 rounded-full" aria-label="Settle with friend">
          <Plus size={20} />
        </button>
      } />
      <div className="page-content pt-4">
        {error && <ErrorMessage message={error} />}
        {loading ? (
          <div className="flex justify-center py-8"><Spinner size={24} /></div>
        ) : settlements.length === 0 ? (
          <EmptyState icon={Handshake} title="No settlements" description="Record payments to track when debts are settled" />
        ) : (
          <div className="space-y-3">
            {settlements.map((s) => {
              const isPayer = s.payer_id === user?.id;
              const isRecipient = s.recipient_id === user?.id;
              const other = isPayer ? s.recipient : s.payer;
              const canConfirm = isRecipient && (s.status === 'proposed' || s.status === 'pending');
              const canCancel = isPayer && (s.status === 'proposed' || s.status === 'pending');
              const recipientUpi = s.recipient.upi_id;

              return (
                <div key={s.id} className="card">
                  <div className="flex items-center gap-3 mb-3">
                    <Avatar src={other.avatar_url} name={other.display_name} size={36} />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-primary">{isPayer ? `You → ${other.display_name}` : `${other.display_name} → You`}</p>
                      <p className="text-xs text-muted">{format(new Date(s.created_at), 'MMM d, yyyy')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-bold tabular-nums text-primary">{formatINR(s.amount_paise)}</p>
                      <span className={statusClass[s.status] ?? 'badge-neutral'}>{statusLabel[s.status]}</span>
                    </div>
                  </div>

                  {s.notes && <p className="text-xs text-muted mb-3">{s.notes}</p>}

                  <div className="flex gap-2 flex-wrap">
                    {isPayer && recipientUpi && (s.status === 'proposed' || s.status === 'pending') && (
                      <a href={buildUpiLink(recipientUpi, s.amount_paise, other.display_name)} className="btn-secondary text-sm px-3 py-1.5" target="_blank" rel="noopener noreferrer">
                        <ExternalLink size={14} /> Pay via UPI
                      </a>
                    )}
                    {canConfirm && (
                      <>
                        <button onClick={() => void confirmSettlement(s.id)} disabled={actionLoading === s.id} className="btn-primary text-sm px-3 py-1.5 flex-1">
                          {actionLoading === s.id ? <Spinner size={14} /> : <Check size={14} />} Confirm received
                        </button>
                        <button onClick={() => void rejectSettlement(s.id)} disabled={actionLoading === s.id} className="btn-secondary text-sm px-3 py-1.5 text-[rgb(var(--color-negative))]">
                          <X size={14} /> Reject
                        </button>
                      </>
                    )}
                    {canCancel && (
                      <button onClick={() => void cancelSettlement(s.id)} disabled={actionLoading === s.id} className="btn-ghost text-sm text-muted">Cancel</button>
                    )}
                  </div>

                  {(s.status === 'proposed' || s.status === 'pending') && (
                    <p className="text-[10px] text-muted mt-2">Balances not updated until recipient confirms receipt.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
