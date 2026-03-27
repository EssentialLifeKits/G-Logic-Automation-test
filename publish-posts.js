/* ============================================================
   G-Logic Automation — Post Publisher (GitHub Actions Cron Job Target)
   ============================================================
   This script is designed to be run by a GitHub Actions cron job
   every hour. It queries Supabase for due posts and publishes
   them to Instagram via the Meta Graph API.

   Usage: node publish-posts.js

   Required Environment Variables:
     SUPABASE_URL           - Your Supabase project URL
     SUPABASE_SERVICE_KEY   - Your Supabase service_role key (bypasses RLS)
   ============================================================ */

const GRAPH_API_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const POLL_INTERVAL_MS = 5000;  // 5 seconds between status checks
const MAX_POLL_ATTEMPTS = 60;   // Max 5 minutes of polling (60 × 5s)

// ========== SUPABASE SETUP ==========
async function createSupabaseClient() {
    // Dynamic import for ESM compatibility
    const { createClient } = await import('@supabase/supabase-js');

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;

    if (!url || !key) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables');
    }

    return createClient(url, key);
}

// ========== GRAPH API HELPERS ==========

/**
 * Publish an IMAGE post to Instagram
 * Two-step process: Create container → Publish container
 */
async function publishImage(igUserId, accessToken, imageUrl, caption) {
    console.log(`  📷 Publishing IMAGE for @${igUserId}...`);

    // Step 1: Create media container
    const createRes = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            image_url: imageUrl,
            caption: caption,
            access_token: accessToken,
        }),
    });
    const createData = await createRes.json();

    if (createData.error) {
        throw new Error(`Container creation failed: ${createData.error.message}`);
    }

    const creationId = createData.id;
    console.log(`  ✅ Container created: ${creationId}`);

    // Step 2: Publish the container
    const publishRes = await fetch(`${GRAPH_BASE}/${igUserId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            creation_id: creationId,
            access_token: accessToken,
        }),
    });
    const publishData = await publishRes.json();

    if (publishData.error) {
        throw new Error(`Publish failed: ${publishData.error.message}`);
    }

    console.log(`  🎉 Published! IG Media ID: ${publishData.id}`);
    return publishData.id;
}

/**
 * Publish a VIDEO / REEL to Instagram
 * Three-step process: Create container → Poll status → Publish
 */
async function publishVideo(igUserId, accessToken, videoUrl, caption) {
    console.log(`  🎬 Publishing VIDEO/REEL for @${igUserId}...`);

    // Step 1: Create media container for Reel
    const createRes = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            video_url: videoUrl,
            caption: caption,
            media_type: 'REELS',
            access_token: accessToken,
        }),
    });
    const createData = await createRes.json();

    if (createData.error) {
        throw new Error(`Reel container creation failed: ${createData.error.message}`);
    }

    const creationId = createData.id;
    console.log(`  ✅ Reel container created: ${creationId}. Polling for processing...`);

    // Step 2: Poll until the video is processed
    let statusCode = 'IN_PROGRESS';
    let attempts = 0;

    while (statusCode !== 'FINISHED' && attempts < MAX_POLL_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        attempts++;

        const statusRes = await fetch(
            `${GRAPH_BASE}/${creationId}?fields=status_code&access_token=${accessToken}`
        );
        const statusData = await statusRes.json();

        if (statusData.error) {
            throw new Error(`Status check failed: ${statusData.error.message}`);
        }

        statusCode = statusData.status_code;
        console.log(`  ⏳ Poll #${attempts}: status = ${statusCode}`);

        if (statusCode === 'ERROR') {
            throw new Error('Video processing failed on Instagram servers.');
        }
    }

    if (statusCode !== 'FINISHED') {
        throw new Error(`Video processing timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s`);
    }

    // Step 3: Publish the container
    const publishRes = await fetch(`${GRAPH_BASE}/${igUserId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            creation_id: creationId,
            access_token: accessToken,
        }),
    });
    const publishData = await publishRes.json();

    if (publishData.error) {
        throw new Error(`Reel publish failed: ${publishData.error.message}`);
    }

    console.log(`  🎉 Reel published! IG Media ID: ${publishData.id}`);
    return publishData.id;
}

// ========== MAIN PUBLISHING LOGIC ==========
async function main() {
    console.log('==============================================');
    console.log('G-Logic Automation Publisher — Starting publish cycle');
    console.log(`Time: ${new Date().toISOString()}`);
    console.log('==============================================\n');

    const supabase = await createSupabaseClient();

    // 1. Query for posts that are due
    const now = new Date().toISOString();
    const { data: duePosts, error: queryError } = await supabase
        .from('posts')
        .select('*')
        .eq('status', 'pending')
        .lte('scheduled_time', now)
        .order('scheduled_time', { ascending: true });

    if (queryError) {
        console.error('❌ Error querying posts:', queryError.message);
        process.exit(1);
    }

    if (!duePosts || duePosts.length === 0) {
        console.log('📭 No posts due for publishing. Exiting.\n');
        return;
    }

    console.log(`📬 Found ${duePosts.length} post(s) due for publishing.\n`);

    // 2. Process each post
    for (const post of duePosts) {
        console.log(`\n─── Post ${post.id} ───`);
        console.log(`  Type: ${post.media_type || 'IMAGE'}`);
        console.log(`  Caption: ${(post.caption || '').substring(0, 50)}...`);
        console.log(`  Scheduled: ${post.scheduled_time}`);

        try {
            // Get the user's access token from accounts table
            const { data: account, error: acctError } = await supabase
                .from('accounts')
                .select('access_token, ig_user_id, token_expires_at')
                .eq('user_id', post.user_id)
                .eq('provider', 'instagram')
                .single();

            if (acctError || !account) {
                throw new Error('No Instagram connection found for this user. Please connect Instagram first.');
            }

            // Check if token is expired
            if (new Date(account.token_expires_at) < new Date()) {
                throw new Error('Instagram access token has expired. Please reconnect Instagram.');
            }

            // Build the full caption with hashtags
            let fullCaption = post.caption || '';
            if (post.hashtags) {
                fullCaption += '\n\n' + post.hashtags;
            }

            // Route by media type
            let igMediaId;
            const mediaType = (post.media_type || 'IMAGE').toUpperCase();

            if (mediaType === 'VIDEO') {
                const videoUrl = post.video_url || post.image_url;
                if (!videoUrl) throw new Error('No video URL found for this post.');
                igMediaId = await publishVideo(account.ig_user_id, account.access_token, videoUrl, fullCaption);
            } else {
                // Default: IMAGE
                const imageUrl = post.image_url;
                if (!imageUrl) throw new Error('No image URL found for this post.');
                igMediaId = await publishImage(account.ig_user_id, account.access_token, imageUrl, fullCaption);
            }

            // Update post status to published
            await supabase
                .from('posts')
                .update({
                    status: 'published',
                    ig_media_id: igMediaId,
                    publish_error: null,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', post.id);

            console.log(`  ✅ Post ${post.id} published successfully!`);

        } catch (err) {
            console.error(`  ❌ Post ${post.id} FAILED: ${err.message}`);

            // Update post status to failed
            await supabase
                .from('posts')
                .update({
                    status: 'failed',
                    publish_error: err.message,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', post.id);
        }
    }

    console.log('\n==============================================');
    console.log('G-Logic Automation Publisher — Cycle complete');
    console.log('==============================================\n');
}

// Run
main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
