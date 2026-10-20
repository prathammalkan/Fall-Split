import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Handshake, Plus, Check, X, ExternalLink, AlertCircle } from 'lucide-react';
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
  rejected_at: string | null;
  created_at: string;
  updated_at: string;
  payer: { id: string; display_name: string; avatar_url: string | null; upi_id?: string | null };
  recipient: { id: string; display_name: string; avatar_url: string | null; upi_id?: string | null };
}

const STATUS_LABELS: Record<string, string> = {
  proposed: 'Awaiting confirmation',
  pending: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  rejected: 'Declined',
  disputed: 'Disputed',
  cancelled: 'Cancelled',
};

const STATUS_CLASSES: Record<string, string> = {
  proposed: 'badge-pending',
  pending: 'badge-pending',
  confirmed: 'badge-positive',
  rejected: 'badge-negative',
  disputed: 'badge-negative',
  cancelled: 'badge-neutral',
};

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
    const { data, error: fetchErr } = await supabase
      .from('settlements')
      .select(`*, payer:payer_id (id, display_name, avatar_url, upi_id), recipient:recipient_id (id, display_name, avatar_url, upi_id)`)
      .or(`payer_id.eq.${user.id},recipient_id.eq.${user.id}`)
      .order('created_at', { ascending: false });
    if (fetchErr) {
      setError('Could not load settlements. Please try again.');
    } else {
      setSettlements((data ?? []) as unknown as Settlement[]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const confirmSettlement = async (id: string) => {
    if (!user) return;
    setActionLoading(id);
    setError(null);
    const { error: updateErr } = await db
      .from('settlements')
      .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('recipient_id', user.id);
    setActionLoading(null);
    if (updateErr) {
      setError('Could not confirm this payment. The other party may have already cancelled it.');
      return;
    }
    void load();
  };

  const rejectSettlement = async (id: string) => {
    if (!user) return;
    setActionLoading(id);
    setError(null);
    const { error: updateErr } = await db
      .from('settlements')
      .update({ status: 'rejected', rejected_at: new Date().toISOString() })
      .eq('id', id)
      .eq('recipient_id', user.id);
    setActionLoading(null);
    if (updateErr) {
      setError('Could not decline this settlement.');
      return;
    }
    void load();
  };

  const cancelSettlement = async (id: string) => {
    if (!user) return;
    setActionLoading(id);
    setError(null);
    const { error: updateErr } = await db
      .from('settlements')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', id)
      .eq('payer_id', user.id);
    setActionLoading(null);
    if (updateErr) {
      setError('Could not cancel this settlement.');
      return;
    }
    void load();
  };

  const buildUpiLink = (upiId: string, amountPaise: number, name: string): string => {
    const rupees = (amountPaise / 100).toFixed(2);
    return `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(name.substring(0, 40))}&am=${rupees}&cu=INR`;
  };

  return (
    <div>
      <PageHeader
        title="Settlements"
        back
        actions={
          <button
            onClick={() => navigate('/friends')}
            className="btn-ghost p-2 rounded-full"
            aria-label="Settle up with a friend"
            title="Settle up with a friend"
          >
            <Plus size={20} />
          </button>
        }
      />
      <div className="page-content pt-4">
        {error && <ErrorMessage message={error} />}

        {loading ? (
          <div className="flex justify-center py-8"><Spinner size={24} /></div>
        ) : settlements.length === 0 ? (
          <EmptyState
            icon={Handshake}
            title="No settlements yet"
            description="When you settle a debt with someone, it will appear here. Go to a friend's page and tap 'Settle up' to get started."
          />
        ) : (
          <div className="space-y-3">
            {settlements.map((s) => {
              const isPayer = s.payer_id === user?.id;
              const isRecipient = s.recipient_id === user?.id;
              const other = isPayer ? s.recipient : s.payer;
              const canConfirm = isRecipient && (s.status === 'proposed' || s.status === 'pending');
              const canCancel = isPayer && (s.status === 'proposed' || s.status === 'pending');
              const recipientUpi = s.recipient.upi_id;
              const isLoading = actionLoading === s.id;

              return (
                <div key={s.id} className="card">
                  <div className="flex items-start gap-3 mb-3">
                    <Avatar src={other.avatar_url} name={other.display_name} size={36} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-primary">
                        {isPayer ? `You → ${other.display_name}` : `${other.display_name} → You`}
                      </p>
                      <p className="text-xs text-muted">{format(new Date(s.created_at), 'MMM d, yyyy')}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-base font-bold tabular-nums text-primary">{formatINR(s.amount_paise)}</p>
                      <span className={STATUS_CLASSES[s.status] ?? 'badge-neutral'}>
                        {STATUS_LABELS[s.status] ?? s.status}
                      </span>
                    </div>
                  </div>

                  {s.notes && <p className="text-xs text-muted mb-3 italic">"{s.notes}"</p>}

                  {/* UPI payment note for payer */}
                  {isPayer && recipientUpi && (s.status === 'proposed' || s.status === 'pending') && (
                    <div className="rounded-lg p-2.5 mb-3 bg-[rgb(var(--color-pending)/0.08)] border border-[rgb(var(--color-pending)/0.2)]">
                      <div className="flex items-start gap-2">
                        <AlertCircle size={14} className="text-[rgb(var(--color-pending))] flex-shrink-0 mt-0.5" aria-hidden="true" />
                        <p className="text-xs text-muted">
                          Opening UPI does not automatically confirm payment. The recipient must confirm receipt before your balance updates.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 flex-wrap">
                    {/* UPI pay button */}
                    {isPayer && recipientUpi && (s.status === 'proposed' || s.status === 'pending') && (
                      <a
                        href={buildUpiLink(recipientUpi, s.amount_paise, other.display_name)}
                        className="btn-secondary text-sm px-3 py-1.5"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Pay ${other.display_name} via UPI`}
                      >
                        <ExternalLink size={14} aria-hidden="true" /> Pay via UPI
                      </a>
                    )}

                    {/* Recipient actions */}
                    {canConfirm && (
                      <>
                        <button
                          onClick={() => void confirmSettlement(s.id)}
                          disabled={isLoading}
                          className="btn-primary text-sm px-3 py-1.5 flex-1"
                          aria-label={`Confirm you received ${formatINR(s.amount_paise)} from ${other.display_name}`}
                        >
                          {isLoading ? <Spinner size={14} /> : <Check size={14} aria-hidden="true" />}
                          Confirm received
                        </button>
                        <button
                          onClick={() => void rejectSettlement(s.id)}
                          disabled={isLoading}
                          className="btn-secondary text-sm px-3 py-1.5 text-[rgb(var(--color-negative))]"
                          aria-label={`Decline this settlement`}
                        >
                          <X size={14} aria-hidden="true" /> Decline
                        </button>
                      </>
                    )}

                    {/* Payer cancel */}
                    {canCancel && (
                      <button
                        onClick={() => void cancelSettlement(s.id)}
                        disabled={isLoading}
                        className="btn-ghost text-sm text-muted"
                        aria-label="Cancel this settlement"
                      >
                        {isLoading ? <Spinner size={14} /> : null}
                        Cancel
                      </button>
                    )}
                  </div>

                  {/* Pending clarification */}
                  {(s.status === 'proposed' || s.status === 'pending') && (
                    <p className="text-[10px] text-muted mt-2">
                      {isPayer
                        ? `Waiting for ${other.display_name} to confirm receipt. Your balance will update once confirmed.`
                        : `${other.display_name} says they paid you. Confirm only when you have received the money.`}
                    </p>
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
