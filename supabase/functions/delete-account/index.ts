import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * delete-account Edge Function
 *
 * Securely deletes a user's account and associated data.
 * Requires the user to be authenticated.
 *
 * The function:
 * 1. Verifies the caller is authenticated.
 * 2. Soft-deletes the user profile (sets deleted_at).
 * 3. Removes the user from all active group memberships.
 * 4. Deletes the Auth user (via service-role client).
 *
 * Financial records (expenses, settlements, expense_shares) are NOT hard-deleted
 * because they affect other users' balances and represent immutable financial history.
 * The profile row is soft-deleted; the display_name is anonymized.
 *
 * Security: This function uses the SERVICE_ROLE_KEY server-side only.
 * It is NEVER exposed to the browser.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
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

    // 1. Soft-delete and anonymize the profile
    const { error: profileError } = await adminClient
      .from('profiles')
      .update({
        deleted_at: new Date().toISOString(),
        display_name: '[Deleted User]',
        username: `deleted_${userId.substring(0, 8)}`,
        avatar_url: null,
        bio: null,
        upi_id: null,
      })
      .eq('id', userId);

    if (profileError) {
      console.error('Profile soft-delete error:', profileError);
      // Continue anyway — auth deletion is more critical
    }

    // 2. Remove from all active group memberships
    const { error: memberError } = await adminClient
      .from('group_members')
      .update({ removed_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('removed_at', null);

    if (memberError) {
      console.error('Group member removal error:', memberError);
    }

    // 3. Cancel pending friend requests
    const { error: frError } = await adminClient
      .from('friend_requests')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .eq('status', 'pending');

    if (frError) {
      console.error('Friend request cancellation error:', frError);
    }

    // 4. Revoke all invitation tokens
    const { error: tokenError } = await adminClient
      .from('invitation_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('creator_id', userId)
      .is('revoked_at', null);

    if (tokenError) {
      console.error('Token revocation error:', tokenError);
    }

    // 5. Delete the Auth user (this is irreversible)
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteError) {
      return new Response(
        JSON.stringify({ error: 'Failed to delete account. Please try again or contact support.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Unexpected error in delete-account:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
