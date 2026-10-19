import { useState } from 'react';
import { X, Copy, Share2, Check } from 'lucide-react';
import QRCode from 'react-qr-code';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../lib/supabase';
import { Spinner } from './Spinner';

interface ShareInviteModalProps {
  onClose: () => void;
  type?: 'friend' | 'group';
  groupId?: string;
}

export function ShareInviteModal({ onClose, type = 'friend', groupId }: ShareInviteModalProps) {
  const { user } = useAuth();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const generateLink = async () => {
    if (!user) return;
    setGenerating(true);
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
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
    if (!error) {
      const appUrl = import.meta.env['VITE_APP_URL'] as string || window.location.origin;
      setInviteUrl(`${appUrl}/invite/${token}`);
    }
  };

  const copyLink = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareLink = async () => {
    if (!inviteUrl) return;
    if (navigator.share) {
      await navigator.share({ title: 'Fall Split Invite', text: 'Join me on Fall Split!', url: inviteUrl });
    } else {
      await copyLink();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm bg-[rgb(var(--color-bg))] rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-primary">
            {type === 'group' ? 'Invite to group' : 'Invite friend'}
          </h2>
          <button onClick={onClose} className="btn-ghost p-1"><X size={20} /></button>
        </div>

        {!inviteUrl ? (
          <div className="text-center">
            <p className="text-sm text-muted mb-4">
              Generate a secure invite link that expires in 7 days and can be used up to 20 times.
            </p>
            <button onClick={() => void generateLink()} className="btn-primary w-full" disabled={generating}>
              {generating ? <Spinner size={18} /> : <Share2 size={18} />}
              Generate invite link
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-center p-4 bg-white rounded-xl">
              <QRCode value={inviteUrl} size={180} />
            </div>
            <div className="flex gap-2">
              <input
                readOnly
                value={inviteUrl}
                className="input flex-1 text-xs font-mono truncate"
                onClick={e => (e.target as HTMLInputElement).select()}
              />
              <button onClick={() => void copyLink()} className="btn-secondary px-3 flex-shrink-0">
                {copied ? <Check size={16} className="text-[rgb(var(--color-positive))]" /> : <Copy size={16} />}
              </button>
            </div>
            <button onClick={() => void shareLink()} className="btn-primary w-full">
              <Share2 size={16} /> Share link
            </button>
            <p className="text-xs text-muted text-center">Link expires in 7 days. Do not include private info in this URL.</p>
          </div>
        )}
      </div>
    </div>
  );
}
