import { describe, expect, it } from 'vitest';
import { getInviteUrl, parseInviteUrl } from './inviteUrl';

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

  it('rejects localhost as the configured production origin', () => {
    expect(() => getInviteUrl(token, 'https://localhost', 'https://localhost', true)).toThrow();
    expect(() =>
      getInviteUrl(token, 'https://app.localhost', 'https://app.localhost', true)
    ).toThrow();
    expect(() => getInviteUrl(token, 'https://127.0.0.2', 'https://127.0.0.2', true)).toThrow();
  });
});

describe('parseInviteUrl', () => {
  const publicOrigin = 'https://fall-split.vercel.app';

  it('extracts a valid token only from the configured app origin and invite route', () => {
    expect(
      parseInviteUrl(
        `https://fall-split.vercel.app/invite/${token}`,
        publicOrigin,
        'http://localhost:5173',
        true
      )
    ).toBe(token);
  });

  it.each([
    `https://evil.example/invite/${token}`,
    `https://fall-split.vercel.app/login/${token}`,
    `https://fall-split.vercel.app/invite/${token}?redirect=/login`,
    `https://fall-split.vercel.app/invite/${token}#fragment`,
    `https://user@fall-split.vercel.app/invite/${token}`,
    'not a url',
    'https://fall-split.vercel.app/invite/short',
  ])('rejects untrusted or malformed QR content: %s', (value) => {
    expect(() => parseInviteUrl(value, publicOrigin, 'http://localhost:5173', true)).toThrow();
  });

  it('accepts the matching local development origin but rejects a different local origin', () => {
    expect(
      parseInviteUrl(
        `http://localhost:5173/invite/${token}`,
        undefined,
        'http://localhost:5173',
        false
      )
    ).toBe(token);
    expect(() =>
      parseInviteUrl(
        `http://localhost:5174/invite/${token}`,
        undefined,
        'http://localhost:5173',
        false
      )
    ).toThrow();
  });
});
