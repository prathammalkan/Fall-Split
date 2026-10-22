import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { AuthProvider, useAuth } from './AuthContext';
import { db, supabase } from '../lib/supabase';

function StateProbe() {
  const { user, profile, loading } = useAuth();
  if (loading) return <div>loading</div>;
  return (
    <div>
      {user?.id ?? 'signed-out'}:{profile?.display_name ?? 'no-profile'}
    </div>
  );
}

function makeSession(userId: string): Session {
  return {
    access_token: 'test-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 4_000_000_000,
    refresh_token: 'test-refresh-token',
    user: {
      id: userId,
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2026-01-01T00:00:00.000Z',
      email: 'person@example.test',
      email_confirmed_at: '2026-01-01T00:00:00.000Z',
    },
  } as Session;
}

describe('AuthProvider session transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not restore an initial session after a newer sign-out event', async () => {
    let resolveInitialSession!: (result: unknown) => void;
    vi.mocked(supabase.auth.getSession).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveInitialSession = resolve;
      }) as never
    );

    let authCallback: ((event: string, session: Session | null) => void) | undefined;
    vi.mocked(supabase.auth.onAuthStateChange).mockImplementationOnce(((callback) => {
      authCallback = callback as (event: string, session: Session | null) => void;
      return {
        data: { subscription: { unsubscribe: vi.fn() } },
      } as unknown as ReturnType<typeof supabase.auth.onAuthStateChange>;
    }) as typeof supabase.auth.onAuthStateChange);

    render(
      <AuthProvider>
        <StateProbe />
      </AuthProvider>
    );
    expect(authCallback).toBeDefined();

    await act(async () => {
      authCallback?.('SIGNED_OUT', null);
    });
    await act(async () => {
      resolveInitialSession({ data: { session: makeSession('old-user') }, error: null });
    });

    await waitFor(() => expect(screen.getByText('signed-out:no-profile')).toBeTruthy());
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('loads profiles after returning from the synchronous auth callback', async () => {
    const session = makeSession('active-user');
    let authCallback: ((event: string, session: Session | null) => void) | undefined;
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
      data: { session: null },
      error: null,
    } as Awaited<ReturnType<typeof supabase.auth.getSession>>);
    vi.mocked(supabase.auth.onAuthStateChange).mockImplementationOnce(((callback) => {
      authCallback = callback as (event: string, session: Session | null) => void;
      return {
        data: { subscription: { unsubscribe: vi.fn() } },
      } as unknown as ReturnType<typeof supabase.auth.onAuthStateChange>;
    }) as typeof supabase.auth.onAuthStateChange);
    vi.mocked(db.rpc).mockResolvedValueOnce({
      data: [{ id: 'active-user', display_name: 'Active User' }],
      error: null,
    } as never);

    render(
      <AuthProvider>
        <StateProbe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByText('signed-out:no-profile')).toBeTruthy());

    await act(async () => {
      authCallback?.('SIGNED_IN', session);
    });
    expect(screen.getByText('active-user:no-profile')).toBeTruthy();

    await waitFor(() => expect(screen.getByText('active-user:Active User')).toBeTruthy());
    expect(db.rpc).toHaveBeenCalledWith('get_profile_for_user', { p_user_id: 'active-user' });
  });
});
