/* ============================================================
   G-Logic Automation — Meta Token Exchange (Supabase Edge Function)
   ============================================================
   This file contains the code for a Supabase Edge Function.
   Deploy it via: Supabase Dashboard → Edge Functions → New Function
   
   Name: meta-token-exchange
   
   Required Secrets (set in Dashboard → Edge Functions → Secrets):
     - META_APP_ID
     - META_APP_SECRET
     - SUPABASE_URL        (auto-provided)
     - SUPABASE_ANON_KEY   (auto-provided)
     - SUPABASE_SERVICE_ROLE_KEY (auto-provided)
   ============================================================ */

// This is a Deno-based Edge Function for Supabase
// Export format: module.exports = async function(request) { ... }

module.exports = async function (request) {
    // CORS headers for browser requests
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    try {
        // Get secrets
        const META_APP_ID = Deno.env.get('META_APP_ID');
        const META_APP_SECRET = Deno.env.get('META_APP_SECRET');
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
        const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (!META_APP_ID || !META_APP_SECRET) {
            return new Response(JSON.stringify({ error: 'Meta App credentials not configured.' }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // Verify the user is authenticated
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) {
            return new Response(JSON.stringify({ error: 'Not authenticated' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // Parse request body
        const { code, redirect_uri } = await request.json();

        if (!code || !redirect_uri) {
            return new Response(JSON.stringify({ error: 'Missing code or redirect_uri' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // ========== STEP 1: Exchange code for short-lived token ==========
        const tokenUrl = `https://graph.facebook.com/v21.0/oauth/access_token`
            + `?client_id=${META_APP_ID}`
            + `&client_secret=${META_APP_SECRET}`
            + `&redirect_uri=${encodeURIComponent(redirect_uri)}`
            + `&code=${code}`;

        const tokenRes = await fetch(tokenUrl);
        const tokenData = await tokenRes.json();

        if (tokenData.error) {
            return new Response(JSON.stringify({
                error: `Token exchange failed: ${tokenData.error.message}`,
            }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const shortLivedToken = tokenData.access_token;

        // ========== STEP 2: Exchange for long-lived token ==========
        const longLivedUrl = `https://graph.facebook.com/v21.0/oauth/access_token`
            + `?grant_type=fb_exchange_token`
            + `&client_id=${META_APP_ID}`
            + `&client_secret=${META_APP_SECRET}`
            + `&fb_exchange_token=${shortLivedToken}`;

        const longLivedRes = await fetch(longLivedUrl);
        const longLivedData = await longLivedRes.json();

        if (longLivedData.error) {
            return new Response(JSON.stringify({
                error: `Long-lived token exchange failed: ${longLivedData.error.message}`,
            }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const longLivedToken = longLivedData.access_token;
        const expiresIn = longLivedData.expires_in || 5184000; // 60 days default
        const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

        // ========== STEP 3: Get Facebook Pages ==========
        const pagesRes = await fetch(
            `https://graph.facebook.com/v21.0/me/accounts?access_token=${longLivedToken}`
        );
        const pagesData = await pagesRes.json();

        if (!pagesData.data || pagesData.data.length === 0) {
            return new Response(JSON.stringify({
                error: 'No Facebook Pages found. Your Instagram must be linked to a Facebook Page.',
            }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // Use the first page (most users have one)
        const page = pagesData.data[0];
        const pageAccessToken = page.access_token;

        // ========== STEP 4: Get Instagram Business Account ==========
        const igRes = await fetch(
            `https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account&access_token=${pageAccessToken}`
        );
        const igData = await igRes.json();

        if (!igData.instagram_business_account) {
            return new Response(JSON.stringify({
                error: 'No Instagram Business account linked to this Facebook Page. Please convert your Instagram to a Business or Creator account first.',
            }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const igUserId = igData.instagram_business_account.id;

        // ========== STEP 5: Get Instagram username ==========
        const igProfileRes = await fetch(
            `https://graph.facebook.com/v21.0/${igUserId}?fields=username&access_token=${longLivedToken}`
        );
        const igProfile = await igProfileRes.json();
        const igUsername = igProfile.username || '';

        // ========== STEP 6: Get the Supabase user from JWT ==========
        // Import Supabase client inside the function
        const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // Verify the user token
        const jwt = authHeader.replace('Bearer ', '');
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(jwt);

        if (userError || !user) {
            return new Response(JSON.stringify({ error: 'Invalid authentication token' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // ========== STEP 7: Upsert into user_social_accounts table ==========
        const { error: upsertError } = await supabaseAdmin
            .from('user_social_accounts')
            .upsert({
                user_id: user.id,
                provider: 'instagram',
                provider_id: igUserId,
                ig_username: igUsername,
                access_token: longLivedToken,
                token_expires_at: tokenExpiresAt,
                is_active: true,
                updated_at: new Date().toISOString(),
            }, {
                onConflict: 'user_id,provider',
                ignoreDuplicates: false,
            });

        if (upsertError) {
            // If upsert fails due to no unique constraint, try insert/update separately
            const { data: existing } = await supabaseAdmin
                .from('user_social_accounts')
                .select('id')
                .eq('user_id', user.id)
                .eq('provider', 'instagram')
                .single();

            if (existing) {
                await supabaseAdmin
                    .from('user_social_accounts')
                    .update({
                        access_token: longLivedToken,
                        token_expires_at: tokenExpiresAt,
                        provider_id: igUserId,
                        ig_username: igUsername,
                        is_active: true,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', existing.id);
            } else {
                await supabaseAdmin
                    .from('user_social_accounts')
                    .insert({
                        user_id: user.id,
                        provider: 'instagram',
                        provider_id: igUserId,
                        ig_username: igUsername,
                        access_token: longLivedToken,
                        token_expires_at: tokenExpiresAt,
                        is_active: true,
                    });
            }
        }

        // Success!
        return new Response(JSON.stringify({
            success: true,
            ig_username: igUsername,
            ig_user_id: igUserId,
            expires_at: tokenExpiresAt,
        }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

    } catch (err) {
        console.error('Meta token exchange error:', err);
        return new Response(JSON.stringify({
            error: 'Internal server error: ' + (err.message || 'Unknown error'),
        }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
};
