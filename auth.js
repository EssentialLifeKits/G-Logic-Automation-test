/* ============================================================
   G-Logic Automation — Authentication Logic
   ============================================================ */

(function () {
    'use strict';

    // ========== HELPERS ==========
    const $ = (sel) => document.querySelector(sel);
    const isSignInPage = !!$('#authForm');
    const isAppPage = !!$('#mainContent');

    // ========== SESSION GUARD ==========
    // On app pages (index.html): redirect to signin if no session
    // On signin page: redirect to index if already logged in
    // EXCEPTION: Never redirect during password recovery flow
    let isPasswordRecovery = false;

    async function checkSession() {
        if (isPasswordRecovery) return null; // Stay on signin page to set new password

        const { data: { session } } = await supabase.auth.getSession();

        if (isAppPage && !session) {
            window.location.href = 'signin.html';
            return null;
        }

        if (isSignInPage && session) {
            window.location.href = 'index.html';
            return null;
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
    if (isAppPage) {
        const signOutBtn = $('#signOutBtn');
        if (signOutBtn) {
            signOutBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                await supabase.auth.signOut();
                window.location.href = 'signin.html';
            });
        }
    }

    checkSession();
})();
