import { describe, expect, it } from 'vitest';
import vercelConfigSource from '../../vercel.json?raw';

interface VercelConfig {
  headers: Array<{
    headers: Array<{ key: string; value: string }>;
  }>;
}

const config = JSON.parse(vercelConfigSource) as VercelConfig;

const allHeaders = config.headers.flatMap((rule) => rule.headers);
const findHeader = (name: string) =>
  allHeaders.find((header) => header.key.toLowerCase() === name.toLowerCase())?.value;

describe('Vercel browser capability and security headers', () => {
  it('allows same-origin camera access for invitation QR scanning only', () => {
    const permissionsPolicy = findHeader('permissions-policy');
    expect(permissionsPolicy).toContain('camera=(self)');
    expect(permissionsPolicy).toContain('microphone=()');
    expect(permissionsPolicy).toContain('geolocation=()');
  });

  it('enforces strict transport, framing, content-type, and cross-origin isolation headers', () => {
    expect(findHeader('x-content-type-options')).toBe('nosniff');
    expect(findHeader('x-frame-options')).toBe('DENY');
    expect(findHeader('strict-transport-security')).toContain('max-age=63072000');
    expect(findHeader('cross-origin-opener-policy')).toBe('same-origin');
    expect(findHeader('cross-origin-resource-policy')).toBe('same-origin');
    expect(findHeader('x-permitted-cross-domain-policies')).toBe('none');
    expect(findHeader('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(findHeader('content-security-policy')).toContain("object-src 'none'");
    expect(findHeader('content-security-policy')).toContain("frame-ancestors 'none'");
  });
});
