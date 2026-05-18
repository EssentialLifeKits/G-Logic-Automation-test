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

    const body = typeof req.body === 'object' ? req.body : {};
    const billing = body.billing === 'yearly' ? 'yearly' : 'monthly';
    const priceId = billing === 'yearly'
      ? process.env.STRIPE_GLOGIC_PRO_YEARLY_PRICE_ID
      : process.env.STRIPE_GLOGIC_PRO_MONTHLY_PRICE_ID;

    if (!priceId) {
      return json(res, 500, { error: `Missing Stripe ${billing} price id.` });
    }

    const origin = process.env.PUBLIC_APP_URL || `https://${req.headers.host}`;
    const existing = await getLatestSubscription(user.id);
    const params = {
      mode: 'subscription',
      success_url: `${origin}/index.html?checkout=success`,
      cancel_url: `${origin}/index.html?checkout=cancelled`,
      client_reference_id: user.id,
      customer_email: user.email || '',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      'metadata[user_id]': user.id,
      'subscription_data[metadata][user_id]': user.id,
      'phone_number_collection[enabled]': 'true',
      allow_promotion_codes: 'true',
    };

    if (existing?.stripe_customer_id) {
      delete params.customer_email;
      params.customer = existing.stripe_customer_id;
    }

    const session = await stripeRequest('/checkout/sessions', params);
    return json(res, 200, { url: session.url });
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
};
