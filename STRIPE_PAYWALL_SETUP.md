# G-Logic Automation Stripe Paywall Setup

## Product Strategy

Use the existing Essential Life Kits Stripe account as the parent account.

- Product: `G-Logic Pro`
- Monthly price: `$29/month`
- Yearly price: `$290/year`
- Optional trial: `7 days`

G-Logic Studio is included in G-Logic Pro for launch:

- Text Overlay
- Editor
- Audio tools

## Sandbox Setup Steps

1. In Stripe Sandbox, create product `G-Logic Pro`.
2. Create a recurring monthly price for `$29`.
3. Create a recurring yearly price for `$290`.
4. Copy both Stripe price IDs.
5. In Supabase SQL Editor, run `phase4_subscriptions.sql`.
6. In Vercel production env vars, add:

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_GLOGIC_PRO_MONTHLY_PRICE_ID
STRIPE_GLOGIC_PRO_YEARLY_PRICE_ID
GLOGIC_PAYWALL_ENABLED=false
PUBLIC_APP_URL=https://g-logic-automation-test.vercel.app
```

7. In Stripe, create a webhook endpoint:

```text
https://g-logic-automation-test.vercel.app/api/stripe-webhook
```

Subscribe it to:

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
```

8. After sandbox checkout works, change `GLOGIC_PAYWALL_ENABLED` to `true`.
9. Redeploy production after env changes.

## Safety Rules

- Admin email `essentiallifekits@gmail.com` bypasses the paywall.
- The Admin Portal remains separate.
- If the paywall is disabled, all signed-in users can continue using the app.
- If subscription status cannot be checked, the app fails open for now to avoid accidental lockouts during setup.

## Test Cards

Use Stripe's sandbox cards from the Stripe test card documentation.

Common success card:

```text
4242 4242 4242 4242
```

Use any future expiration date and any CVC.
