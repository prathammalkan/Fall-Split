import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Plus,
  Handshake,
  ExternalLink,
  AlertCircle,
  Check,
  X,
  Clock,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, db } from '../../lib/supabase';
import { PageHeader } from '../../components/layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { SheetDialog } from '../../components/ui/SheetDialog';
import { formatINR, parseINR } from '../../lib/money';
import type { Profile } from '../../types';

interface PendingSettlementItem {
  id: string;
  payer_id: string;
  recipient_id: string;
  amount_paise: number;
  status: string;
  created_at: string;
}

interface PendingExpenseItem {
  id: string;
  title: string;
  amount_paise: number;
  user_share_paise: number;
  status: string;
  created_at: string;
}

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
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [balanceLoaded, setBalanceLoaded] = useState(false);
  const [settlementKey, setSettlementKey] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Requirement D2: Reported payment notice state
  const [reportedNotice, setReportedNotice] = useState<string | null>(null);

  // Requirement D & F: Pending items
  const [pendingSettlements, setPendingSettlements] = useState<PendingSettlementItem[]>([]);
  const [pendingExpenses, setPendingExpenses] = useState<PendingExpenseItem[]>([]);

  const load = useCallback(async () => {
    if (!friendId || !user) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await db.rpc('get_profile_for_user', {
        p_user_id: friendId,
      });

      const profile = data?.[0];
      if (err || !profile) {
        setError('User not found.');
        return;
      }
      setFriendProfile(profile as Profile);

      // Use the server-side RPC for accurate multi-payer balance
      const { data: balances, error: rpcErr } = await supabase.rpc('get_friend_balances');
      if (rpcErr) throw rpcErr;
      const balanceRows = (balances ?? []) as { other_user_id: string; net_paise: number }[];
      const friendBal = balanceRows.find((b) => b.other_user_id === friendId);
      setNetPaise(friendBal ? Number(friendBal.net_paise) : 0);
      setBalanceLoaded(true);

      // Query pending settlements between user and this friend
      const { data: settlementsData } = await supabase
        .from('settlements')
        .select('id, payer_id, recipient_id, amount_paise, status, created_at')
        .or(
          `and(payer_id.eq.${user.id},recipient_id.eq.${friendId}),and(payer_id.eq.${friendId},recipient_id.eq.${user.id})`
        )
        .in('status', ['proposed', 'pending'])
        .order('created_at', { ascending: false });

      setPendingSettlements((settlementsData ?? []) as PendingSettlementItem[]);

      // Query pending/disputed expenses involving both users
      try {
        interface RawExpenseRow {
          id: string;
          title: string;
          amount_paise: number;
          status: string;
          created_at: string;
          expense_payers: Array<{ user_id: string; amount_paise: number }>;
          expense_shares: Array<{ user_id: string; amount_paise: number }>;
        }

        const { data: exps } = await supabase
          .from('expenses')
          .select(
            `
            id, title, amount_paise, status, created_at,
            expense_payers (user_id, amount_paise),
            expense_shares (user_id, amount_paise)
          `
          )
          .in('status', ['pending_approval', 'disputed'])
          .limit(20);

        if (exps) {
          const rawRows = exps as unknown as RawExpenseRow[];
          const sharedPending = rawRows
            .filter((e) => {
              const users = new Set([
                ...(e.expense_payers?.map((p) => p.user_id) ?? []),
                ...(e.expense_shares?.map((s) => s.user_id) ?? []),
              ]);
              return users.has(user.id) && users.has(friendId);
            })
            .map((e) => {
              const myShare = e.expense_shares?.find((s) => s.user_id === user.id);
              return {
                id: e.id,
                title: e.title,
                amount_paise: e.amount_paise,
                user_share_paise: myShare?.amount_paise ?? 0,
                status: e.status,
                created_at: e.created_at,
              };
            });
          setPendingExpenses(sharedPending);
        }
      } catch {
        // Fallback if status enum extension not yet applied
        setPendingExpenses([]);
      }
    } catch {
      setError('Could not load this balance. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [friendId, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleOpenConfirm = () => {
    setSettleError(null);
    const paise = parseINR(settleAmount);
    if (!paise || paise <= 0) {
      setSettleError('Enter a valid amount greater than zero.');
      return;
    }

    const outstanding = Math.abs(netPaise);
    if (paise > outstanding && outstanding > 0) {
      setSettleError(
        `This is more than the outstanding amount (${formatINR(outstanding)}). Are you sure? Enter the correct amount to continue.`
      );
      return;
    }

    if (netPaise >= 0) {
      setSettleError(
        `You are not the one who owes money in this relationship. Ask ${friendProfile?.display_name ?? 'them'} to record payment instead.`
      );
      return;
    }

    setShowConfirmDialog(true);
  };

  const handleConfirmAndSendNotice = async () => {
    if (!user || !friendId) return;
    setSettleError(null);
    const paise = parseINR(settleAmount);
    if (!paise || paise <= 0) return;

    setSettling(true);
    const idempotencyKey = settlementKey || crypto.randomUUID();
    setSettlementKey(idempotencyKey);
    const { error: insErr } = await db.rpc('propose_settlement', {
      p_recipient_id: friendId,
      p_amount_paise: paise,
      p_idempotency_key: idempotencyKey,
    });
    setSettling(false);

    if (insErr) {
      setSettleError('Could not create settlement. Please try again.');
      setShowConfirmDialog(false);
      return;
    }

    setShowConfirmDialog(false);
    setShowSettle(false);
    setSettleAmount('');
    setSettlementKey('');
    setReportedNotice(
      `Payment of ${formatINR(paise)} reported to ${friendProfile?.display_name}. Awaiting their confirmation. Unconfirmed payments do not reduce your confirmed balance until accepted.`
    );
    await load();
  };

  // Recipient actions (Requirement D3)
  const handleRespondSettlement = async (settlementId: string, action: 'confirm' | 'reject') => {
    if (!user) return;
    setActionLoading(settlementId);
    setError(null);
    const { error: rpcErr } = await db.rpc('respond_to_settlement', {
      p_settlement_id: settlementId,
      p_action: action,
    });
    setActionLoading(null);
    if (rpcErr) {
      setError(
        `Could not ${action === 'confirm' ? 'confirm' : 'decline'} payment. ${rpcErr.message}`
      );
      return;
    }
    await load();
  };

  // Payer cancel action
  const handleCancelSettlement = async (settlementId: string) => {
    if (!user) return;
    setActionLoading(settlementId);
    setError(null);
    const { error: rpcErr } = await db.rpc('cancel_settlement', {
      p_settlement_id: settlementId,
    });
    setActionLoading(null);
    if (rpcErr) {
      setError(`Could not cancel payment. ${rpcErr.message}`);
      return;
    }
    await load();
  };

  if (loading)
    return (
      <div className="flex justify-center py-16">
        <Spinner size={32} />
      </div>
    );
  if (error || !friendProfile)
    return (
      <div className="p-4">
        <ErrorMessage message={error ?? 'Not found'} />
      </div>
    );

  const upiLink =
    friendProfile.upi_id && netPaise < 0
      ? `upi://pay?pa=${encodeURIComponent(friendProfile.upi_id)}&pn=${encodeURIComponent(friendProfile.display_name.substring(0, 40))}&am=${(Math.abs(netPaise) / 100).toFixed(2)}&cu=INR`
      : null;

  const paiseToSettle = parseINR(settleAmount) || Math.abs(netPaise);

  return (
    <div>
      <PageHeader title={friendProfile.display_name} back />
      <div className="page-content space-y-4 pt-4">
        {/* Profile card */}
        <div className="card flex flex-col items-center gap-3">
          <Avatar src={friendProfile.avatar_url} name={friendProfile.display_name} size={64} />
          <div className="text-center">
            <p className="text-primary font-semibold">{friendProfile.display_name}</p>
            <p className="text-muted text-sm">@{friendProfile.username}</p>
            {friendProfile.bio && (
              <p className="text-secondary mt-1 text-sm">{friendProfile.bio}</p>
            )}
          </div>
        </div>

        {/* Requirement D2: Reported payment banner */}
        {reportedNotice && (
          <div
            className="flex items-start gap-3 rounded-xl border border-[rgb(var(--color-pending)/0.3)] bg-[rgb(var(--color-pending)/0.08)] p-4"
            role="alert"
          >
            <AlertCircle
              size={20}
              className="mt-0.5 flex-shrink-0 text-[rgb(var(--color-pending))]"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-primary text-sm font-semibold">Payment reported</p>
              <p className="text-secondary mt-0.5 text-xs">{reportedNotice}</p>
            </div>
            <button
              onClick={() => setReportedNotice(null)}
              className="btn-ghost rounded-full p-1 text-xs"
              aria-label="Dismiss payment notice"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Requirement D3: Incoming and Outgoing Pending Settlements */}
        {pendingSettlements.length > 0 && (
          <div className="space-y-2">
            <p className="section-title text-xs font-semibold tracking-wider text-[rgb(var(--color-pending))] uppercase">
              Pending Settlements ({pendingSettlements.length})
            </p>
            {pendingSettlements.map((s) => {
              const isPayer = s.payer_id === user?.id;
              const isRecipient = s.recipient_id === user?.id;
              const isLoadingAction = actionLoading === s.id;

              return (
                <div
                  key={s.id}
                  className="card space-y-3 border-l-4 border-l-[rgb(var(--color-pending))]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="badge-pending inline-flex items-center gap-1 text-[11px]">
                        <Clock size={12} /> Awaiting confirmation
                      </span>
                      <p className="text-primary mt-1 text-base font-bold tabular-nums">
                        {formatINR(s.amount_paise)}
                      </p>
                      <p className="text-muted text-xs">
                        {isPayer
                          ? `You reported paying ${friendProfile.display_name}.`
                          : `${friendProfile.display_name} reported paying you.`}
                      </p>
                      <p className="text-muted mt-0.5 text-[11px]">
                        Reported payments do not change confirmed balances until accepted.
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    {isRecipient && (
                      <>
                        <button
                          onClick={() => void handleRespondSettlement(s.id, 'confirm')}
                          disabled={isLoadingAction}
                          className="btn-primary flex-1 py-1.5 text-xs"
                        >
                          {isLoadingAction ? <Spinner size={14} /> : <Check size={14} />} Confirm
                          Receipt
                        </button>
                        <button
                          onClick={() => void handleRespondSettlement(s.id, 'reject')}
                          disabled={isLoadingAction}
                          className="btn-secondary flex-1 py-1.5 text-xs text-[rgb(var(--color-negative))]"
                        >
                          {isLoadingAction ? <Spinner size={14} /> : <X size={14} />} Not Received
                        </button>
                      </>
                    )}
                    {isPayer && (
                      <button
                        onClick={() => void handleCancelSettlement(s.id)}
                        disabled={isLoadingAction}
                        className="btn-secondary w-full py-1.5 text-xs"
                      >
                        {isLoadingAction ? <Spinner size={14} /> : <X size={14} />} Cancel payment
                        notice
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Confirmed Balance Card */}
        {balanceLoaded && (
          <div className="card text-center">
            <div className="text-muted mb-2 flex items-center justify-center gap-1 text-xs font-medium">
              <ShieldCheck size={14} className="text-[rgb(var(--color-positive))]" />
              <span>Confirmed Balance</span>
            </div>
            {netPaise !== 0 ? (
              <>
                <p className="text-muted mb-1 text-xs">
                  {netPaise > 0
                    ? `${friendProfile.display_name} needs to pay you`
                    : `You need to pay ${friendProfile.display_name}`}
                </p>
                <p
                  className={`text-2xl font-bold tabular-nums ${netPaise > 0 ? 'text-[rgb(var(--color-positive))]' : 'text-[rgb(var(--color-negative))]'}`}
                >
                  {formatINR(Math.abs(netPaise))}
                </p>
              </>
            ) : (
              <p className="text-sm font-medium text-[rgb(var(--color-positive))]">
                ✓ You are all settled up with {friendProfile.display_name}
              </p>
            )}
            <p className="text-muted mt-1.5 text-[11px]">
              Official ledger balance based on confirmed expenses and accepted settlements.
            </p>
          </div>
        )}

        {/* Requirement F: Transparent Balance Breakdown & Ledger Status */}
        {balanceLoaded && (pendingExpenses.length > 0 || pendingSettlements.length > 0) && (
          <div className="card space-y-3">
            <p className="text-muted text-xs font-semibold tracking-wider uppercase">
              In-Flight & Pending Breakdown
            </p>
            <div className="space-y-2 text-xs">
              {pendingExpenses.length > 0 && (
                <div className="flex items-center justify-between rounded-lg bg-[rgb(var(--color-pending)/0.06)] p-2.5">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={14} className="text-[rgb(var(--color-pending))]" />
                    <div>
                      <p className="text-primary font-medium">Expenses awaiting approval</p>
                      <p className="text-muted text-[11px]">
                        {pendingExpenses.length} {pendingExpenses.length === 1 ? 'item' : 'items'}{' '}
                        not yet applied to confirmed balance
                      </p>
                    </div>
                  </div>
                  <span className="font-semibold text-[rgb(var(--color-pending))] tabular-nums">
                    {formatINR(
                      pendingExpenses.reduce((sum, item) => sum + item.user_share_paise, 0)
                    )}
                  </span>
                </div>
              )}

              {pendingSettlements.length > 0 && (
                <div className="flex items-center justify-between rounded-lg bg-[rgb(var(--color-pending)/0.06)] p-2.5">
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-[rgb(var(--color-pending))]" />
                    <div>
                      <p className="text-primary font-medium">Reported settlements</p>
                      <p className="text-muted text-[11px]">
                        {pendingSettlements.length}{' '}
                        {pendingSettlements.length === 1 ? 'item' : 'items'} awaiting confirmation
                      </p>
                    </div>
                  </div>
                  <span className="font-semibold text-[rgb(var(--color-pending))] tabular-nums">
                    {formatINR(
                      pendingSettlements.reduce((sum, item) => sum + item.amount_paise, 0)
                    )}
                  </span>
                </div>
              )}
            </div>
            <p className="text-muted text-[11px]">
              All pending items remain separate from your official ledger until confirmed by both
              parties.
            </p>
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
              <a
                href={upiLink}
                className="btn-primary flex-1 text-center"
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Pay ${friendProfile.display_name} via UPI`}
              >
                <ExternalLink size={16} aria-hidden="true" /> Pay via UPI
              </a>
            )}
            {netPaise > 0 && (
              <div className="flex-1 rounded-lg border border-[rgb(var(--color-positive)/0.2)] bg-[rgb(var(--color-positive)/0.08)] p-3 text-center">
                <p className="text-muted text-xs">
                  Ask {friendProfile.display_name} to pay you back
                </p>
              </div>
            )}
          </div>
        )}

        {/* Settle up entry modal */}
        {showSettle && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center px-4"
            role="dialog"
            aria-modal="true"
            aria-label={`Settle up with ${friendProfile.display_name}`}
          >
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => {
                setShowSettle(false);
                setSettleAmount('');
                setSettleError(null);
              }}
              aria-hidden="true"
            />
            <div className="relative z-10 w-full max-w-md rounded-2xl border border-[rgb(var(--color-border))] bg-[rgb(var(--color-bg))] p-5 shadow-2xl">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium tracking-[0.16em] text-[rgb(var(--color-pending))] uppercase">
                    Record payment
                  </p>
                  <h2 className="text-primary mt-1 text-xl font-semibold">Settle up</h2>
                </div>
                <button
                  onClick={() => {
                    setShowSettle(false);
                    setSettleAmount('');
                    setSettleError(null);
                    setSettlementKey('');
                  }}
                  className="btn-ghost rounded-full p-1.5"
                  aria-label="Close settlement form"
                >
                  <Plus size={18} className="rotate-45" aria-hidden="true" />
                </button>
              </div>

              <p className="text-secondary mb-4 text-sm">
                Record a payment sent to {friendProfile.display_name}. They must confirm receipt
                before your balance updates.
              </p>

              {upiLink && (
                <div className="mb-4 flex items-center gap-2 rounded-lg bg-[rgb(var(--color-pending)/0.08)] p-2.5">
                  <AlertCircle
                    size={14}
                    className="flex-shrink-0 text-[rgb(var(--color-pending))]"
                    aria-hidden="true"
                  />
                  <p className="text-muted text-xs">
                    If paying via UPI, also record the amount here so {friendProfile.display_name}{' '}
                    can confirm receipt.
                  </p>
                </div>
              )}

              <div className="relative mb-4">
                <span className="text-muted absolute top-1/2 left-3 -translate-y-1/2">₹</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={settleAmount}
                  onChange={(e) => setSettleAmount(e.target.value)}
                  className="input pl-7"
                  placeholder={(Math.abs(netPaise) / 100).toFixed(2)}
                  aria-label="Settlement amount in rupees"
                  min="0.01"
                  step="0.01"
                />
              </div>

              {settleError && <ErrorMessage message={settleError} />}

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => {
                    setShowSettle(false);
                    setSettleAmount('');
                    setSettleError(null);
                    setSettlementKey('');
                  }}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button onClick={handleOpenConfirm} className="btn-primary flex-1">
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Requirement D1: Confirmation sheet/dialog */}
        {showConfirmDialog && (
          <SheetDialog title="Confirm payment details" onClose={() => setShowConfirmDialog(false)}>
            <div className="p-5">
              <div className="mb-4">
                <p className="text-xs font-medium tracking-[0.16em] text-[rgb(var(--color-pending))] uppercase">
                  Step 2 of 2 • Confirmation
                </p>
                <h3 className="text-primary mt-1 text-lg font-bold">Confirm payment details</h3>
              </div>

              <div className="space-y-3 rounded-xl border border-[rgb(var(--color-border))] bg-[rgb(var(--color-card))] p-4">
                <div className="flex items-center justify-between">
                  <span className="text-muted text-sm">Paying</span>
                  <span className="text-primary font-semibold">{friendProfile.display_name}</span>
                </div>
                <div className="flex items-center justify-between border-t border-[rgb(var(--color-border))] pt-2.5">
                  <span className="text-muted text-sm">Amount</span>
                  <span className="text-primary text-base font-bold tabular-nums">
                    {formatINR(paiseToSettle)}
                  </span>
                </div>
              </div>

              <div className="mt-4 rounded-lg bg-[rgb(var(--color-pending)/0.08)] p-3">
                <p className="text-secondary text-xs leading-relaxed">
                  This will notify {friendProfile.display_name} to confirm receipt. Your balance
                  will update once they confirm.
                </p>
              </div>

              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfirmDialog(false)}
                  disabled={settling}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmAndSendNotice()}
                  disabled={settling}
                  className="btn-primary flex-1"
                >
                  {settling ? <Spinner size={16} /> : null} Confirm & Send Notice
                </button>
              </div>
            </div>
          </SheetDialog>
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
