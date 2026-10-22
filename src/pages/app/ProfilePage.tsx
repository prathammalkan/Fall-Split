import { useEffect, useState } from 'react';
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
  username: z
    .string()
    .min(3, 'Min 3 characters')
    .max(30, 'Max 30 characters')
    .regex(/^[a-z0-9_]+$/, 'Only lowercase letters, numbers, underscores'),
  bio: z.string().max(160, 'Max 160 characters').optional(),
  // UPI ID must be name@provider format; empty string is allowed (clears the field)
  // Regex aligned with DB constraint: ^[a-zA-Z0-9._\-]+@[a-zA-Z0-9]+$
  upi_id: z
    .string()
    .max(50)
    .refine((v) => v === '' || /^[a-zA-Z0-9._-]+@[a-zA-Z0-9]+$/.test(v), {
      message: 'Invalid UPI ID (e.g. yourname@upi or 9999999999@paytm)',
    })
    .optional(),
});

type ProfileForm = z.infer<typeof profileSchema>;

export function ProfilePage() {
  const { user, profile, refreshProfile, signOut, deleteAccount } = useAuth();
  const navigate = useNavigate();
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profileRetrying, setProfileRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletionBlocked, setDeletionBlocked] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      display_name: profile?.display_name ?? '',
      username: profile?.username ?? '',
      bio: profile?.bio ?? '',
      upi_id: profile?.upi_id ?? '',
    },
  });

  useEffect(() => {
    if (!profile || editMode) return;
    reset({
      display_name: profile.display_name,
      username: profile.username,
      bio: profile.bio ?? '',
      upi_id: profile.upi_id ?? '',
    });
  }, [profile, editMode, reset]);

  const onSave = async (data: ProfileForm) => {
    if (!user) return;
    setSaving(true);
    setError(null);
    const { error: updateError } = await db
      .from('profiles')
      .update({
        display_name: data.display_name,
        username: data.username.toLowerCase(),
        bio: data.bio ?? null,
        upi_id: data.upi_id ?? null,
      })
      .eq('id', user.id);
    setSaving(false);
    if (updateError) {
      setError(
        updateError.message.includes('unique')
          ? 'Username already taken.'
          : 'Failed to save profile.'
      );
      return;
    }
    await refreshProfile();
    setEditMode(false);
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    const result = await deleteAccount();
    const delError = result.error;
    if (delError) {
      setError(delError.message);
      setDeletionBlocked(Boolean(result.partialFailure));
      setDeleting(false);
      if (!result.partialFailure) setDeleteConfirm(false);
      return;
    }
    navigate('/login', { replace: true });
  };

  const retryProfile = async () => {
    if (profileRetrying) return;
    setProfileRetrying(true);
    try {
      await refreshProfile();
    } finally {
      setProfileRetrying(false);
    }
  };

  return (
    <div>
      <PageHeader title="Profile" />
      <div className="page-content pt-4">
        {error && <ErrorMessage message={error} />}
        {user && !profile && !deletionBlocked && (
          <ErrorMessage
            message="Your profile could not be loaded. Please try again."
            retry={() => void retryProfile()}
            retryDisabled={profileRetrying}
          />
        )}

        <div className="card mb-6 flex flex-col items-center gap-3">
          <Avatar
            src={profile?.avatar_url ?? null}
            name={
              deletionBlocked ? 'Deleted User' : (profile?.display_name ?? user?.email ?? 'User')
            }
            size={64}
          />
          <div className="text-center">
            <p className="text-primary font-semibold">
              {deletionBlocked
                ? 'Account deactivated'
                : (profile?.display_name ?? 'Profile unavailable')}
            </p>
            {!deletionBlocked && profile && (
              <p className="text-muted text-sm">@{profile.username}</p>
            )}
            {!deletionBlocked && profile?.bio && (
              <p className="text-secondary mt-1 text-sm">{profile.bio}</p>
            )}
          </div>
          {!deletionBlocked && profile && (
            <button onClick={() => setEditMode(!editMode)} className="btn-secondary">
              {editMode ? 'Cancel' : 'Edit profile'}
            </button>
          )}
        </div>

        {editMode && !deletionBlocked && profile && (
          <form onSubmit={handleSubmit(onSave)} className="card mb-6 space-y-4">
            <div>
              <label className="text-secondary mb-1 block text-sm font-medium">Display name</label>
              <input {...register('display_name')} className="input" />
              {errors.display_name && (
                <p className="mt-1 text-xs text-[rgb(var(--color-negative))]">
                  {errors.display_name.message}
                </p>
              )}
            </div>
            <div>
              <label className="text-secondary mb-1 block text-sm font-medium">Username</label>
              <input {...register('username')} className="input" />
              {errors.username && (
                <p className="mt-1 text-xs text-[rgb(var(--color-negative))]">
                  {errors.username.message}
                </p>
              )}
            </div>
            <div>
              <label className="text-secondary mb-1 block text-sm font-medium">Bio</label>
              <textarea {...register('bio')} className="input" rows={2} />
            </div>
            <div>
              <label className="text-secondary mb-1 block text-sm font-medium">UPI ID</label>
              <input
                {...register('upi_id')}
                className="input"
                placeholder="yourname@upi"
                autoComplete="off"
              />
              {errors.upi_id && (
                <p className="mt-1 text-xs text-[rgb(var(--color-negative))]">
                  {errors.upi_id.message}
                </p>
              )}
              <p className="text-muted mt-1 text-xs">Used for UPI payment links</p>
            </div>
            <button type="submit" className="btn-primary w-full" disabled={saving}>
              {saving ? <Spinner size={18} /> : null}
              Save changes
            </button>
          </form>
        )}

        {!deletionBlocked && (
          <div className="card mb-4 overflow-hidden p-0">
            <Link to="/notifications" className="list-item">
              <Bell size={18} className="text-muted" />
              <span className="text-primary flex-1 text-sm font-medium">Notifications</span>
              <ChevronRight size={16} className="text-muted" />
            </Link>
          </div>
        )}

        <nav
          aria-label="Legal and support"
          className="card mb-4 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm"
        >
          <Link className="text-secondary underline-offset-4 hover:underline" to="/privacy">
            Privacy Policy
          </Link>
          <Link className="text-secondary underline-offset-4 hover:underline" to="/terms">
            Terms
          </Link>
          <Link className="text-secondary underline-offset-4 hover:underline" to="/support">
            Support
          </Link>
        </nav>

        <button onClick={() => void signOut()} className="btn-secondary mb-3 w-full">
          <LogOut size={18} />
          Sign out
        </button>

        {!deletionBlocked &&
          (!deleteConfirm ? (
            <button
              onClick={() => setDeleteConfirm(true)}
              className="btn-ghost w-full text-sm text-[rgb(var(--color-negative))]"
            >
              Delete account
            </button>
          ) : (
            <div className="card border-[rgb(var(--color-negative)/0.3)]">
              <p className="text-primary mb-2 text-sm font-semibold">Delete your account?</p>
              <p className="text-muted mb-4 text-xs">
                This removes your profile details, closes active memberships, clears pending offline
                expenses on this device, and deletes your sign-in identity. Shared expenses,
                settlements, and audit history remain attributed to a deleted-user profile so other
                participants’ balances stay correct.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteConfirm(false)} className="btn-secondary flex-1">
                  Cancel
                </button>
                <button
                  onClick={() => void handleDeleteAccount()}
                  className="btn-danger flex-1"
                  disabled={deleting}
                >
                  {deleting ? <Spinner size={16} /> : null}
                  Delete
                </button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
