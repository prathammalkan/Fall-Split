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

type GroupType = typeof GROUP_TYPES[number]['value'];

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
    if (!trimmedName) { setError('Group name is required.'); return; }
    setSaving(true);
    setError(null);

    const { data, error: createErr } = await db
      .from('groups')
      .insert({
        name: trimmedName,
        description: description.trim() || null,
        type: groupType,
        currency: 'INR',
        creator_id: user.id,
      })
      .select('id')
      .single();

    if (createErr || !data) {
      setSaving(false);
      setError('Failed to create group. Please try again.');
      return;
    }

    // Add creator as admin member
    await db.from('group_members').insert({
      group_id: data.id,
      user_id: user.id,
      role: 'admin',
    });

    navigate(`/groups/${data.id}`, { replace: true });
  };

  return (
    <div>
      <PageHeader title="New group" back />
      <div className="page-content pt-4 space-y-4">
        {error && <ErrorMessage message={error} />}

        <div className="grid grid-cols-2 gap-2">
          {GROUP_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setGroupType(t.value)}
              className={`py-3 px-4 rounded-xl text-sm font-medium text-left transition-colors ${
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
          <label className="block text-xs text-muted mb-1">Group name *</label>
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
          <label className="block text-xs text-muted mb-1">Description (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this group for?"
            className="input"
            rows={2}
            maxLength={200}
          />
        </div>

        <div className="rounded-lg p-3 bg-tertiary">
          <p className="text-xs text-muted">Currency: <span className="font-medium text-primary">₹ INR</span></p>
          <p className="text-xs text-muted mt-1">You can invite members after creating the group.</p>
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
