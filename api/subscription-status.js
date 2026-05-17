const {
  getAuthUser,
  getLatestSubscription,
  isAdminEmail,
  isPaywallEnabled,
  json,
  subscriptionIsActive,
} = require('../lib/paywall-utils');

module.exports = async function handler(req, res) {
  try {
    const user = await getAuthUser(req);
    if (!user) return json(res, 401, { error: 'Unauthorized' });

    const enabled = isPaywallEnabled();
    const isAdmin = isAdminEmail(user.email);

    if (!enabled || isAdmin) {
      return json(res, 200, {
        enabled,
        active: true,
        isAdmin,
        status: isAdmin ? 'admin' : 'disabled',
      });
    }

    const subscription = await getLatestSubscription(user.id);
    return json(res, 200, {
      enabled,
      active: subscriptionIsActive(subscription),
      isAdmin,
      status: subscription?.status || 'none',
      currentPeriodEnd: subscription?.current_period_end || null,
      cancelAtPeriodEnd: subscription?.cancel_at_period_end || false,
    });
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
};
