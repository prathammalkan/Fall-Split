import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { LogOut, Bell, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../lib/supabase';
import { PageHeader } from '../../components/layout/PageHeader';
import { Avatar } from '../../components/ui/Avatar';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { Spinner } from '../../components/ui/Spinner';

const profileSchema = z.object({
  display_name: z.string().min(1, 'Name is required').max(60, 'Name too long'),
  username: z.string().min(3, 'Min 3 characters').max(30, 'Max 30 characters').regex(/^[a-z0-9_]+$/, 'Only lowercase letters, numbers, underscores'),
  bio: z.string().max(160, 'Max 160 characters').optional(),
  // UPI ID must be name@provider format; empty string is allowed (clears the field)
  upi_id: z.string().max(50).refine(
    (v) => v === '' || /^[a-zA-Z0-9._-]+@[a-zA-Z]{2,}$/.test(v),
    { message: 'Invalid UPI ID (e.g. yourname@upi or 9999999999@paytm)' }
  ).optional(),
});

type ProfileForm = z.infer<typeof profileSchema>;

export function ProfilePage() {
  const { user, profile, refreshProfile, signOut, deleteAccount } = useAuth();
  const navigate = useNavigate();
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      display_name: profile?.display_name ?? '',
      username: profile?.username ?? '',
      bio: profile?.bio ?? '',
      upi_id: profile?.upi_id ?? '',
    },
  });

  const onSave = async (data: ProfileForm) => {
    if (!user) return;
    setSaving(true);
    setError(null);
    const { error: updateError } = await db
      .from('profiles')
      .update({ display_name: data.display_name, username: data.username.toLowerCase(), bio: data.bio ?? null, upi_id: data.upi_id ?? null })
      .eq('id', user.id);
    setSaving(false);
    if (updateError) {
      setError(updateError.message.includes('unique') ? 'Username already taken.' : 'Failed to save profile.');
      return;
    }
    await refreshProfile();
    setEditMode(false);
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    const { error: delError } = await deleteAccount();
    if (delError) {
      setError('Failed to delete account. Contact support if this persists.');
      setDeleting(false);
      setDeleteConfirm(false);
      return;
    }
    navigate('/login', { replace: true });
  };

  return (
    <div>
      <PageHeader title="Profile" />
      <div className="page-content pt-4">
        {error && <ErrorMessage message={error} />}

        <div className="card flex flex-col items-center gap-3 mb-6">
          <Avatar
            src={profile?.avatar_url ?? null}
            name={profile?.display_name ?? user?.email ?? 'User'}
            size={64}
          />
          <div className="text-center">
            <p className="font-semibold text-primary">{profile?.display_name}</p>
            <p className="text-sm text-muted">@{profile?.username}</p>
            {profile?.bio && <p className="text-sm text-secondary mt-1">{profile.bio}</p>}
          </div>
          <button onClick={() => setEditMode(!editMode)} className="btn-secondary">
            {editMode ? 'Cancel' : 'Edit profile'}
          </button>
        </div>

        {editMode && (
          <form onSubmit={handleSubmit(onSave)} className="card mb-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-secondary mb-1">Display name</label>
              <input {...register('display_name')} className="input" />
              {errors.display_name && <p className="text-xs text-[rgb(var(--color-negative))] mt-1">{errors.display_name.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-secondary mb-1">Username</label>
              <input {...register('username')} className="input" />
              {errors.username && <p className="text-xs text-[rgb(var(--color-negative))] mt-1">{errors.username.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-secondary mb-1">Bio</label>
              <textarea {...register('bio')} className="input" rows={2} />
            </div>
            <div>
              <label className="block text-sm font-medium text-secondary mb-1">UPI ID</label>
              <input {...register('upi_id')} className="input" placeholder="yourname@upi" autoComplete="off" />
              {errors.upi_id && <p className="text-xs text-[rgb(var(--color-negative))] mt-1">{errors.upi_id.message}</p>}
              <p className="text-xs text-muted mt-1">Used for UPI payment links</p>
            </div>
            <button type="submit" className="btn-primary w-full" disabled={saving}>
              {saving ? <Spinner size={18} /> : null}
              Save changes
            </button>
          </form>
        )}

        <div className="card p-0 overflow-hidden mb-4">
          <Link to="/notifications" className="list-item">
            <Bell size={18} className="text-muted" />
            <span className="flex-1 text-sm font-medium text-primary">Notifications</span>
            <ChevronRight size={16} className="text-muted" />
          </Link>
        </div>

        <button onClick={() => void signOut()} className="btn-secondary w-full mb-3">
          <LogOut size={18} />
          Sign out
        </button>

        {!deleteConfirm ? (
          <button onClick={() => setDeleteConfirm(true)} className="btn-ghost w-full text-[rgb(var(--color-negative))] text-sm">
            Delete account
          </button>
        ) : (
          <div className="card border-[rgb(var(--color-negative)/0.3)]">
            <p className="text-sm font-semibold text-primary mb-2">Delete your account?</p>
            <p className="text-xs text-muted mb-4">This permanently removes your account and personal data. Outstanding debts and shared history may remain for other users.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={() => void handleDeleteAccount()} className="btn-danger flex-1" disabled={deleting}>
                {deleting ? <Spinner size={16} /> : null}
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
