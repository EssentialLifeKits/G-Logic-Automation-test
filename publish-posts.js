/* ============================================================
   G-Logic Automation — Post Publisher (GitHub Actions Cron Job Target)
   ============================================================
   This script is designed to be run by a GitHub Actions cron job
   every hour. It queries Supabase for due posts and publishes
   them to Instagram via the Meta Graph API.

   Usage: node publish-posts.js

  Required Environment Variables:
    SUPABASE_URL              - Your Supabase project URL
    SUPABASE_SERVICE_KEY      - Your Supabase service_role key (bypasses RLS)
    SUPABASE_SERVICE_ROLE_KEY - Also accepted as the service_role key name
   ============================================================ */

const GRAPH_API_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const POLL_INTERVAL_MS = 5000;  // 5 seconds between status checks
const MAX_POLL_ATTEMPTS = 60;   // Max 5 minutes of polling (60 × 5s)

// ========== SUPABASE SETUP ==========
function createSupabaseClient() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY environment variables');
    }

    const headers = {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
    };

    class QueryBuilder {
        constructor(table) {
            this.table = table;
            this.method = 'GET';
            this.params = new URLSearchParams();
            this.body = null;
            this.singleResult = false;
            this.returnMinimal = false;
        }

        select(columns = '*') {
            this.params.set('select', columns);
            return this;
        }

        eq(column, value) {
            this.params.set(column, `eq.${value}`);
            return this;
        }

        lte(column, value) {
            this.params.set(column, `lte.${value}`);
            return this;
        }

        order(column, options = {}) {
            const direction = options.ascending === false ? 'desc' : 'asc';
            this.params.set('order', `${column}.${direction}`);
            return this;
        }

        single() {
            this.singleResult = true;
            this.params.set('limit', '1');
            return this;
        }

        update(data) {
            this.method = 'PATCH';
            this.body = JSON.stringify(data);
            this.returnMinimal = true;
            return this;
        }

        async execute() {
            const res = await fetch(`${url}/rest/v1/${this.table}?${this.params.toString()}`, {
                method: this.method,
                headers: {
                    ...headers,
                    ...(this.returnMinimal ? { Prefer: 'return=minimal' } : {}),
                },
                body: this.body,
            });

            if (!res.ok) {
                return { data: null, error: { message: await res.text() } };
            }

            if (this.returnMinimal) return { data: null, error: null };
            const rows = await res.json();
            return { data: this.singleResult ? rows[0] || null : rows, error: null };
        }

        then(resolve, reject) {
            return this.execute().then(resolve, reject);
        }
    }

    return {
        from(table) {
            return new QueryBuilder(table);
        },
    };
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

/**
 * Publish a STORY to Instagram (image or video)
 */
async function publishStory(igUserId, accessToken, mediaUrl, isVideo) {
    console.log(`  📖 Publishing STORY for @${igUserId}...`);

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

    // Poll for video stories
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

    console.log(`  🎉 Story published! IG Media ID: ${publishData.id}`);
    return publishData.id;
}

async function publishFacebookImage(pageId, accessToken, imageUrl, caption) {
    console.log(`  📘 Publishing Facebook image for Page ${pageId}...`);
    const res = await fetch(`${GRAPH_BASE}/${pageId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: imageUrl, caption, access_token: accessToken }),
    });
    const data = await res.json();
    if (data.error) throw new Error(`Facebook image publish failed: ${data.error.message}`);
    console.log(`  🎉 Facebook image published! ID: ${data.post_id || data.id}`);
    return data.post_id || data.id;
}

async function publishFacebookVideo(pageId, accessToken, videoUrl, caption) {
    console.log(`  📘 Publishing Facebook video for Page ${pageId}...`);
    const res = await fetch(`${GRAPH_BASE}/${pageId}/videos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_url: videoUrl, description: caption, access_token: accessToken }),
    });
    const data = await res.json();
    if (data.error) throw new Error(`Facebook video publish failed: ${data.error.message}`);
    console.log(`  🎉 Facebook video published! ID: ${data.id}`);
    return data.id;
}

async function publishFacebookText(pageId, accessToken, caption) {
    console.log(`  📘 Publishing Facebook text post for Page ${pageId}...`);
    const res = await fetch(`${GRAPH_BASE}/${pageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: caption, access_token: accessToken }),
    });
    const data = await res.json();
    if (data.error) throw new Error(`Facebook text publish failed: ${data.error.message}`);
    console.log(`  🎉 Facebook text post published! ID: ${data.id}`);
    return data.id;
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
            const platform = (post.platform || post.channel || 'instagram').toLowerCase();
            if (!['instagram', 'facebook'].includes(platform)) {
                throw new Error(`Unsupported publishing platform: ${platform}`);
            }

            // Get the user's access token from accounts table
            const { data: account, error: acctError } = await supabase
                .from('user_social_accounts')
                .select('access_token, provider_id, token_expires_at')
                .eq('user_id', post.user_id)
                .eq('provider', platform)
                .eq('is_active', true)
                .single();

            if (acctError || !account) {
                throw new Error(`No ${platform === 'facebook' ? 'Facebook Page' : 'Instagram'} connection found for this user. Please connect ${platform === 'facebook' ? 'Facebook' : 'Instagram'} first.`);
            }

            // Check if token is expired
            if (new Date(account.token_expires_at) < new Date()) {
                throw new Error(`${platform === 'facebook' ? 'Facebook' : 'Instagram'} access token has expired. Please reconnect ${platform === 'facebook' ? 'Facebook' : 'Instagram'}.`);
            }

            // Build the full caption with hashtags
            let fullCaption = post.caption || '';
            if (post.hashtags) {
                fullCaption += '\n\n' + post.hashtags;
            }

            // Route by media type
            let publishedMediaId;
            const mediaType = (post.media_type || 'IMAGE').toUpperCase();
            const postType = (post.post_type || '').toLowerCase();

            if (platform === 'facebook') {
                if (postType !== 'post') {
                    throw new Error('Facebook Page publishing currently supports standard posts only.');
                }
                if (mediaType === 'VIDEO' || post.video_url) {
                    const videoUrl = post.video_url || post.image_url;
                    if (!videoUrl) throw new Error('No video URL found for this Facebook post.');
                    publishedMediaId = await publishFacebookVideo(account.provider_id, account.access_token, videoUrl, fullCaption);
                } else if (post.image_url) {
                    publishedMediaId = await publishFacebookImage(account.provider_id, account.access_token, post.image_url, fullCaption);
                } else if (fullCaption.trim()) {
                    publishedMediaId = await publishFacebookText(account.provider_id, account.access_token, fullCaption);
                } else {
                    throw new Error('Facebook post needs text, image, or video content.');
                }
            } else if (postType === 'story') {
                const videoUrl = post.video_url || post.image_url;
                const isStoryVideo = mediaType === 'VIDEO' || mediaType === 'STORY_VIDEO' || !!post.video_url;
                const mediaUrl = isStoryVideo ? videoUrl : post.image_url;
                if (!mediaUrl) throw new Error(`No ${isStoryVideo ? 'video' : 'image'} URL found for this story.`);
                publishedMediaId = await publishStory(account.provider_id, account.access_token, mediaUrl, isStoryVideo);
            } else if (mediaType === 'VIDEO') {
                const videoUrl = post.video_url || post.image_url;
                if (!videoUrl) throw new Error('No video URL found for this post.');
                publishedMediaId = await publishVideo(account.provider_id, account.access_token, videoUrl, fullCaption);
            } else {
                const imageUrl = post.image_url;
                if (!imageUrl) throw new Error('No image URL found for this post.');
                publishedMediaId = await publishImage(account.provider_id, account.access_token, imageUrl, fullCaption);
            }

            // Update post status to published
            const publishUpdate = {
                status: 'published',
                publish_error: null,
                updated_at: new Date().toISOString(),
            };
            if (platform === 'facebook') publishUpdate.facebook_post_id = publishedMediaId;
            else publishUpdate.ig_media_id = publishedMediaId;

            await supabase
                .from('posts')
                .update(publishUpdate)
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
