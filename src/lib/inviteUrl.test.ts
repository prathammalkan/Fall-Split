import { describe, expect, it } from 'vitest';
import { getInviteUrl } from './inviteUrl';

const token = 'a'.repeat(64);

describe('getInviteUrl', () => {
  it('uses the configured public origin and normalizes a trailing slash', () => {
    expect(getInviteUrl(token, 'https://split.example/', 'http://localhost:5173', true)).toBe(
      `https://split.example/invite/${token}`
    );
  });

  it('allows the current localhost origin only in development', () => {
    expect(getInviteUrl(token, undefined, 'http://localhost:4173', false)).toBe(
      `http://localhost:4173/invite/${token}`
    );
  });

  it.each([
    [undefined, 'https://preview.example', true],
    [undefined, 'https://preview.example', false],
    ['not a URL', 'http://localhost:5173', false],
    ['http://split.example', 'http://localhost:5173', true],
    ['https://split.example/path', 'http://localhost:5173', true],
  ])('rejects unsafe or missing public URL configuration', (configured, current, production) => {
    expect(() => getInviteUrl(token, configured, current, production)).toThrow();
  });
});
