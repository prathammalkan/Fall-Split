import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types';

const supabaseUrl = import.meta.env['VITE_SUPABASE_URL'] as string;
const supabaseAnonKey = import.meta.env['VITE_SUPABASE_ANON_KEY'] as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Copy .env.example to .env.local and fill in the values.'
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    // implicit flow: tokens arrive in the URL hash — correct for a pure client-side SPA.
    // PKCE requires server-side cookie storage for the code_verifier; using it in a
    // Vite SPA causes "code verifier not found" when the OAuth origin differs from
    // the callback origin (e.g. Vercel → localhost redirect).
    detectSessionInUrl: true,
    flowType: 'implicit',
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
  global: {
    headers: {
      'X-Client-Info': 'fall-split/1.0.0',
    },
  },
  db: {
    schema: 'public',
  },
});

export type SupabaseClient = typeof supabase;

/**
 * Untyped Supabase client for mutations (insert/update) where the typed client
 * produces `never` due to strict Update type inference conflicts.
 * Only use for write operations; use `supabase` for reads.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as any;
