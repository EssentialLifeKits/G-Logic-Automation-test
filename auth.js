/* ============================================================
   G-Logic Automation — Authentication Logic
   ============================================================ */

(function () {
    'use strict';

    // ========== ADMIN CONFIG ==========
    // Add the admin email address(es) here. Only these users will see the Admin Portal button.
    const ADMIN_EMAILS = [
        'essentiallifekits@gmail.com',  // Primary admin (Erik)
    ];

    function isAdminUser(email) {
        return ADMIN_EMAILS.includes((email || '').toLowerCase().trim());
    }

    async function apiFetch(path, options = {}) {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error('You are not signed in.');

        const response = await fetch(path, {
            ...options,
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
                ...(options.headers || {}),
            },
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Request failed.');
        return payload;
    }

    function setSubscriptionGate(locked, message = '') {
        const gate = $('#subscriptionGate');
        const note = $('#subscriptionGateNote');
        if (!gate) return;

        document.body.classList.remove('paywall-checking');
        document.body.classList.toggle('paywall-locked', locked);
        gate.hidden = !locked;
        if (note && message) note.textContent = message;
    }

    async function enforceSubscriptionGate(session) {
        if (!isAppPage || !session) return;

        if (isAdminUser(session.user?.email)) {
            setSubscriptionGate(false);
            return;
        }

        try {
            const status = await apiFetch('/api/subscription-status');
            if (!status.enabled || status.active) {
                setSubscriptionGate(false);
                return;
            }

            setSubscriptionGate(true, 'Choose a plan to continue using G-Logic Automation.');
        } catch (error) {
            console.warn('Subscription status unavailable:', error);
            setSubscriptionGate(false);
        }
    }

    async function startCheckout(billing) {
        const payload = await apiFetch('/api/create-checkout-session', {
            method: 'POST',
            body: JSON.stringify({ billing }),
        });
        if (payload.url) window.location.href = payload.url;
    }

    async function openBillingPortal() {
        const payload = await apiFetch('/api/create-billing-portal-session', {
            method: 'POST',
            body: JSON.stringify({}),
        });
        if (payload.url) window.location.href = payload.url;
    }

    // ========== HELPERS ==========
    const $ = (sel) => document.querySelector(sel);
    const isSignInPage = !!$('#authForm');
    const isAppPage = !!$('#mainContent');
    const isAdminPage = !!$('#adminPortalPage');

    // ========== SESSION GUARD ==========
    // On app pages (index.html): redirect to signin if no session
    // On signin page: redirect to index if already logged in
    // On admin page: redirect to signin if no session, redirect to index if not admin
    // EXCEPTION: Never redirect during password recovery flow
    let isPasswordRecovery = false;

    async function checkSession() {
        if (isPasswordRecovery) return null; // Stay on signin page to set new password

        const { data: { session } } = await supabase.auth.getSession();

        if (isAppPage && !session) {
            window.location.href = 'signin.html';
            return null;
        }

        if (isAdminPage && !session) {
            window.location.href = 'signin.html';
            return null;
        }

        if (isAdminPage && session && !isAdminUser(session.user?.email)) {
            // Non-admin tried to access admin.html — boot them back to app
            window.location.href = 'index.html';
            return null;
        }

        if (isSignInPage && session) {
            window.location.href = 'index.html';
            return null;
        }

        // Show admin portal button only to admin users on the app page
        if (isAppPage && session) {
            const isAdmin = isAdminUser(session.user?.email);
            const adminBtn = $('#adminPortalBtn');
            if (adminBtn && isAdmin) {
                adminBtn.style.display = '';
            }
            const sidebarBillingBtn = $('#sidebarManageBillingBtn');
            if (sidebarBillingBtn && isAdmin) {
                sidebarBillingBtn.style.display = 'none';
            }

            await enforceSubscriptionGate(session);
        }

        // Populate admin user email label if on admin page
        if (isAdminPage && session) {
            const adminEmailEl = $('#adminUserEmail');
            if (adminEmailEl) adminEmailEl.textContent = session.user?.email || '';
        }

        return session;
    }

    // ========== SIGN-IN PAGE LOGIC ==========
    if (isSignInPage) {
        const form = $('#authForm');
        const emailInput = $('#authEmail');
        const passwordInput = $('#authPassword');
        const signInBtn = $('#signInBtn');
        const googleBtn = $('#googleSignInBtn');
        const lostPwdLink = $('#lostPasswordLink');
        const createAcctLink = $('#createAccountLink');
        const errorEl = $('#authError');

        function showError(msg) {
            errorEl.textContent = msg;
            errorEl.classList.add('visible');
            setTimeout(() => errorEl.classList.remove('visible'), 5000);
        }

        function setLoading(loading) {
            signInBtn.disabled = loading;
            signInBtn.classList.toggle('loading', loading);
        }

        // Sign In with Email/Password
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = emailInput.value.trim();
            const password = passwordInput.value;

            if (!email || !password) {
                showError('Please enter both email and password.');
                return;
            }

            setLoading(true);
            const { error } = await supabase.auth.signInWithPassword({ email, password });

            if (error) {
                if (error.message.includes('Invalid login credentials')) {
                    showError('Invalid credentials. Check your email/password or create an account.');
                } else {
                    showError(error.message);
                }
                setLoading(false);
                return;
            }
            window.location.href = 'index.html';
        });

        // Create Account
        createAcctLink.addEventListener('click', async (e) => {
            e.preventDefault();
            const email = emailInput.value.trim();
            const password = passwordInput.value;

            if (!email || !password) {
                showError('Enter an email and password to create an account.');
                return;
            }
            if (password.length < 6) {
                showError('Password must be at least 6 characters.');
                return;
            }
            setLoading(true);
            const { data, error } = await supabase.auth.signUp({ email, password });
            if (error) {
                showError(error.message);
                setLoading(false);
                return;
            }
            if (data.user && !data.session) {
                showError('');
                errorEl.textContent = '✅ Account created! Check your email to confirm, then sign in.';
                errorEl.classList.add('visible', 'success');
                setLoading(false);
            } else {
                window.location.href = 'index.html';
            }
        });

        // Sign in with Google
        googleBtn.addEventListener('click', async () => {
            // Visual feedback that the button was clicked
            googleBtn.style.opacity = '0.7';
            googleBtn.innerHTML = 'Redirecting to Google...';

            try {
                const { error } = await supabase.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                        redirectTo: window.location.origin + '/index.html',
                        queryParams: {
                            access_type: 'offline',
                            prompt: 'consent',
                        },
                    },
                });

                if (error) {
                    console.error("Supabase Auth Error:", error);
                    showError('Google Sign-In Error: ' + error.message);
                    googleBtn.style.opacity = '1';
                    googleBtn.innerHTML = 'Sign in with Google';
                }
            } catch (err) {
                console.error("Unexpected error:", err);
                showError('Error: ' + (err.message || JSON.stringify(err)));
                googleBtn.style.opacity = '1';
                googleBtn.innerHTML = 'Sign in with Google';
            }
        });

        // Lost Password
        lostPwdLink.addEventListener('click', async (e) => {
            e.preventDefault();
            const email = emailInput.value.trim();
            if (!email) {
                showError('Enter your email address first, then click Lost Password.');
                return;
            }
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin + '/signin.html',
            });
            if (error) {
                showError(error.message);
            } else {
                errorEl.textContent = '�� Password reset email sent! Check your inbox.';
                errorEl.classList.add('visible', 'success');
            }
        });
    }

    // ========== PASSWORD RECOVERY HANDLER ==========
    // Fires when user clicks the reset-password email link.
    // Must be registered before checkSession() to prevent the redirect race.
    supabase.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY' && isSignInPage) {
            isPasswordRecovery = true;

            // Hide normal sign-in UI, show the set-new-password form
            const authForm        = $('#authForm');
            const googleBtn       = $('#googleSignInBtn');
            const authDivider     = document.querySelector('.auth-divider');
            const authLinks       = document.querySelector('.auth-links');
            const resetSection    = $('#resetPasswordSection');
            const updateBtn       = $('#updatePasswordBtn');
            const errorEl         = $('#authError');

            if (authForm)     authForm.style.display     = 'none';
            if (googleBtn)    googleBtn.style.display    = 'none';
            if (authDivider)  authDivider.style.display  = 'none';
            if (authLinks)    authLinks.style.display    = 'none';
            if (resetSection) resetSection.style.display = 'block';

            if (updateBtn) {
                updateBtn.addEventListener('click', async () => {
                    const newPwd     = $('#newPassword')?.value || '';
                    const confirmPwd = $('#confirmNewPassword')?.value || '';

                    if (newPwd.length < 6) {
                        errorEl.textContent = 'Password must be at least 6 characters.';
                        errorEl.classList.add('visible');
                        return;
                    }
                    if (newPwd !== confirmPwd) {
                        errorEl.textContent = 'Passwords do not match.';
                        errorEl.classList.add('visible');
                        return;
                    }

                    updateBtn.disabled    = true;
                    updateBtn.textContent = 'Saving…';

                    const { error } = await supabase.auth.updateUser({ password: newPwd });
                    if (error) {
                        errorEl.textContent = error.message;
                        errorEl.classList.add('visible');
                        updateBtn.disabled    = false;
                        updateBtn.textContent = 'Set New Password';
                    } else {
                        errorEl.textContent = '✅ Password updated! Signing you in…';
                        errorEl.classList.add('visible', 'success');
                        setTimeout(() => { window.location.href = 'index.html'; }, 1500);
                    }
                });
            }
        }

        if (event === 'SIGNED_OUT' && isAppPage) {
            window.location.href = 'signin.html';
        }
    });

    // ========== APP PAGE LOGIC (Sign Out) ==========
    if (isAppPage || isAdminPage) {
        // Main app sign-out button
        const signOutBtn = $('#signOutBtn');
        if (signOutBtn) {
            signOutBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                await supabase.auth.signOut();
                window.location.href = 'signin.html';
            });
        }
        // Admin page sign-out button
        const adminSignOutBtn = $('#adminSignOutBtn');
        if (adminSignOutBtn) {
            adminSignOutBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                await supabase.auth.signOut();
                window.location.href = 'signin.html';
            });
        }

        const subscribeMonthlyBtn = $('#subscribeMonthlyBtn');
        if (subscribeMonthlyBtn) {
            subscribeMonthlyBtn.addEventListener('click', async () => {
                subscribeMonthlyBtn.disabled = true;
                subscribeMonthlyBtn.textContent = 'Opening Stripe...';
                try {
                    await startCheckout('monthly');
                } catch (error) {
                    subscribeMonthlyBtn.disabled = false;
                    subscribeMonthlyBtn.textContent = 'Start Monthly';
                    alert(error.message);
                }
            });
        }

        const subscribeYearlyBtn = $('#subscribeYearlyBtn');
        if (subscribeYearlyBtn) {
            subscribeYearlyBtn.addEventListener('click', async () => {
                subscribeYearlyBtn.disabled = true;
                subscribeYearlyBtn.textContent = 'Opening Stripe...';
                try {
                    await startCheckout('yearly');
                } catch (error) {
                    subscribeYearlyBtn.disabled = false;
                    subscribeYearlyBtn.textContent = 'Start Yearly';
                    alert(error.message);
                }
            });
        }

        const manageBillingButtons = [$('#manageBillingBtn'), $('#sidebarManageBillingBtn')].filter(Boolean);
        manageBillingButtons.forEach((manageBillingBtn) => {
            manageBillingBtn.addEventListener('click', async () => {
                const originalText = manageBillingBtn.textContent;
                manageBillingBtn.disabled = true;
                manageBillingBtn.textContent = 'Opening billing...';
                try {
                    await openBillingPortal();
                } catch (error) {
                    manageBillingBtn.disabled = false;
                    manageBillingBtn.textContent = originalText;
                    alert(error.message);
                }
            });
        });
    }

    checkSession();
})();
