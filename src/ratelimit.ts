import { RateLimitResult } from './types';

export class EdgeRateLimiter {
  private kv?: KVNamespace;

  constructor(kv?: KVNamespace) {
    this.kv = kv;
  }

  async checkLimit(identifier: string, limit: number, windowSeconds = 60): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000);
    const windowKey = `ratelimit:${identifier}:${Math.floor(now / windowSeconds)}`;

    if (!this.kv) {
      // In-memory or offline fallback
      return {
        allowed: true,
        limit,
        remaining: limit - 1,
        resetSeconds: windowSeconds - (now % windowSeconds),
      };
    }

    try {
      const currentVal = await this.kv.get(windowKey);
      const count = currentVal ? parseInt(currentVal, 10) : 0;

      if (count >= limit) {
        return {
          allowed: false,
          limit,
          remaining: 0,
          resetSeconds: windowSeconds - (now % windowSeconds),
        };
      }

      await this.kv.put(windowKey, (count + 1).toString(), {
        expirationTtl: windowSeconds + 10,
      });

      return {
        allowed: true,
        limit,
        remaining: limit - (count + 1),
        resetSeconds: windowSeconds - (now % windowSeconds),
      };
    } catch {
      // Fail-open strategy to protect availability
      return {
        allowed: true,
        limit,
        remaining: limit - 1,
        resetSeconds: windowSeconds,
      };
    }
  }
}
