const { getAuthUser, isAdminEmail, json, supabaseRest } = require('../lib/paywall-utils');

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

async function stripeGet(path) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) return null;

  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { authorization: `Bearer ${stripeSecretKey}` },
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Stripe request failed: ${response.status}`);
  }
  return payload;
}

async function listAuthUsers() {
  const rows = [];
  let page = 1;
  const perPage = 200;

  while (page <= 10) {
    const payload = await supabaseRest(`/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
      headers: { 'content-type': 'application/json' },
    });

    const users = Array.isArray(payload?.users) ? payload.users : [];
    rows.push(...users);
    if (users.length < perPage) break;
    page += 1;
  }

  return rows;
}

function cleanCustomer(customer) {
  if (!customer) return null;
  return {
    id: customer.id || '',
    name: customer.name || '',
    email: customer.email || '',
    phone: customer.phone || '',
    address: customer.address || null,
    shipping: customer.shipping || null,
    created: customer.created ? new Date(customer.created * 1000).toISOString() : null,
  };
}

function subscriptionLabel(subscription) {
  if (!subscription) return 'Lead';
  if (ACTIVE_STATUSES.has(subscription.status)) {
    return subscription.cancel_at_period_end ? 'Cancels Soon' : 'Active';
  }
  if (subscription.status === 'canceled') return 'Canceled';
  if (subscription.status === 'past_due') return 'Past Due';
  return subscription.status || 'Subscription';
}

function planLabel(subscription) {
  const price = String(subscription?.stripe_price_id || '');
  if (!price) return 'None';
  if (price === process.env.STRIPE_GLOGIC_PRO_YEARLY_PRICE_ID) return 'G-Logic Pro Annual';
  if (price === process.env.STRIPE_GLOGIC_PRO_MONTHLY_PRICE_ID) return 'G-Logic Pro Monthly';
  return price;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUser(req);
    if (!user || !isAdminEmail(user.email)) {
      return json(res, 403, { error: 'Admin access required' });
    }

    const [authUsers, subscriptions] = await Promise.all([
      listAuthUsers(),
      supabaseRest('/rest/v1/subscriptions?select=*&order=updated_at.desc'),
    ]);

    const subscriptionByUser = new Map();
    for (const subscription of Array.isArray(subscriptions) ? subscriptions : []) {
      if (!subscriptionByUser.has(subscription.user_id)) {
        subscriptionByUser.set(subscription.user_id, subscription);
      }
    }

    const stripeCustomerIds = [...new Set(
      (subscriptions || [])
        .map(subscription => subscription.stripe_customer_id)
        .filter(Boolean)
    )];

    const stripeCustomers = new Map();
    await Promise.all(stripeCustomerIds.map(async id => {
      try {
        stripeCustomers.set(id, cleanCustomer(await stripeGet(`/customers/${encodeURIComponent(id)}`)));
      } catch (error) {
        stripeCustomers.set(id, { id, error: error.message });
      }
    }));

    const customers = authUsers.map(authUser => {
      const subscription = subscriptionByUser.get(authUser.id) || null;
      const stripeCustomer = subscription?.stripe_customer_id
        ? stripeCustomers.get(subscription.stripe_customer_id) || null
        : null;
      const metadata = authUser.user_metadata || {};

      return {
        userId: authUser.id,
        email: authUser.email || stripeCustomer?.email || '',
        name: stripeCustomer?.name || metadata.full_name || metadata.name || '',
        phone: stripeCustomer?.phone || authUser.phone || metadata.phone || '',
        instagram: metadata.instagram || metadata.instagram_handle || '',
        company: metadata.company || metadata.business_name || '',
        signupDate: authUser.created_at || null,
        lastSignIn: authUser.last_sign_in_at || null,
        statusLabel: subscriptionLabel(subscription),
        planLabel: planLabel(subscription),
        subscriptionStatus: subscription?.status || 'lead',
        cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end),
        currentPeriodEnd: subscription?.current_period_end || null,
        canceledAt: subscription?.canceled_at || null,
        stripeCustomerId: subscription?.stripe_customer_id || '',
        stripeSubscriptionId: subscription?.stripe_subscription_id || '',
        stripeCustomer,
      };
    }).sort((a, b) => new Date(b.signupDate || 0) - new Date(a.signupDate || 0));

    return json(res, 200, {
      updatedAt: new Date().toISOString(),
      counts: {
        total: customers.length,
        active: customers.filter(customer => customer.statusLabel === 'Active' || customer.statusLabel === 'Cancels Soon').length,
        leads: customers.filter(customer => customer.statusLabel === 'Lead').length,
        canceled: customers.filter(customer => customer.statusLabel === 'Canceled').length,
      },
      customers,
    });
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
};
