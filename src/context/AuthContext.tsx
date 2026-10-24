import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { db, supabase } from '../lib/supabase';
import { completeAccountDeletion } from '../lib/accountDeletion';
import { clearOperationsForUser } from '../lib/offlineQueue';
import { isSafeRedirect } from '../lib/safeRedirect';
import type { Profile } from '../types';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  emailVerified: boolean;
}

interface AuthContextValue extends AuthState {
  signInWithEmail: (email: string, password: string) => Promise<{ error: Error | null }>;
  signInWithMagicLink: (email: string, redirectTo?: string) => Promise<{ error: Error | null }>;
  signInWithGoogle: (redirectTo?: string) => Promise<{ error: Error | null }>;
  signInWithApple: (redirectTo?: string) => Promise<{ error: Error | null }>;
  signUp: (
    email: string,
    password: string,
    displayName: string,
    redirectTo?: string
  ) => Promise<{ error: Error | null }>;
  resendVerificationEmail: (email: string, redirectTo?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  updatePassword: (password: string) => Promise<{ error: Error | null }>;
  refreshProfile: () => Promise<void>;
  deleteAccount: () => Promise<{ error: Error | null; partialFailure?: boolean }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function getAuthCallbackUrl(redirectTo?: string): string {
  const callback = new URL('/auth/callback', window.location.origin);
  if (isSafeRedirect(redirectTo)) {
    callback.searchParams.set('redirect', redirectTo);
  }
  return callback.toString();
}

async function readFunctionError(error: Error | null): Promise<Error | null> {
  if (!error) return null;
  if (!(error instanceof FunctionsHttpError) || !(error.context instanceof Response)) {
    return error;
  }

  const payload: unknown = await error.context.clone().json();
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'error' in payload &&
    typeof payload.error === 'string'
  ) {
    return new Error(payload.error);
  }
  return error;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    profile: null,
    loading: true,
    emailVerified: false,
  });

  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    const { data, error } = await db.rpc('get_profile_for_user', {
      p_user_id: userId,
    });

    if (error) {
      if (import.meta.env.DEV) {
        console.error('[AuthContext] Failed to fetch profile:', error.message);
      }
      return null;
    }
    return data?.[0] ?? null;
  }, []);

  const refreshProfile = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const profile = await fetchProfile(user.id);
    setState((prev) => (prev.user?.id === user.id ? { ...prev, profile } : prev));
  }, [fetchProfile]);

  useEffect(() => {
    let active = true;
    let eventVersion = 0;

    const applySession = (session: Session | null, version: number) => {
      const user = session?.user ?? null;
      const emailVerified = user?.email_confirmed_at != null || user?.phone_confirmed_at != null;

      if (!user) {
        setState({
          session: null,
          user: null,
          profile: null,
          loading: false,
          emailVerified: false,
        });
        return;
      }

      setState((previous) => ({
        session,
        user,
        profile: previous.user?.id === user.id ? previous.profile : null,
        loading: false,
        emailVerified,
      }));

      // Supabase auth callbacks run while its auth lock is held. Defer the
      // profile RPC until after the callback returns, and discard stale results
      // if a newer sign-in/sign-out event arrives first.
      window.setTimeout(() => {
        if (!active || version !== eventVersion) return;
        void fetchProfile(user.id).then((profile) => {
          if (!active || version !== eventVersion) return;
          setState((previous) =>
            previous.user?.id === user.id ? { ...previous, profile } : previous
          );
        });
      }, 0);
    };

    const initialVersion = eventVersion;
    void supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (active && eventVersion === initialVersion) {
          applySession(session, initialVersion);
        }
      })
      .catch(() => {
        if (active && eventVersion === initialVersion) {
          setState({
            session: null,
            user: null,
            profile: null,
            loading: false,
            emailVerified: false,
          });
        }
      });

    // Subscribe to auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      eventVersion += 1;
      applySession(session, eventVersion);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  }, []);

  const signInWithMagicLink = useCallback(async (email: string, redirectTo?: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: getAuthCallbackUrl(redirectTo),
        shouldCreateUser: true,
      },
    });
    return { error: error as Error | null };
  }, []);

  const signInWithGoogle = useCallback(async (redirectTo?: string) => {
    // Always use the current origin so the callback returns to the same domain
    // (localhost in dev, Vercel in prod). Using VITE_APP_URL here causes a
    // cross-origin mismatch that breaks the PKCE/implicit code exchange.
    const callbackUrl = getAuthCallbackUrl(redirectTo);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callbackUrl,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
    return { error: error as Error | null };
  }, []);

  const signInWithApple = useCallback(async (redirectTo?: string) => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: getAuthCallbackUrl(redirectTo) },
    });
    return { error: error as Error | null };
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, displayName: string, redirectTo?: string) => {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: getAuthCallbackUrl(redirectTo),
          data: { full_name: displayName },
        },
      });
      return { error: error as Error | null };
    },
    []
  );

  const resendVerificationEmail = useCallback(async (email: string, redirectTo?: string) => {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: getAuthCallbackUrl(redirectTo),
      },
    });
    return { error: error as Error | null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    // State cleared by auth event listener
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return { error: error as Error | null };
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    return { error: error as Error | null };
  }, []);

  const deleteAccount = useCallback(async () => {
    const userId = state.user?.id;
    const result = await completeAccountDeletion({
      anonymizeProfile: async () => {
        const { data, error } = await db.rpc('delete_account');
        if (error) return { error };
        if (data && typeof data === 'object' && 'error' in data && data.error) {
          return { error: new Error(String(data.error)) };
        }
        return { error: null };
      },
      clearOfflineQueue: async () => {
        if (!userId)
          return { error: new Error('Signed-in user is required to clear offline data') };
        try {
          await clearOperationsForUser(userId);
          return { error: null };
        } catch (error) {
          return {
            error:
              error instanceof Error
                ? error
                : new Error('Offline expense data could not be cleared'),
          };
        }
      },
      deleteAuthUser: async () => {
        const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
        return { error: await readFunctionError(error as Error | null) };
      },
      signOut: async () => {
        const { error } = await supabase.auth.signOut();
        return { error: error as Error | null };
      },
    });
    if (result.partialFailure) {
      await refreshProfile();
    }
    return result;
  }, [refreshProfile, state.user?.id]);

  const value: AuthContextValue = {
    ...state,
    signInWithEmail,
    signInWithMagicLink,
    signInWithGoogle,
    signInWithApple,
    signUp,
    resendVerificationEmail,
    signOut,
    resetPassword,
    updatePassword,
    refreshProfile,
    deleteAccount,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

/** Guard: returns true only if the user is authenticated AND email-verified */
// eslint-disable-next-line react-refresh/only-export-components
export function useRequireVerified(): { ready: boolean; loading: boolean } {
  const { session, emailVerified, loading } = useAuth();
  return {
    ready: !!session && emailVerified,
    loading,
  };
}
