// G-Logic Automation — Meta Token Exchange (Supabase Edge Function)
// Deno runtime — pure fetch, no SDK imports needed
//
// Deploy via: Supabase Dashboard → Edge Functions → New Function
// Name: meta-token-exchange
//
// Required Secrets (auto-provided by Supabase — no manual setup needed):
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
//
// Required Secrets (set manually in Dashboard → Edge Functions → Secrets):
//   META_APP_ID
//   META_APP_SECRET

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        return new Response('ok', { status: 200, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    try {
        // ===== ENV VARS =====
        const META_APP_ID       = Deno.env.get('META_APP_ID');
        const META_APP_SECRET   = Deno.env.get('META_APP_SECRET');
        const SUPABASE_URL      = Deno.env.get('SUPABASE_URL');
        const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
        const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (!META_APP_ID || !META_APP_SECRET) {
            return new Response(JSON.stringify({ error: 'Meta credentials not configured.' }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) {
            return new Response(JSON.stringify({ error: 'Supabase credentials not configured.' }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // ===== AUTH CHECK =====
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) {
            return new Response(JSON.stringify({ error: 'Not authenticated' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // ===== PARSE BODY =====
        const { code, redirect_uri } = await request.json();
        if (!code || !redirect_uri) {
            return new Response(JSON.stringify({ error: 'Missing code or redirect_uri' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // ===== STEP 1: Short-lived token =====
        const tokenRes = await fetch(
            `https://graph.facebook.com/v21.0/oauth/access_token` +
            `?client_id=${META_APP_ID}` +
            `&client_secret=${META_APP_SECRET}` +
            `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
            `&code=${code}`
        );
        const tokenData = await tokenRes.json();
        if (tokenData.error) {
            return new Response(JSON.stringify({ error: `Token exchange failed: ${tokenData.error.message}` }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // ===== STEP 2: Long-lived token =====
        const longRes = await fetch(
            `https://graph.facebook.com/v21.0/oauth/access_token` +
            `?grant_type=fb_exchange_token` +
            `&client_id=${META_APP_ID}` +
            `&client_secret=${META_APP_SECRET}` +
            `&fb_exchange_token=${tokenData.access_token}`
        );
        const longData = await longRes.json();
        if (longData.error) {
            return new Response(JSON.stringify({ error: `Long-lived token failed: ${longData.error.message}` }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const longLivedToken = longData.access_token;
        const tokenExpiresAt = new Date(Date.now() + (longData.expires_in || 5184000) * 1000).toISOString();

        // ===== STEP 3: Facebook Pages =====
        // Run /me, /me/permissions, and /me/accounts in parallel for diagnostics
        const [meRes, permsRes, pagesRes] = await Promise.all([
            fetch(`https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${longLivedToken}`),
            fetch(`https://graph.facebook.com/v21.0/me/permissions?access_token=${longLivedToken}`),
            fetch(`https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account&limit=50&access_token=${longLivedToken}`),
        ]);
        const [meData, permsData, pagesData] = await Promise.all([meRes.json(), permsRes.json(), pagesRes.json()]);
        console.log('Step 3 /me:', JSON.stringify(meData));
        console.log('Step 3 /me/permissions:', JSON.stringify(permsData));
        console.log('Step 3 /me/accounts:', JSON.stringify(pagesData));

        if (pagesData.error) {
            return new Response(JSON.stringify({
                error: `Meta API error (Step 3): ${pagesData.error.message}`,
                meta_error: pagesData.error,
                debug: 'Failed at /me/accounts — token may lack pages_show_list permission'
            }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        if (!pagesData.data?.length) {
            // Build a readable permissions list for diagnosis
            const grantedPerms = (permsData.data || [])
                .filter(p => p.status === 'granted')
                .map(p => p.permission);
            return new Response(JSON.stringify({
                error: 'No Facebook Pages found. Link your Instagram to a Facebook Page first.',
                debug_fb_user: meData,
                debug_granted_permissions: grantedPerms,
                debug_pages_response: pagesData,
                hint: 'pages_show_list must be granted AND the Facebook account must admin at least one Page'
            }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const page = pagesData.data[0];
        console.log('Step 3 using page:', page.id, page.name);

        // ===== STEP 4: Instagram Business Account =====
        const igRes = await fetch(`https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`);
        const igData = await igRes.json();
        console.log('Step 4 IG business account raw response:', JSON.stringify(igData));

        if (igData.error) {
            return new Response(JSON.stringify({
                error: `Meta API error (Step 4): ${igData.error.message}`,
                meta_error: igData.error,
                debug: `Failed fetching IG account for page ${page.id} (${page.name})`
            }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        if (!igData.instagram_business_account) {
            return new Response(JSON.stringify({
                error: `No Instagram Business account linked to Facebook Page "${page.name}".`,
                debug_meta_response: igData,
                hint: 'instagram_business_account was null — the IG account must be a Professional (Business or Creator) account and linked to this Facebook Page'
            }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const igUserId = igData.instagram_business_account.id;

        // ===== STEP 5: Instagram username =====
        const igProfile  = await (
            await fetch(`https://graph.facebook.com/v21.0/${igUserId}?fields=username&access_token=${longLivedToken}`)
        ).json();
        const igUsername = igProfile.username || '';

        // ===== STEP 6: Verify user JWT via Supabase Auth REST API =====
        const userRes  = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: {
                'Authorization': authHeader,
                'apikey': SUPABASE_ANON_KEY,
            },
        });
        const userData = await userRes.json();

        if (!userRes.ok || !userData?.id) {
            return new Response(JSON.stringify({ error: 'Invalid authentication token' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const userId = userData.id;

        // ===== STEP 7: Upsert into user_social_accounts =====
        const accountData = {
            user_id:          userId,
            provider:         'instagram',
            provider_id:      igUserId,
            ig_username:      igUsername,
            access_token:     longLivedToken,
            token_expires_at: tokenExpiresAt,
            is_active:        true,
            updated_at:       new Date().toISOString(),
        };

        const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/user_social_accounts`, {
            method:  'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
                'apikey': SERVICE_ROLE_KEY,
                'Prefer': 'resolution=merge-duplicates,return=minimal',
            },
            body: JSON.stringify(accountData),
        });

        if (!upsertRes.ok) {
            const errBody = await upsertRes.text();
            console.error('Supabase upsert error:', errBody);
            return new Response(JSON.stringify({ error: 'Failed to save Instagram account: ' + errBody }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // ===== SUCCESS =====
        return new Response(JSON.stringify({
            success:     true,
            ig_username: igUsername,
            ig_user_id:  igUserId,
            expires_at:  tokenExpiresAt,
        }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

    } catch (err) {
        console.error('meta-token-exchange error:', err);
        return new Response(JSON.stringify({ error: 'Server error: ' + (err.message || 'Unknown') }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
