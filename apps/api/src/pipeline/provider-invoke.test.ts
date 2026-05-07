// Regression test: x-test-workspace-id is forwarded ONLY when NODE_ENV='test'
// AND baseUrl is loopback. Any other combination drops the header.

import { describe, it, expect } from 'vitest';
import { buildProviderHeaders } from './provider-invoke.js';

const WS = '00000000-0000-0000-0000-000000000abc';

describe('buildProviderHeaders — hermetic test discriminator', () => {
  it('forwards header only when testMode=true AND loopback baseUrl', () => {
    const h = buildProviderHeaders({
      baseUrl: 'http://127.0.0.1:5000',
      workspaceId: WS,
      testMode: true,
    });
    expect(h['x-test-workspace-id']).toBe(WS);
    expect(h['content-type']).toBe('application/json');
  });

  it('localhost:port also forwards', () => {
    const h = buildProviderHeaders({
      baseUrl: 'http://localhost:8080',
      workspaceId: WS,
      testMode: true,
    });
    expect(h['x-test-workspace-id']).toBe(WS);
  });

  it('drops header in production-like env (testMode=false)', () => {
    const h = buildProviderHeaders({
      baseUrl: 'http://127.0.0.1:5000',
      workspaceId: WS,
      testMode: false,
    });
    expect(h['x-test-workspace-id']).toBeUndefined();
  });

  it('drops header against non-loopback baseUrl even with testMode=true', () => {
    const h = buildProviderHeaders({
      baseUrl: 'https://api.anthropic.com',
      workspaceId: WS,
      testMode: true,
    });
    expect(h['x-test-workspace-id']).toBeUndefined();
  });

  it('drops header against URL-smuggling tricks even with testMode=true', () => {
    for (const url of [
      'http://127.0.0.1:80@evil.com',
      'http://localhost.attacker.com/',
      'http://127.0.0.1.evil/',
      'http://user:pass@127.0.0.1/',
    ]) {
      const h = buildProviderHeaders({ baseUrl: url, workspaceId: WS, testMode: true });
      expect(h['x-test-workspace-id'], `url=${url}`).toBeUndefined();
    }
  });

  it('drops header when workspaceId is missing', () => {
    const h = buildProviderHeaders({ baseUrl: 'http://127.0.0.1:5000', testMode: true });
    expect(h['x-test-workspace-id']).toBeUndefined();
  });

  it('preserves caller-provided baseHeaders', () => {
    const h = buildProviderHeaders({
      baseUrl: 'https://api.anthropic.com',
      testMode: false,
      baseHeaders: { 'x-api-key': 'sk-ant-test', authorization: 'Bearer x' },
    });
    expect(h['x-api-key']).toBe('sk-ant-test');
    expect(h['authorization']).toBe('Bearer x');
    expect(h['x-test-workspace-id']).toBeUndefined();
  });
});
