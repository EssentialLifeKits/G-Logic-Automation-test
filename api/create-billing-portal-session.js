const {
  getAuthUser,
  getLatestSubscription,
  isAdminEmail,
  json,
  stripeRequest,
} = require('../lib/paywall-utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUser(req);
    if (!user) return json(res, 401, { error: 'Unauthorized' });
    if (isAdminEmail(user.email)) return json(res, 200, { adminBypass: true, url: '/index.html' });

    const subscription = await getLatestSubscription(user.id);
    if (!subscription?.stripe_customer_id) {
      return json(res, 404, { error: 'No Stripe customer found for this user.' });
    }

    const origin = process.env.PUBLIC_APP_URL || `https://${req.headers.host}`;
    const session = await stripeRequest('/billing_portal/sessions', {
      customer: subscription.stripe_customer_id,
      return_url: `${origin}/index.html`,
    });

    return json(res, 200, { url: session.url });
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
};
