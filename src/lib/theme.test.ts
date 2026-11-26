import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, getThemePreference, initTheme, setThemePreference } from './theme';

describe('theme — on-device appearance preference', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
  });

  it('defaults to system preference when unset', () => {
    expect(getThemePreference()).toBe('system');
    expect(initTheme()).toBe('system');
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('persists and applies dark and light themes locally', () => {
    setThemePreference('dark');
    expect(getThemePreference()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    setThemePreference('light');
    expect(getThemePreference()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    setThemePreference('system');
    expect(getThemePreference()).toBe('system');
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('ignores invalid stored theme values', () => {
    localStorage.setItem('fs_theme_preference', 'neon');
    expect(getThemePreference()).toBe('system');
    applyTheme('system');
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });
});
