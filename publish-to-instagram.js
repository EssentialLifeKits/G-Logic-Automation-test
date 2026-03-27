/* ============================================================
   G-Logic Automation — Edge Function: publish_to_instagram
   ============================================================
   Supabase Edge Function (Deno runtime)
   
   WHAT THIS DOES:
   Takes an image URL + caption from the G-Logic frontend
   and publishes it to the Instagram Business account whose
   credentials are stored in user_social_accounts.

   HOW TO DEPLOY:
   1. Supabase Dashboard → Edge Functions → "New Function"
   2. Name it: publish_to_instagram
   3. Paste this file's contents into the editor
   4. Click "Deploy"

   REQUIRED SECRETS (Dashboard → Edge Functions → Secrets):
   - META_APP_ID              Your Meta App ID
   - META_APP_SECRET          Your Meta App Secret
   - SUPABASE_URL             Auto-provided by Supabase
   - SUPABASE_SERVICE_ROLE_KEY Auto-provided by Supabase

   REQUEST FORMAT (POST):
   {
     "imageUrl": "https://public-cdn.example.com/image.jpg",
     "caption":  "Your caption here ✨\n\n#essentiallifekits #lifestyle",
     "postId":   "optional-uuid-of-post-in-posts-table"
   }

   NOTES:
   - imageUrl MUST be publicly accessible (no auth headers).
     Use Supabase Storage public bucket URLs.
   - caption can include line breaks (\n) and emojis.
   - postId is optional. If provided, the post row is updated
     to status='published' or status='failed' after the call.
   ============================================================ */

module.exports = async function (request) {

    // ----- CORS Headers (allow your app's origin) -----
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };

    const json = (data, status = 200) =>
        new Response(JSON.stringify(data), {
            status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

    // Preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
        return json({ error: 'Method not allowed. Use POST.' }, 405);
    }

    // ---- Auth check ----
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return json({ error: 'Missing or invalid Authorization header.' }, 401);
    }

    // ---- Parse request body ----
    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Invalid JSON body.' }, 400);
    }

    const { imageUrl, caption, postId } = body;

    if (!imageUrl || !caption) {
        return json({ error: 'Both imageUrl and caption are required.' }, 400);
    }

    // ---- Load credentials from Supabase Secrets ----
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const GRAPH_API_VERSION = 'v21.0';
    const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return json({ error: 'Missing Supabase environment secrets.' }, 500);
    }

    // ---- Init Supabase Admin client ----
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ---- Verify the user's JWT and get their user ID ----
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(jwt);

    if (authError || !user) {
        return json({ error: 'Invalid or expired session. Please sign in again.' }, 401);
    }

    // ---- Fetch the Instagram credentials for this user ----
    const { data: account, error: acctError } = await supabaseAdmin
        .from('user_social_accounts')
        .select('access_token, provider_id, ig_username, token_expires_at')
        .eq('user_id', user.id)
        .eq('provider', 'instagram')
        .eq('is_active', true)
        .maybeSingle();

    if (acctError || !account) {
        return json({
            error: 'No active Instagram connection found. Please connect your Instagram account first.',
        }, 404);
    }

    // ---- Check token expiry ----
    if (new Date(account.token_expires_at) < new Date()) {
        return json({
            error: 'Your Instagram access token has expired. Please reconnect your account.',
        }, 401);
    }

    const { access_token, provider_id: igUserId, ig_username } = account;

    // ============================================================
    // META GRAPH API — TWO-STEP IMAGE PUBLISHING
    // ============================================================
    // Step 1: Create a media container
    // Step 2: Publish the container
    // ============================================================

    let igMediaId = null;

    try {
        console.log(`📷 [publish_to_instagram] Publishing for @${ig_username} (IG ID: ${igUserId})`);
        console.log(`   Image URL: ${imageUrl}`);
        console.log(`   Caption:   ${caption.substring(0, 80)}...`);

        // ---- STEP 1: Create Image Container ----
        const containerRes = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image_url: imageUrl,
                caption: caption,
                access_token: access_token,
            }),
        });

        const containerData = await containerRes.json();

        if (containerData.error) {
            throw new Error(
                `Container creation failed (${containerData.error.code}): ${containerData.error.message}`
            );
        }

        const creationId = containerData.id;
        console.log(`   ✅ Container created: ${creationId}`);

        // ---- STEP 2: Publish the Container ----
        const publishRes = await fetch(`${GRAPH_BASE}/${igUserId}/media_publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                creation_id: creationId,
                access_token: access_token,
            }),
        });

        const publishData = await publishRes.json();

        if (publishData.error) {
            throw new Error(
                `Publish failed (${publishData.error.code}): ${publishData.error.message}`
            );
        }

        igMediaId = publishData.id;
        console.log(`   🎉 Published! IG Media ID: ${igMediaId}`);

    } catch (err) {
        console.error(`   ❌ Publishing error: ${err.message}`);

        // Mark the post as failed in the database (if postId was provided)
        if (postId) {
            await supabaseAdmin
                .from('posts')
                .update({
                    status: 'failed',
                    publish_error: err.message,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', postId)
                .eq('user_id', user.id);
        }

        return json({ error: `Publishing failed: ${err.message}` }, 502);
    }

    // ---- Mark post as published in DB (if postId provided) ----
    if (postId) {
        await supabaseAdmin
            .from('posts')
            .update({
                status: 'published',
                ig_media_id: igMediaId,
                publish_error: null,
                updated_at: new Date().toISOString(),
            })
            .eq('id', postId)
            .eq('user_id', user.id);
    }

    // ---- Success response ----
    return json({
        success: true,
        ig_media_id: igMediaId,
        ig_username: ig_username,
        message: `Post published successfully to @${ig_username}!`,
        published_at: new Date().toISOString(),
    });
};
