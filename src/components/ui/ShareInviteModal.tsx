import { useState } from 'react';
import { X, Copy, Share2, Check, AlertCircle, QrCode, Camera } from 'lucide-react';
import QRCode from 'react-qr-code';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../lib/supabase';
import { Spinner } from './Spinner';
import { getInviteUrl } from '../../lib/inviteUrl';

interface ShareInviteModalProps {
  onClose: () => void;
  type?: 'friend' | 'group';
  groupId?: string;
}

export function ShareInviteModal({ onClose, type = 'friend', groupId }: ShareInviteModalProps) {
  const { user, emailVerified } = useAuth();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [copyFallback, setCopyFallback] = useState(false);

  const generateLink = async () => {
    if (!user) return;
    setGenerating(true);
    setGenError(null);
    let invitationUrl: string;
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    try {
      invitationUrl = getInviteUrl(
        token,
        import.meta.env['VITE_APP_URL'] as string | undefined,
        window.location.origin,
        import.meta.env.PROD
      );
    } catch (error) {
      setGenerating(false);
      setGenError(error instanceof Error ? error.message : 'Configure VITE_APP_URL first.');
      return;
    }
    // Generate a cryptographically random 64-character hex token
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await db.from('invitation_tokens').insert({
      token,
      type,
      creator_id: user.id,
      target_id: groupId ?? null,
      max_uses: 20,
      expires_at: expiresAt,
    });
    setGenerating(false);
    if (error) {
      setGenError('Could not generate invite link. Please try again.');
      return;
    }
    setInviteUrl(invitationUrl);
  };

  const copyLink = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.querySelector<HTMLInputElement>(
        '[role="dialog"] input[aria-label="Invite link"]'
      );
      input?.focus();
      input?.select();
      setCopyFallback(true);
      setTimeout(() => setCopyFallback(false), 4000);
    }
  };

  const shareLink = async () => {
    if (!inviteUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Fall Split — Join me',
          text: 'Use this link to connect with me on Fall Split!',
          url: inviteUrl,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        // User cancelled share — no action needed
      }
    } else {
      await copyLink();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center px-4 pb-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={type === 'group' ? 'Invite to group' : 'Invite friend'}
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-sm rounded-2xl bg-[rgb(var(--color-bg))] p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-primary text-base font-semibold">
            {type === 'group' ? 'Invite to group' : 'Invite friend'}
          </h2>
          <button onClick={onClose} className="btn-ghost p-1" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {genError && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-[rgb(var(--color-negative)/0.3)] bg-[rgb(var(--color-negative)/0.1)] p-3">
            <AlertCircle size={16} className="flex-shrink-0 text-[rgb(var(--color-negative))]" />
            <p className="text-sm text-[rgb(var(--color-negative))]">{genError}</p>
          </div>
        )}

        {!inviteUrl ? (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgb(var(--color-accent)/0.1)]">
              <QrCode size={28} className="text-[rgb(var(--color-accent))]" />
            </div>
            <p className="text-secondary mb-2 text-sm font-medium">
              {type === 'group' ? 'Invite someone to this group' : 'Connect with a friend'}
            </p>
            <p className="text-muted mb-4 text-xs">
              Generate a secure link that expires in 7 days. Share it or show the QR code for others
              to scan.
            </p>
            {!emailVerified && (
              <div className="mb-4 rounded-lg border border-[rgb(var(--color-pending)/0.35)] bg-[rgb(var(--color-pending)/0.08)] p-3 text-left">
                <p className="text-xs font-medium text-[rgb(var(--color-pending))]">
                  Verify your email before sending invites.
                </p>
              </div>
            )}
            <button
              onClick={() => void generateLink()}
              className="btn-primary w-full"
              disabled={generating || !emailVerified}
              title={!emailVerified ? 'Verify your email to generate invite links' : undefined}
            >
              {generating ? <Spinner size={18} /> : <Share2 size={18} />}
              Generate invite link
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* QR Code */}
            <div className="flex flex-col items-center gap-2">
              <div className="flex justify-center rounded-xl bg-white p-4">
                <QRCode value={inviteUrl} size={180} />
              </div>
              <p className="sr-only" role="status">
                QR code encodes the invitation link shown below.
              </p>
              <div className="flex items-center gap-1.5">
                <Camera size={14} className="text-muted" />
                <p className="text-muted text-xs">Scan with your phone camera to connect</p>
              </div>
            </div>
            {copied && (
              <p className="text-center text-sm text-[rgb(var(--color-positive))]" role="status">
                Link copied.
              </p>
            )}
            {copyFallback && (
              <p className="text-center text-sm text-[rgb(var(--color-pending))]" role="status">
                Clipboard unavailable. The link is selected; copy it manually.
              </p>
            )}

            {/* Copyable link */}
            <div className="flex gap-2">
              <input
                readOnly
                value={inviteUrl}
                className="input flex-1 truncate font-mono text-xs"
                onClick={(e) => (e.target as HTMLInputElement).select()}
                aria-label="Invite link"
              />
              <button
                onClick={() => void copyLink()}
                className="btn-secondary flex-shrink-0 px-3"
                aria-label={copied ? 'Copied!' : 'Copy link'}
              >
                {copied ? (
                  <Check size={16} className="text-[rgb(var(--color-positive))]" />
                ) : (
                  <Copy size={16} />
                )}
              </button>
            </div>

            {/* Share button */}
            <button onClick={() => void shareLink()} className="btn-primary w-full">
              <Share2 size={16} /> Share link
            </button>

            <div className="rounded-lg bg-[rgb(var(--color-pending)/0.08)] p-3">
              <p className="text-muted text-center text-xs">
                Link expires in 7 days · Valid for up to 20 uses
              </p>
              <p className="text-muted mt-1 text-center text-xs">
                Do not include this URL in public posts
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
