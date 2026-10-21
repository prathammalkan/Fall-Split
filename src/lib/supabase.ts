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
    detectSessionInUrl: true,
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
 * Untyped client for mutations and migration-backed RPCs that are not yet
 * represented correctly by the generated Supabase schema types.
 * Prefer the typed client for ordinary reads.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as any;
