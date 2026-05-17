const crypto = require('crypto');
const { json, supabaseRest } = require('../lib/paywall-utils');

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyStripeSignature(rawBody, signatureHeader) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error('Missing STRIPE_WEBHOOK_SECRET.');
  if (!signatureHeader) throw new Error('Missing Stripe signature.');

  const parts = Object.fromEntries(
    signatureHeader.split(',').map(part => {
      const [key, value] = part.split('=');
      return [key, value];
    })
  );
  const signedPayload = `${parts.t}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  if (!parts.v1 || !timingSafeEqual(parts.v1, expected)) {
    throw new Error('Invalid Stripe signature.');
  }
}

function tsToIso(value) {
  return value ? new Date(value * 1000).toISOString() : null;
}

async function upsertSubscriptionFromStripe(subscription, fallbackUserId = '') {
  const userId = subscription.metadata?.user_id || fallbackUserId;
  if (!userId) throw new Error('Stripe subscription is missing user_id metadata.');

  const item = subscription.items?.data?.[0] || {};
  await supabaseRest('/rest/v1/subscriptions?on_conflict=stripe_subscription_id', {
    method: 'POST',
    headers: {
      prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([{
      user_id: userId,
      stripe_customer_id: subscription.customer,
      stripe_subscription_id: subscription.id,
      stripe_price_id: item.price?.id || null,
      stripe_product_id: item.price?.product || null,
      status: subscription.status,
      current_period_start: tsToIso(subscription.current_period_start),
      current_period_end: tsToIso(subscription.current_period_end),
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      canceled_at: tsToIso(subscription.canceled_at),
      updated_at: new Date().toISOString(),
    }]),
  });
}

async function fetchStripeSubscription(subscriptionId) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const response = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    headers: { authorization: `Bearer ${stripeSecretKey}` },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || 'Could not fetch Stripe subscription.');
  }
  return payload;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  try {
    const rawBody = await getRawBody(req);
    verifyStripeSignature(rawBody, req.headers['stripe-signature']);

    const event = JSON.parse(rawBody);
    const object = event.data?.object || {};

    if (event.type === 'checkout.session.completed' && object.subscription) {
      const subscription = await fetchStripeSubscription(object.subscription);
      await upsertSubscriptionFromStripe(subscription, object.client_reference_id);
    }

    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      await upsertSubscriptionFromStripe(object);
    }

    return json(res, 200, { received: true });
  } catch (error) {
    return json(res, 400, { error: error.message });
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
