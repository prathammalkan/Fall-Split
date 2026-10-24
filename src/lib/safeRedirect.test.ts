import { describe, expect, it } from 'vitest';
import { isSafeRedirect } from './safeRedirect';

describe('isSafeRedirect open-redirect prevention', () => {
  it('accepts valid relative paths', () => {
    expect(isSafeRedirect('/')).toBe(true);
    expect(isSafeRedirect('/groups')).toBe(true);
    expect(isSafeRedirect('/groups/123')).toBe(true);
    expect(isSafeRedirect('/activity?filter=mine')).toBe(true);
  });

  it('rejects null, undefined, empty string, or whitespace', () => {
    expect(isSafeRedirect(null)).toBe(false);
    expect(isSafeRedirect(undefined)).toBe(false);
    expect(isSafeRedirect('')).toBe(false);
    expect(isSafeRedirect('   ')).toBe(false);
  });

  it('rejects protocol-relative URLs', () => {
    expect(isSafeRedirect('//evil.com')).toBe(false);
    expect(isSafeRedirect('//localhost')).toBe(false);
    expect(isSafeRedirect('/\\evil.com')).toBe(false);
  });

  it('rejects external URLs with protocols', () => {
    expect(isSafeRedirect('https://evil.com')).toBe(false);
    expect(isSafeRedirect('http://evil.com')).toBe(false);
    expect(isSafeRedirect('javascript:alert(1)')).toBe(false);
    expect(isSafeRedirect('data:text/html,evil')).toBe(false);
  });

  it('rejects paths containing backslashes', () => {
    expect(isSafeRedirect('/\\evil.com')).toBe(false);
    expect(isSafeRedirect('/foo\\bar')).toBe(false);
    expect(isSafeRedirect('\\evil.com')).toBe(false);
  });

  it('rejects paths mimicking schemes', () => {
    expect(isSafeRedirect('/javascript:alert(1)')).toBe(false);
    expect(isSafeRedirect('/https://evil.com')).toBe(false);
  });
});
