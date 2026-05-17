const ADMIN_EMAILS = (process.env.GLOGIC_ADMIN_EMAILS || 'essentiallifekits@gmail.com')
  .split(',')
  .map(email => email.trim().toLowerCase())
  .filter(Boolean);

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function isAdminEmail(email) {
  return ADMIN_EMAILS.includes(String(email || '').toLowerCase().trim());
}

function isPaywallEnabled() {
  return process.env.GLOGIC_PAYWALL_ENABLED === 'true';
}

async function getAuthUser(req) {
  const token = getBearerToken(req);
  if (!token) return null;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase server environment variables.');
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) return null;
  return response.json();
}

async function supabaseRest(path, options = {}) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase server environment variables.');
  }

  const response = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${path}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function stripeRequest(path, params) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    throw new Error('Missing STRIPE_SECRET_KEY.');
  }

  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${stripeSecretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Stripe request failed: ${response.status}`);
  }
  return payload;
}

function subscriptionIsActive(subscription) {
  if (!subscription || !ACTIVE_STATUSES.has(subscription.status)) return false;
  if (!subscription.current_period_end) return true;
  return new Date(subscription.current_period_end).getTime() > Date.now();
}

async function getLatestSubscription(userId) {
  const rows = await supabaseRest(
    `/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=*&order=updated_at.desc&limit=1`
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

module.exports = {
  ACTIVE_STATUSES,
  getAuthUser,
  getLatestSubscription,
  isAdminEmail,
  isPaywallEnabled,
  json,
  stripeRequest,
  subscriptionIsActive,
  supabaseRest,
};
