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
    // Set to false so AuthCallbackPage explicitly controls the PKCE code exchange.
    // When true, the client races to consume the code_verifier from storage before
    // our callback page can call exchangeCodeForSession — causing a timeout.
    detectSessionInUrl: false,
    flowType: 'pkce',
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
