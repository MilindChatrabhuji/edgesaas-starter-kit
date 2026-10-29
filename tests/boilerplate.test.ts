import { describe, it, expect } from 'vitest';
import app from '../src/index';

describe('NexusEdge MicroSaaS Boilerplate Test Suite', () => {
  it('GET /health returns operational status', async () => {
    const res = await app.request('/health', { method: 'GET' });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.status).toBe('operational');
    expect(data.platform).toContain('Cloudflare Workers');
  });

  it('GET /api/tiers returns pricing structure', async () => {
    const res = await app.request('/api/tiers', { method: 'GET' });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(Array.isArray(data.tiers)).toBe(true);
    expect(data.tiers.length).toBe(3);
    expect(data.tiers[0].id).toBe('free');
  });

  it('POST /api/keys/generate requires valid email', async () => {
    const res = await app.request('/api/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invalid-email' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/keys/generate provisions free API key with valid email', async () => {
    const res = await app.request('/api/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'builder@example.com' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.status).toBe('SUCCESS');
    expect(data.apiKey).toMatch(/^nxp_live_[a-f0-9]{32}$/);
    expect(data.tier).toBe('free');
  });

  it('POST /v1/analyze rejects request without valid API key', async () => {
    const res = await app.request('/v1/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'tempmail.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /v1/analyze executes correctly with valid API key', async () => {
    const res = await app.request('/v1/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer nxp_live_0123456789abcdef0123456789abcdef',
      },
      body: JSON.stringify({ domain: 'tempmail.com' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.domain).toBe('tempmail.com');
    expect(data.isDisposable).toBe(true);
    expect(data.verdict).toBe('REJECT');
  });
});
