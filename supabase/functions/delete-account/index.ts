import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * delete-account Edge Function
 *
 * Attempts Auth-user deletion after profile deactivation.
 * Requires the user to be authenticated.
 *
 * The caller must first invoke delete_account(), which transactionally
 * anonymizes the profile and closes active relationships. This function then
 * verifies that tombstone before attempting irreversible Auth-user deletion.
 *
 * Financial rows and their pseudonymized profile references are retained for
 * balances and auditability. Migration 20261021223159 removes only the profile
 * cascade to auth.users so Auth deletion does not erase ledger attribution.
 *
 * Security: This function uses the SERVICE_ROLE_KEY server-side only.
 * It is NEVER exposed to the browser.
 */

const BASE_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
};

function resolveCorsHeaders(req: Request): Record<string, string> | null {
  const configured = Deno.env.get('ALLOWED_ORIGINS');
  const origin = req.headers.get('Origin');

  if (configured && configured.trim().length > 0) {
    const allowed = configured
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (origin && !allowed.includes(origin)) {
      return null;
    }
    return {
      ...BASE_SECURITY_HEADERS,
      'Access-Control-Allow-Origin': origin && allowed.includes(origin) ? origin : allowed[0]!,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      Vary: 'Origin',
    };
  }

  return {
    ...BASE_SECURITY_HEADERS,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

serve(async (req: Request) => {
  const corsHeaders = resolveCorsHeaders(req);
  if (!corsHeaders) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { ...BASE_SECURITY_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Create a Supabase client with the user's JWT (anon key)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the user's JWT and get their ID
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;

    // Use service-role client for admin operations
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // The database RPC must commit the tombstone before Auth deletion starts.
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('id, deleted_at')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) {
      return new Response(
        JSON.stringify({ error: 'Could not verify the anonymized account profile; Auth-user deletion was not attempted.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!profile || !profile.deleted_at) {
      return new Response(
        JSON.stringify({ error: 'Account profile must be anonymized before Auth-user deletion.' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Auth deletion is intentionally attempted only after the profile
    // tombstone commits; the retention migration preserves its ledger references.
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteError) {
      return new Response(
        JSON.stringify({ error: 'Profile data was anonymized, but Auth-user deletion failed. Financial history is retained; contact support.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error in delete-account', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
