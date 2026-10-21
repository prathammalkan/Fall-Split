import { format } from 'date-fns';
import { Check, Info, ShieldAlert, X } from 'lucide-react';
import { formatINR } from '../../lib/money';

interface PaymentRequestModalProps {
  open: boolean;
  payerName: string;
  recipientName: string;
  amountPaise: number;
  relatedLabel?: string | null;
  dateTime?: string | null;
  statusLabel?: string;
  variant?: 'incoming' | 'outgoing';
  loading?: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  onReject: () => void | Promise<void>;
  onReviewDetails?: () => void;
  confirmLabel?: string;
  rejectLabel?: string;
}

export function PaymentRequestModal({
  open,
  payerName,
  recipientName,
  amountPaise,
  relatedLabel,
  dateTime,
  statusLabel = 'Awaiting your confirmation',
  variant = 'incoming',
  loading = false,
  onClose,
  onConfirm,
  onReject,
  onReviewDetails,
  confirmLabel,
  rejectLabel,
}: PaymentRequestModalProps) {
  if (!open) return null;

  const isIncoming = variant === 'incoming';
  const title = isIncoming ? 'Payment received?' : 'Mark as paid';
  const summary = isIncoming
    ? `${payerName} says they paid you ${formatINR(amountPaise)}.`
    : `You are sending ${formatINR(amountPaise)} to ${recipientName}.`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-[rgb(var(--color-border))] bg-[rgb(var(--color-bg))] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-[rgb(var(--color-pending))]">Payment request</p>
            <h2 className="mt-1 text-xl font-semibold text-primary">{title}</h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-full" aria-label="Close payment modal">
            <X size={18} />
          </button>
        </div>

        <div className="rounded-xl border border-[rgb(var(--color-pending)/0.2)] bg-[rgb(var(--color-pending)/0.06)] p-3 mb-4">
          <p className="text-sm text-secondary">{summary}</p>
        </div>

        <div className="space-y-2.5 text-sm text-secondary">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Payer</span>
            <span className="font-medium text-primary">{payerName}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Amount</span>
            <span className="font-semibold text-primary">{formatINR(amountPaise)}</span>
          </div>
          {relatedLabel && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">Related</span>
              <span className="text-right text-primary">{relatedLabel}</span>
            </div>
          )}
          {dateTime && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">Date</span>
              <span className="text-right text-primary">{format(new Date(dateTime), 'MMM d, yyyy • h:mm a')}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Status</span>
            <span className="font-medium text-[rgb(var(--color-pending))]">{statusLabel}</span>
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={loading}
            className="btn-primary flex-1"
            aria-label={confirmLabel ?? (isIncoming ? 'Confirm received' : 'Mark as paid')}
          >
            {loading ? <span className="inline-flex items-center gap-2"><ShieldAlert size={14} className="animate-pulse" /> Processing...</span> : isIncoming ? <><Check size={16} /> Confirm received</> : <><Check size={16} /> Mark as paid</>}
          </button>
          <button
            type="button"
            onClick={() => void onReject()}
            disabled={loading}
            className="btn-secondary flex-1 text-[rgb(var(--color-negative))]"
            aria-label={rejectLabel ?? (isIncoming ? 'Not received' : 'Cancel')}
          >
            <X size={16} /> {rejectLabel ?? (isIncoming ? 'Not received' : 'Cancel')}
          </button>
        </div>

        {onReviewDetails && (
          <button
            type="button"
            onClick={() => void onReviewDetails()}
            className="btn-ghost w-full mt-2"
            aria-label="Review payment details"
          >
            <Info size={16} /> Review details
          </button>
        )}
      </div>
    </div>
  );
}
