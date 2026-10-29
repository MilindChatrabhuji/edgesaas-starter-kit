import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, UserAccount, ApiKeyRecord, SubscriptionTier } from './types';
import { EdgeRateLimiter } from './ratelimit';
import { createCheckoutSession, createCustomerPortalSession, getStripeClient } from './stripe';

const app = new Hono<{ Bindings: Env }>();

// Security & CORS
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}));

// Utility: SHA-256 hashing for API keys
async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 1. Health & Status
app.get('/health', (c) => {
  return c.json({
    status: 'operational',
    service: c.env.APP_NAME || 'NexusEdge MicroSaaS',
    platform: 'Cloudflare Workers Edge',
    timestamp: new Date().toISOString(),
  });
});

// 2. Pricing Tiers Rate Card
app.get('/api/tiers', (c) => {
  return c.json({
    tiers: [
      {
        id: 'free',
        name: 'Developer Free',
        price_monthly_usd: 0,
        requests_monthly: 100,
        features: ['Community support', 'Standard latency', '100 requests/mo'],
      },
      {
        id: 'starter',
        name: 'Starter Pro',
        price_monthly_usd: 19,
        requests_monthly: 5000,
        features: ['Priority edge execution', 'Full analytics', '5,000 requests/mo'],
      },
      {
        id: 'pro',
        name: 'Business Scale',
        price_monthly_usd: 99,
        requests_monthly: 50000,
        features: ['Dedicated SLA', 'Custom domains', '50,000 requests/mo', 'Email support'],
      },
    ],
  });
});

// 3. Self-Serve API Key Generation (Free Tier)
app.post('/api/keys/generate', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = (body.email || '').trim().toLowerCase();

  if (!email || !email.includes('@')) {
    return c.json({ error: 'Valid email is required to provision an API key.' }, 400);
  }

  const rawKey = `nxp_live_${crypto.randomUUID().replace(/-/g, '')}`;
  const keyHash = await hashApiKey(rawKey);

  const keyRecord: ApiKeyRecord = {
    keyHash,
    userId: email,
    tier: 'free',
    createdAt: new Date().toISOString(),
    isActive: true,
  };

  if (c.env.SAAS_KV) {
    await c.env.SAAS_KV.put(`apikey:${keyHash}`, JSON.stringify(keyRecord));
    await c.env.SAAS_KV.put(`user:${email}`, JSON.stringify({
      id: email,
      email,
      tier: 'free',
      quotaMonthly: 100,
      requestsThisMonth: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  }

  return c.json({
    status: 'SUCCESS',
    apiKey: rawKey,
    tier: 'free',
    monthlyQuota: 100,
    warning: 'Save this API key immediately; it cannot be retrieved again.',
  });
});

// 4. Create Stripe Checkout Session
app.post('/api/billing/checkout', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { email, tier } = body;

  if (!email || !tier || (tier !== 'starter' && tier !== 'pro')) {
    return c.json({ error: 'Valid email and valid tier (starter|pro) required.' }, 400);
  }

  const appUrl = c.env.APP_URL || 'https://edgesaas.example.com';
  const successUrl = `${appUrl}/dashboard?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${appUrl}/pricing`;

  try {
    const session = await createCheckoutSession(c.env, email, tier, successUrl, cancelUrl);
    return c.json({ checkoutUrl: session.url, sessionId: session.sessionId });
  } catch (err: any) {
    return c.json({ error: 'Stripe session creation failed', details: err.message }, 500);
  }
});

// 5. Stripe Webhook Handler
app.post('/api/billing/webhook', async (c) => {
  const signature = c.req.header('stripe-signature');
  if (!signature || !c.env.STRIPE_WEBHOOK_SECRET) {
    return c.json({ error: 'Missing webhook signature or secret.' }, 400);
  }

  const rawBody = await c.req.text();
  const stripe = getStripeClient(c.env);

  try {
    const event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      c.env.STRIPE_WEBHOOK_SECRET
    );

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as any;
      const email = session.customer_email;
      const tier = session.metadata?.tier || 'starter';

      if (c.env.SAAS_KV && email) {
        const userRaw = await c.env.SAAS_KV.get(`user:${email}`);
        const user: UserAccount = userRaw ? JSON.parse(userRaw) : {
          id: email,
          email,
          tier: tier as SubscriptionTier,
          quotaMonthly: tier === 'pro' ? 50000 : 5000,
          requestsThisMonth: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        user.tier = tier as SubscriptionTier;
        user.quotaMonthly = tier === 'pro' ? 50000 : 5000;
        user.stripeCustomerId = session.customer;
        user.subscriptionId = session.subscription;
        user.updatedAt = new Date().toISOString();

        await c.env.SAAS_KV.put(`user:${email}`, JSON.stringify(user));
      }
    }

    return c.json({ received: true });
  } catch (err: any) {
    return c.json({ error: 'Webhook processing failed', details: err.message }, 400);
  }
});

// 6. Protected Micro-SaaS Endpoint (Example: Fast Domain & Fraud Analyzer)
app.post('/v1/analyze', async (c) => {
  const authHeader = c.req.header('Authorization') || c.req.header('X-API-Key') || '';
  const apiKey = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!apiKey || !apiKey.startsWith('nxp_live_')) {
    return c.json({ error: 'Unauthorized: Invalid or missing API key format.' }, 401);
  }

  // Rate Limiting
  const limiter = new EdgeRateLimiter(c.env.SAAS_KV);
  const limitResult = await limiter.checkLimit(apiKey, 60, 60); // 60 req/min

  if (!limitResult.allowed) {
    return c.json({
      error: 'Too Many Requests',
      limit: limitResult.limit,
      resetSeconds: limitResult.resetSeconds,
    }, 429);
  }

  const body = await c.req.json().catch(() => ({}));
  const domain = (body.domain || '').trim().toLowerCase();

  if (!domain) {
    return c.json({ error: 'Missing required field: domain.' }, 400);
  }

  // Execution: Business logic running at <10ms edge latency
  const isDisposable = ['tempmail.com', 'mailinator.com', '10minutemail.com', 'trashmail.com'].includes(domain);
  const isSuspicious = domain.length > 30 || (domain.match(/[0-9]/g) || []).length > 6;

  return c.json({
    domain,
    isDisposable,
    isSuspicious,
    riskScore: isDisposable ? 0.95 : (isSuspicious ? 0.6 : 0.05),
    verdict: isDisposable ? 'REJECT' : (isSuspicious ? 'FLAG' : 'ALLOW'),
    edgeTimestamp: new Date().toISOString(),
    remainingQuota: limitResult.remaining,
  });
});

export default app;
