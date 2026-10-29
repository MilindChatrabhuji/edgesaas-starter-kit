export interface Env {
  SAAS_KV: KVNamespace;
  ENVIRONMENT: string;
  APP_NAME: string;
  APP_URL: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_STARTER: string;
  STRIPE_PRICE_PRO: string;
}

export type SubscriptionTier = 'free' | 'starter' | 'pro' | 'enterprise';

export interface UserAccount {
  id: string;
  email: string;
  stripeCustomerId?: string;
  subscriptionId?: string;
  tier: SubscriptionTier;
  quotaMonthly: number;
  requestsThisMonth: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyRecord {
  keyHash: string;
  userId: string;
  tier: SubscriptionTier;
  createdAt: string;
  lastUsedAt?: string;
  isActive: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}
