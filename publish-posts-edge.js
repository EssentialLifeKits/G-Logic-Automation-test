// G-Logic Automation — Post Publisher (Supabase Edge Function)
// Deno runtime — called every 1 minute by pg_cron via net.http_post
//
// Deploy via: Supabase Dashboard → Edge Functions → New Function
// Name: publish-posts
//
// Secrets auto-provided by Supabase (no manual setup needed):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

const GRAPH_API_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 60;

// ========== SUPABASE CLIENT ==========
function createSupabaseClient() {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    // Minimal REST client — avoids ESM import issues in Edge Functions
    return {
        async select(table, query) {
            const params = new URLSearchParams(query);
            const res = await fetch(`${url}/rest/v1/${table}?${params}`, {
                headers: {
                    apikey: key,
                    Authorization: `Bearer ${key}`,
                    'Content-Type': 'application/json',
                },
            });
            if (!res.ok) throw new Error(`Supabase select failed: ${await res.text()}`);
            return res.json();
        },
        async update(table, id, data) {
            const res = await fetch(`${url}/rest/v1/${table}?id=eq.${id}`, {
                method: 'PATCH',
                headers: {
                    apikey: key,
                    Authorization: `Bearer ${key}`,
                    'Content-Type': 'application/json',
                    Prefer: 'return=minimal',
                },
                body: JSON.stringify(data),
            });
            if (!res.ok) throw new Error(`Supabase update failed: ${await res.text()}`);
        },
        async selectSingle(table, query) {
            const params = new URLSearchParams({ ...query, limit: '1' });
            const res = await fetch(`${url}/rest/v1/${table}?${params}`, {
                headers: {
                    apikey: key,
                    Authorization: `Bearer ${key}`,
                    'Content-Type': 'application/json',
                },
            });
            if (!res.ok) throw new Error(`Supabase selectSingle failed: ${await res.text()}`);
            const rows = await res.json();
            return rows[0] ?? null;
        },
    };
}

// ========== GRAPH API HELPERS ==========
async function publishImage(igUserId, accessToken, imageUrl, caption) {
    console.log(`  📷 Publishing IMAGE for IG user ${igUserId}...`);

    const createRes = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl, caption, access_token: accessToken }),
    });
    const createData = await createRes.json();
    if (createData.error) throw new Error(`Container creation failed: ${createData.error.message}`);

    const creationId = createData.id;
    console.log(`  ✅ Container created: ${creationId}`);

    const publishRes = await fetch(`${GRAPH_BASE}/${igUserId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: creationId, access_token: accessToken }),
    });
    const publishData = await publishRes.json();
    if (publishData.error) throw new Error(`Publish failed: ${publishData.error.message}`);

    console.log(`  🎉 Published! IG Media ID: ${publishData.id}`);
    return publishData.id;
}

async function publishVideo(igUserId, accessToken, videoUrl, caption) {
    console.log(`  🎬 Publishing VIDEO/REEL for IG user ${igUserId}...`);

    const createRes = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            video_url: videoUrl,
            caption,
            media_type: 'REELS',
            access_token: accessToken,
        }),
    });
    const createData = await createRes.json();
    if (createData.error) throw new Error(`Reel container failed: ${createData.error.message}`);

    const creationId = createData.id;
    console.log(`  ✅ Reel container created: ${creationId}. Polling...`);

    let statusCode = 'IN_PROGRESS';
    let attempts = 0;
    while (statusCode !== 'FINISHED' && attempts < MAX_POLL_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        attempts++;
        const statusRes = await fetch(
            `${GRAPH_BASE}/${creationId}?fields=status_code&access_token=${accessToken}`
        );
        const statusData = await statusRes.json();
        if (statusData.error) throw new Error(`Status check failed: ${statusData.error.message}`);
        statusCode = statusData.status_code;
        console.log(`  ⏳ Poll #${attempts}: ${statusCode}`);
        if (statusCode === 'ERROR') throw new Error('Video processing failed on Instagram servers.');
    }

    if (statusCode !== 'FINISHED') {
        throw new Error(`Video processing timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s`);
    }

    const publishRes = await fetch(`${GRAPH_BASE}/${igUserId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: creationId, access_token: accessToken }),
    });
    const publishData = await publishRes.json();
    if (publishData.error) throw new Error(`Reel publish failed: ${publishData.error.message}`);

    console.log(`  🎉 Reel published! IG Media ID: ${publishData.id}`);
    return publishData.id;
}

async function publishStory(igUserId, accessToken, mediaUrl, isVideo) {
    const body = isVideo
        ? { video_url: mediaUrl, media_type: 'STORIES', access_token: accessToken }
        : { image_url: mediaUrl, media_type: 'STORIES', access_token: accessToken };

    const createRes = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const createData = await createRes.json();
    if (createData.error) throw new Error(`Story container failed: ${createData.error.message}`);
    const creationId = createData.id;

    if (isVideo) {
        let statusCode = 'IN_PROGRESS';
        let attempts = 0;
        while (statusCode !== 'FINISHED' && attempts < MAX_POLL_ATTEMPTS) {
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
            attempts++;
            const statusRes = await fetch(`${GRAPH_BASE}/${creationId}?fields=status_code&access_token=${accessToken}`);
            const statusData = await statusRes.json();
            if (statusData.error) throw new Error(`Story status check failed: ${statusData.error.message}`);
            statusCode = statusData.status_code;
            if (statusCode === 'ERROR') throw new Error('Story video processing failed.');
        }
        if (statusCode !== 'FINISHED') throw new Error('Story video processing timed out.');
    }

    const publishRes = await fetch(`${GRAPH_BASE}/${igUserId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: creationId, access_token: accessToken }),
    });
    const publishData = await publishRes.json();
    if (publishData.error) throw new Error(`Story publish failed: ${publishData.error.message}`);
    return publishData.id;
}

// ========== MAIN HANDLER ==========
Deno.serve(async (_req) => {
    console.log('==============================================');
    console.log('G-Logic Publisher Edge Function — Starting cycle');
    console.log(`Time: ${new Date().toISOString()}`);
    console.log('==============================================\n');

    const db = createSupabaseClient();
    const now = new Date().toISOString();

    // Fetch due posts
    const MAX_RETRIES = 5;
    let duePosts;
    try {
        // Pick up pending posts that are due AND failed posts that haven't hit the retry limit
        const [pending, failed] = await Promise.all([
            db.select('posts', {
                select: '*',
                status: 'eq.pending',
                scheduled_time: `lte.${now}`,
                order: 'scheduled_time.asc',
            }),
            db.select('posts', {
                select: '*',
                status: 'eq.failed',
                retry_count: `lt.${MAX_RETRIES}`,
                order: 'scheduled_time.asc',
            }),
        ]);
        duePosts = [...(pending || []), ...(failed || [])];
    } catch (err) {
        console.error('❌ Failed to query posts:', err.message);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }

    if (!duePosts || duePosts.length === 0) {
        console.log('📭 No posts due for publishing.\n');
        return new Response(JSON.stringify({ published: 0 }), { status: 200 });
    }

    console.log(`📬 Found ${duePosts.length} post(s) due.\n`);

    const results = [];

    for (const post of duePosts) {
        console.log(`\n─── Post ${post.id} ───`);
        console.log(`  Type: ${post.media_type || 'IMAGE'}`);
        console.log(`  Scheduled: ${post.scheduled_time}`);

        try {
            const account = await db.selectSingle('user_social_accounts', {
                select: 'access_token,provider_id,token_expires_at',
                user_id: `eq.${post.user_id}`,
                provider: 'eq.instagram',
                is_active: 'eq.true',
            });

            if (!account) throw new Error('No active Instagram connection found for this user.');
            if (new Date(account.token_expires_at) < new Date()) {
                throw new Error('Instagram access token has expired. Please reconnect Instagram.');
            }

            let fullCaption = post.caption || '';
            if (post.hashtags) fullCaption += '\n\n' + post.hashtags;

            const mediaType = (post.media_type || 'IMAGE').toUpperCase();
            let igMediaId;

            if (mediaType === 'STORY_VIDEO') {
                const videoUrl = post.video_url || post.image_url;
                if (!videoUrl) throw new Error('No video URL found for this story.');
                igMediaId = await publishStory(account.provider_id, account.access_token, videoUrl, true);
            } else if (mediaType === 'STORY') {
                if (!post.image_url) throw new Error('No image URL found for this story.');
                igMediaId = await publishStory(account.provider_id, account.access_token, post.image_url, false);
            } else if (mediaType === 'VIDEO') {
                const videoUrl = post.video_url || post.image_url;
                if (!videoUrl) throw new Error('No video URL found.');
                igMediaId = await publishVideo(account.provider_id, account.access_token, videoUrl, fullCaption);
            } else {
                if (!post.image_url) throw new Error('No image URL found.');
                igMediaId = await publishImage(account.provider_id, account.access_token, post.image_url, fullCaption);
            }

            await db.update('posts', post.id, {
                status: 'published',
                ig_media_id: igMediaId,
                publish_error: null,
                updated_at: new Date().toISOString(),
            });

            console.log(`  ✅ Post ${post.id} published!`);
            results.push({ id: post.id, status: 'published' });

        } catch (err) {
            console.error(`  ❌ Post ${post.id} FAILED: ${err.message}`);

            const newRetryCount = (post.retry_count || 0) + 1;
            const permanentlyFailed = newRetryCount >= MAX_RETRIES;

            await db.update('posts', post.id, {
                status: permanentlyFailed ? 'permanently_failed' : 'failed',
                publish_error: err.message,
                retry_count: newRetryCount,
                updated_at: new Date().toISOString(),
            });

            console.log(`  🔁 Retry ${newRetryCount}/${MAX_RETRIES}${permanentlyFailed ? ' — permanently failed' : ' — will retry next cycle'}`);
            results.push({ id: post.id, status: permanentlyFailed ? 'permanently_failed' : 'failed', error: err.message });
        }
    }

    console.log('\n==============================================');
    console.log('G-Logic Publisher — Cycle complete');
    console.log('==============================================\n');

    return new Response(JSON.stringify({ published: results.filter(r => r.status === 'published').length, results }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
});
