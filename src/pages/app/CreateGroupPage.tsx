import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../lib/supabase';
import { PageHeader } from '../../components/layout/PageHeader';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { Spinner } from '../../components/ui/Spinner';

const GROUP_TYPES = [
  { value: 'trip', label: '✈️ Trip & travel' },
  { value: 'household', label: '🏠 Roommates & household' },
  { value: 'event', label: '🎉 Events & occasions' },
  { value: 'custom', label: '⚡ Custom group' },
] as const;

type GroupType = (typeof GROUP_TYPES)[number]['value'];

export function CreateGroupPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [groupType, setGroupType] = useState<GroupType>('custom');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!user) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Group name is required.');
      return;
    }
    setSaving(true);
    setError(null);

    try {
      const { data: groupId, error: createError } = await db.rpc('create_group_with_owner', {
        p_name: trimmedName,
        p_description: description.trim() || null,
        p_type: groupType,
      });

      if (createError || typeof groupId !== 'string') {
        setError('Failed to create the group and add you as its admin. Please try again.');
        return;
      }

      navigate(`/groups/${groupId}`, { replace: true });
    } catch {
      setError('Failed to create the group and add you as its admin. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="New group" back />
      <div className="page-content space-y-4 pt-4">
        {error && <ErrorMessage message={error} />}

        <div className="grid grid-cols-2 gap-2">
          {GROUP_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setGroupType(t.value)}
              className={`rounded-xl px-4 py-3 text-left text-sm font-medium transition-colors ${
                groupType === t.value
                  ? 'bg-[rgb(var(--color-accent))] text-white'
                  : 'bg-tertiary text-secondary hover:bg-secondary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div>
          <label className="text-muted mb-1 block text-xs">Group name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Goa Trip 2025"
            className="input"
            maxLength={80}
            autoFocus
          />
        </div>

        <div>
          <label className="text-muted mb-1 block text-xs">Description (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this group for?"
            className="input"
            rows={2}
            maxLength={200}
          />
        </div>

        <div className="bg-tertiary rounded-lg p-3">
          <p className="text-muted text-xs">
            Currency: <span className="text-primary font-medium">₹ INR</span>
          </p>
          <p className="text-muted mt-1 text-xs">
            You can invite members after creating the group.
          </p>
        </div>

        <button
          onClick={() => void handleCreate()}
          disabled={saving || !name.trim()}
          className="btn-primary w-full"
        >
          {saving ? <Spinner size={18} /> : null}
          Create group
        </button>
      </div>
    </div>
  );
}
