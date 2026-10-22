import { describe, expect, it, vi } from 'vitest';
import { completeAccountDeletion } from './accountDeletion';

describe('completeAccountDeletion', () => {
  it('reports partial completion and keeps the caller present when Auth-user deletion fails', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const result = await completeAccountDeletion({
      anonymizeProfile: vi.fn().mockResolvedValue({ error: null }),
      clearOfflineQueue: vi.fn().mockResolvedValue({ error: null }),
      deleteAuthUser: vi.fn().mockResolvedValue({ error: new Error('delete failed') }),
      signOut,
    });

    expect(result.error?.message).toContain('account deletion could not be completed');
    expect(result.partialFailure).toBe(true);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('stops before Auth deletion when profile anonymization fails', async () => {
    const deleteAuthUser = vi.fn();
    const result = await completeAccountDeletion({
      anonymizeProfile: vi.fn().mockResolvedValue({ error: new Error('anonymize failed') }),
      clearOfflineQueue: vi.fn(),
      deleteAuthUser,
      signOut: vi.fn(),
    });

    expect(result.error?.message).toBe('anonymize failed');
    expect(result.partialFailure).toBeUndefined();
    expect(deleteAuthUser).not.toHaveBeenCalled();
  });

  it('reports partial completion when local sign-out fails after Auth deletion', async () => {
    const result = await completeAccountDeletion({
      anonymizeProfile: vi.fn().mockResolvedValue({ error: null }),
      clearOfflineQueue: vi.fn().mockResolvedValue({ error: null }),
      deleteAuthUser: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: new Error('sign-out failed') }),
    });

    expect(result.error?.message).toContain('Auth-user deletion completed');
    expect(result.partialFailure).toBe(true);
  });

  it('reports success only after anonymization, Auth deletion, and sign-out succeed', async () => {
    const result = await completeAccountDeletion({
      anonymizeProfile: vi.fn().mockResolvedValue({ error: null }),
      clearOfflineQueue: vi.fn().mockResolvedValue({ error: null }),
      deleteAuthUser: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    });

    expect(result).toEqual({ error: null });
  });

  it('still deletes the Auth identity if local offline data cannot be cleared', async () => {
    const deleteAuthUser = vi.fn().mockResolvedValue({ error: null });
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const result = await completeAccountDeletion({
      anonymizeProfile: vi.fn().mockResolvedValue({ error: null }),
      clearOfflineQueue: vi.fn().mockResolvedValue({ error: new Error('IndexedDB unavailable') }),
      deleteAuthUser,
      signOut,
    });

    expect(result.error?.message).toContain('Auth-user deletion completed');
    expect(result.error?.message).toContain("Clear this site's data");
    expect(result.partialFailure).toBe(true);
    expect(deleteAuthUser).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledOnce();
  });
});
