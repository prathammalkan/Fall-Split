import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
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
  signInWithMagicLink: (email: string) => Promise<{ error: Error | null }>;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  signInWithApple: () => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  updatePassword: (password: string) => Promise<{ error: Error | null }>;
  refreshProfile: () => Promise<void>;
  deleteAccount: () => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    profile: null,
    loading: true,
    emailVerified: false,
  });

  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      if (import.meta.env.DEV) {
        console.error('[AuthContext] Failed to fetch profile:', error.message);
      }
      return null;
    }
    return data;
  }, []);

  const refreshProfile = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const profile = await fetchProfile(user.id);
    setState((prev) => ({ ...prev, profile }));
  }, [fetchProfile]);

  useEffect(() => {
    // Initialize auth state
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const user = session?.user ?? null;
      const profile = user ? await fetchProfile(user.id) : null;
      const emailVerified = user?.email_confirmed_at != null || user?.phone_confirmed_at != null;
      setState({ session, user, profile, loading: false, emailVerified });
    });

    // Subscribe to auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        const user = session?.user ?? null;
        const emailVerified = user?.email_confirmed_at != null || user?.phone_confirmed_at != null;

        if (event === 'SIGNED_OUT') {
          // Clear all cached user data on logout
          setState({ session: null, user: null, profile: null, loading: false, emailVerified: false });
          return;
        }

        const profile = user ? await fetchProfile(user.id) : null;
        setState({ session, user, profile, loading: false, emailVerified });
      }
    );

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  }, []);

  const signInWithMagicLink = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        shouldCreateUser: true,
      },
    });
    return { error: error as Error | null };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    // Always use the current origin so the callback returns to the same domain
    // (localhost in dev, Vercel in prod). Using VITE_APP_URL here causes a
    // cross-origin mismatch that breaks the PKCE/implicit code exchange.
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
    return { error: error as Error | null };
  }, []);

  const signInWithApple = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    return { error: error as Error | null };
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: { full_name: displayName },
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
    // Calls a secure server-side function to handle cascading deletion
    const { error } = await supabase.functions.invoke('delete-account', {
      method: 'POST',
    });
    if (!error) {
      await supabase.auth.signOut();
    }
    return { error: error as Error | null };
  }, []);

  const value: AuthContextValue = {
    ...state,
    signInWithEmail,
    signInWithMagicLink,
    signInWithGoogle,
    signInWithApple,
    signUp,
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
