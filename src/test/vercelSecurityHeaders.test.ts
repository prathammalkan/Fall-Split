import { describe, expect, it } from 'vitest';
import vercelConfigSource from '../../vercel.json?raw';

interface VercelConfig {
  headers: Array<{
    headers: Array<{ key: string; value: string }>;
  }>;
}

const config = JSON.parse(vercelConfigSource) as VercelConfig;

const permissionsPolicy = config.headers
  .flatMap((rule) => rule.headers)
  .find((header) => header.key.toLowerCase() === 'permissions-policy')?.value;

describe('Vercel browser capability headers', () => {
  it('allows same-origin camera access for invitation QR scanning only', () => {
    expect(permissionsPolicy).toContain('camera=(self)');
    expect(permissionsPolicy).toContain('microphone=()');
    expect(permissionsPolicy).toContain('geolocation=()');
  });
});
