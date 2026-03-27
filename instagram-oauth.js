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
    // ⚠️ This MUST exactly match a URI registered in your Meta App Dashboard.
    // (Meta for Developers → Your App → Facebook Login → Settings → Valid OAuth Redirect URIs)
    const REDIRECT_URI = 'http://localhost:8000/meta-callback.html';

    // Required Instagram permissions (do NOT remove any of these)
    const SCOPES = [
        'instagram_content_publish',   // Post to Instagram
        'pages_read_engagement',       // Read page info to find the IG account
        'instagram_basic',             // Read basic IG profile info
        'pages_show_list',             // List Facebook Pages owned by user
    ].join(',');

    // Meta Graph API version (update periodically)
    const API_VERSION = 'v21.0';

    // Table name for social accounts (matches phase3_social_accounts.sql)
    const ACCOUNTS_TABLE = 'user_social_accounts';

    // ========== DOM ELEMENTS ==========
    const connectBtn = document.getElementById('connectInstagramBtn');
    const statusDot = document.getElementById('igStatusDot');
    const statusText = document.getElementById('igStatusText');

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

        } catch (e) {
            console.warn('G-Logic: Error checking IG connection —', e);
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

        // Build the Facebook OAuth URL
        const authUrl =
            `https://www.facebook.com/${API_VERSION}/dialog/oauth` +
            `?client_id=${META_APP_ID}` +
            `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
            `&scope=${encodeURIComponent(SCOPES)}` +
            `&response_type=code` +
            `&state=${crypto.randomUUID()}`; // CSRF protection

        // Redirect to Meta login
        window.location.href = authUrl;
    });

    // ========== EXPOSE HELPERS GLOBALLY (for console testing) ==========
    window.GLogic = window.GLogic || {};
    window.GLogic.saveInstagramToken = saveInstagramToken;
    window.GLogic.disconnectInstagram = disconnectInstagram;
    window.GLogic.checkConnection = checkConnection;

    // ========== INIT ==========
    // Check connection status as soon as page loads
    checkConnection();

})();
