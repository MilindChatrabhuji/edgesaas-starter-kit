import Stripe from 'stripe';
import { Env, SubscriptionTier } from './types';

export function getStripeClient(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-10-28.acacia' as any,
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export async function createCheckoutSession(
  env: Env,
  email: string,
  tier: SubscriptionTier,
  successUrl: string,
  cancelUrl: string
): Promise<{ url: string; sessionId: string }> {
  const stripe = getStripeClient(env);
  const priceId = tier === 'starter' ? env.STRIPE_PRICE_STARTER : env.STRIPE_PRICE_PRO;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    customer_email: email,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      tier,
      app: env.APP_NAME,
    },
  });

  return {
    url: session.url || '',
    sessionId: session.id,
  };
}

export async function createCustomerPortalSession(
  env: Env,
  customerId: string,
  returnUrl: string
): Promise<{ url: string }> {
  const stripe = getStripeClient(env);
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return { url: portalSession.url };
}
