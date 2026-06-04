/* ============================================================
   G-Logic Automation — Instagram OAuth & Account Management
   ============================================================
   Handles the "Connect Instagram" sidebar button.

   SETUP (one-time):
   1. Set META_APP_ID below to your real App ID from
      https://developers.facebook.com → Your App → Settings → Basic
   2. Ensure the meta-token-exchange Edge Function is deployed
      (see meta-token-exchange.js for the full function code)
   3. Run phase3_social_accounts.sql in Supabase SQL Editor

   FLOW:
   1. User clicks "Connect Instagram"
   2. Browser redirects to Facebook OAuth
   3. Meta redirects back to meta-callback.html with ?code=...
   4. meta-callback.html sends the code to the Edge Function
   5. Edge Function exchanges the code for a long-lived token
   6. Token is saved to user_social_accounts table
   7. This file's checkConnection() reads back the saved account
      and updates the sidebar button UI
   ============================================================ */

(function () {
    'use strict';

    // ========== CONFIG ==========
    // ⚠️  Replace with your real Meta App ID before going live.
    //     Get it from developers.facebook.com → Your App → Settings → Basic
    const META_APP_ID = '934627165786609';

    // The page Meta redirects to after the user authorizes your app.
    // Dynamically set to the current origin so it works on both localhost AND Vercel.
    // ⚠️ BOTH of these must be registered in Meta App Dashboard:
    //   http://localhost:8000/meta-callback.html
    //   https://YOUR-VERCEL-URL.vercel.app/meta-callback.html
    const REDIRECT_URI = window.location.origin + '/meta-callback.html';

    // Required Instagram permissions (do NOT remove any of these)
    const SCOPES = [
        'instagram_content_publish',   // Post to Instagram
        'pages_read_engagement',       // Read page info to find the IG account
        'instagram_basic',             // Read basic IG profile info
        'pages_show_list',             // List Facebook Pages owned by user
        'pages_manage_metadata',       // Required for New Pages Experience page discovery
        'pages_manage_posts',          // Publish to connected Facebook Pages
    ].join(',');

    // Meta Graph API version (update periodically)
    const API_VERSION = 'v21.0';

    // Table name for social accounts (matches phase3_social_accounts.sql)
    const ACCOUNTS_TABLE = 'user_social_accounts';

    // ========== DOM ELEMENTS ==========
    const connectBtn = document.getElementById('connectInstagramBtn');
    const statusDot = document.getElementById('igStatusDot');
    const statusText = document.getElementById('igStatusText');
    const connectFacebookBtn = document.getElementById('connectFacebookBtn');
    const fbStatusDot = document.getElementById('fbStatusDot');
    const fbStatusText = document.getElementById('fbStatusText');

    // Guard: Only run on pages that have the connect button
    if (!connectBtn) return;

    // ========== CHECK EXISTING CONNECTION ==========
    /**
     * Queries user_social_accounts for an active Instagram connection
     * belonging to the currently logged-in user and updates the UI.
     */
    async function checkConnection() {
        if (typeof supabase === 'undefined' || !supabase.auth) return;

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return;

            const { data, error } = await supabase
                .from(ACCOUNTS_TABLE)
                .select('ig_username, token_expires_at, is_active, provider_id')
                .eq('user_id', session.user.id)
                .eq('provider', 'instagram')
                .eq('is_active', true)
                .maybeSingle();                  // Returns null instead of error if no row

            if (data && !error) {
                const expiresAt = new Date(data.token_expires_at);
                const isExpired = expiresAt < new Date();
                const daysLeft = Math.ceil((expiresAt - new Date()) / (1000 * 60 * 60 * 24));
                const displayName = data.ig_username ? `@${data.ig_username}` : 'Connected';

                if (!isExpired) {
                    // ✅ Active connection
                    if (statusDot) statusDot.classList.add('connected');
                    if (statusText) statusText.textContent = displayName;
                    connectBtn.classList.add('connected');
                    connectBtn.title = `Token expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`;

                    // Warn user when token is close to expiry (< 7 days)
                    if (daysLeft <= 7) {
                        if (statusDot) statusDot.classList.add('expiring');
                        connectBtn.title = `⚠️ Token expires in ${daysLeft} days — click to refresh`;
                    }

                } else {
                    // ⚠️ Token expired — prompt reconnect
                    if (statusDot) statusDot.classList.add('expired');
                    if (statusText) statusText.textContent = 'Token Expired — Reconnect';
                    connectBtn.classList.add('expired');
                }

                // Update the "Connect Instagram" text with account name
                const textSpan = connectBtn.querySelector('span#igStatusText');
                if (textSpan) textSpan.textContent = isExpired ? 'Reconnect Instagram' : displayName;
            }

            await checkFacebookConnection(session.user.id);

        } catch (e) {
            console.warn('G-Logic: Error checking IG connection —', e);
        }
    }

    async function checkFacebookConnection(userId) {
        if (!connectFacebookBtn) return;

        try {
            const { data, error } = await supabase
                .from(ACCOUNTS_TABLE)
                .select('facebook_page_name, token_expires_at, is_active, provider_id')
                .eq('user_id', userId)
                .eq('provider', 'facebook')
                .eq('is_active', true)
                .maybeSingle();

            if (!data || error) return;

            const expiresAt = data.token_expires_at ? new Date(data.token_expires_at) : null;
            const isExpired = expiresAt ? expiresAt < new Date() : false;
            const daysLeft = expiresAt ? Math.ceil((expiresAt - new Date()) / (1000 * 60 * 60 * 24)) : null;
            const displayName = data.facebook_page_name || 'Facebook Page';

            if (!isExpired) {
                if (fbStatusDot) fbStatusDot.classList.add('connected');
                if (fbStatusText) fbStatusText.textContent = displayName;
                connectFacebookBtn.classList.add('connected');
                connectFacebookBtn.title = daysLeft
                    ? `Page token expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`
                    : 'Facebook Page connected';

                if (daysLeft !== null && daysLeft <= 7) {
                    if (fbStatusDot) fbStatusDot.classList.add('expiring');
                    connectFacebookBtn.title = `Token expires in ${daysLeft} days — click to refresh`;
                }
            } else {
                if (fbStatusDot) fbStatusDot.classList.add('expired');
                if (fbStatusText) fbStatusText.textContent = 'Token Expired — Reconnect';
                connectFacebookBtn.classList.add('expired');
            }
        } catch (e) {
            console.warn('G-Logic: Error checking Facebook connection —', e);
        }
    }

    // ========== SAVE LONG-LIVED TOKEN DIRECTLY ==========
    /**
     * For quick testing: manually save a long-lived token you already have
     * (e.g., generated from the Meta Graph API Explorer) directly to the DB.
     * This skips the full OAuth dance — useful for "Essential Life Kits" first test.
     *
     * Call from the browser console:
     *   window.GLogic.saveInstagramToken({
     *     token:       'YOUR_LONG_LIVED_TOKEN',
     *     providerId:  'YOUR_IG_BUSINESS_ACCOUNT_ID',
     *     igUsername:  'essentiallifekits',
     *     expiresAt:   new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()
     *   })
     */
    async function saveInstagramToken({ token, providerId, igUsername, expiresAt }) {
        if (!token || !providerId) {
            console.error('G-Logic: saveInstagramToken requires token and providerId');
            return { success: false, error: 'Missing required fields' };
        }

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                return { success: false, error: 'Not authenticated — please sign in first' };
            }

            const { error } = await supabase
                .from(ACCOUNTS_TABLE)
                .upsert({
                    user_id: session.user.id,
                    provider: 'instagram',
                    provider_id: providerId,
                    ig_username: igUsername || '',
                    access_token: token,
                    token_expires_at: expiresAt || new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
                    is_active: true,
                    updated_at: new Date().toISOString(),
                }, {
                    onConflict: 'user_id,provider',
                    ignoreDuplicates: false,
                });

            if (error) {
                console.error('G-Logic: Supabase upsert error —', error.message);
                return { success: false, error: error.message };
            }

            console.log(`✅ G-Logic: Instagram token saved for @${igUsername || providerId}`);
            // Refresh the UI button state
            await checkConnection();
            return { success: true };

        } catch (err) {
            console.error('G-Logic: saveInstagramToken error —', err);
            return { success: false, error: err.message };
        }
    }

    // ========== DISCONNECT INSTAGRAM ==========
    /**
     * Marks the Instagram connection as inactive.
     * Call from console: window.GLogic.disconnectInstagram()
     */
    async function disconnectInstagram() {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return { success: false, error: 'Not authenticated' };

            const { error } = await supabase
                .from(ACCOUNTS_TABLE)
                .update({ is_active: false, updated_at: new Date().toISOString() })
                .eq('user_id', session.user.id)
                .eq('provider', 'instagram');

            if (error) throw error;

            // Reset button UI
            if (statusDot) { statusDot.className = 'ig-status-dot'; }
            if (statusText) { statusText.textContent = 'Connect Instagram'; }
            connectBtn.classList.remove('connected', 'expired');
            console.log('✅ G-Logic: Instagram disconnected.');
            return { success: true };

        } catch (err) {
            console.error('G-Logic: disconnectInstagram error —', err);
            return { success: false, error: err.message };
        }
    }

    async function saveFacebookToken({ token, providerId, pageName, expiresAt }) {
        if (!token || !providerId) {
            console.error('G-Logic: saveFacebookToken requires token and providerId');
            return { success: false, error: 'Missing required fields' };
        }

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                return { success: false, error: 'Not authenticated — please sign in first' };
            }

            const { error } = await supabase
                .from(ACCOUNTS_TABLE)
                .upsert({
                    user_id: session.user.id,
                    provider: 'facebook',
                    provider_id: providerId,
                    facebook_page_name: pageName || '',
                    access_token: token,
                    token_expires_at: expiresAt || new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
                    is_active: true,
                    updated_at: new Date().toISOString(),
                }, {
                    onConflict: 'user_id,provider',
                    ignoreDuplicates: false,
                });

            if (error) {
                console.error('G-Logic: Supabase Facebook upsert error —', error.message);
                return { success: false, error: error.message };
            }

            await checkConnection();
            return { success: true };
        } catch (err) {
            console.error('G-Logic: saveFacebookToken error —', err);
            return { success: false, error: err.message };
        }
    }

    async function disconnectFacebook() {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return { success: false, error: 'Not authenticated' };

            const { error } = await supabase
                .from(ACCOUNTS_TABLE)
                .update({ is_active: false, updated_at: new Date().toISOString() })
                .eq('user_id', session.user.id)
                .eq('provider', 'facebook');

            if (error) throw error;

            if (fbStatusDot) { fbStatusDot.className = 'fb-status-dot'; }
            if (fbStatusText) { fbStatusText.textContent = 'Connect Facebook'; }
            if (connectFacebookBtn) connectFacebookBtn.classList.remove('connected', 'expired');
            console.log('✅ G-Logic: Facebook disconnected.');
            return { success: true };
        } catch (err) {
            console.error('G-Logic: disconnectFacebook error —', err);
            return { success: false, error: err.message };
        }
    }

    function beginMetaOAuth(source) {
        if (META_APP_ID === 'YOUR_META_APP_ID_HERE') {
            alert(
                '⚠️ Setup Required\n\n' +
                'Open instagram-oauth.js and replace:\n' +
                '  const META_APP_ID = "YOUR_META_APP_ID_HERE"\n\n' +
                'Get your App ID from developers.facebook.com → Your App → Settings → Basic.'
            );
            return;
        }

        const statePayload = btoa(JSON.stringify({
            source: source || 'instagram',
            nonce: crypto.randomUUID(),
        }));

        const authUrl =
            `https://www.facebook.com/${API_VERSION}/dialog/oauth` +
            `?client_id=${META_APP_ID}` +
            `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
            `&scope=${encodeURIComponent(SCOPES)}` +
            `&response_type=code` +
            `&state=${encodeURIComponent(statePayload)}`;

        window.location.href = authUrl;
    }

    // ========== INITIATE OAUTH FLOW ==========
    connectBtn.addEventListener('click', () => {

        // Safeguard: remind developer to configure the App ID
        if (META_APP_ID === 'YOUR_META_APP_ID_HERE') {
            alert(
                '⚠️ Setup Required\n\n' +
                'Open instagram-oauth.js and replace:\n' +
                '  const META_APP_ID = "YOUR_META_APP_ID_HERE"\n\n' +
                'Get your App ID from:\n' +
                '  developers.facebook.com → Your App → Settings → Basic\n\n' +
                'Alternatively, use window.GLogic.saveInstagramToken() in the\n' +
                'browser console to manually save a long-lived token for testing.'
            );
            return;
        }

        beginMetaOAuth('instagram');
    });

    if (connectFacebookBtn) {
        connectFacebookBtn.addEventListener('click', () => beginMetaOAuth('facebook'));
    }

    // ========== EXPOSE HELPERS GLOBALLY (for console testing) ==========
    window.GLogic = window.GLogic || {};
    window.GLogic.saveInstagramToken = saveInstagramToken;
    window.GLogic.saveFacebookToken = saveFacebookToken;
    window.GLogic.disconnectInstagram = disconnectInstagram;
    window.GLogic.disconnectFacebook = disconnectFacebook;
    window.GLogic.checkConnection = checkConnection;

    // ========== INIT ==========
    // Check connection status as soon as page loads
    checkConnection();

})();
