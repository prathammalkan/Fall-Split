/**
 * theme.ts — 100% on-device appearance preference (System / Light / Dark).
 *
 * Stored purely in localStorage so switching themes is instant (0ms)
 * and causes zero server-side requests.
 */

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'fs_theme_preference';

export function getThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') {
      return raw;
    }
  } catch {
    // Ignore unavailable storage
  }
  return 'system';
}

export function applyTheme(preference: ThemePreference): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  if (preference === 'light' || preference === 'dark') {
    root.setAttribute('data-theme', preference);
    root.style.colorScheme = preference;
  } else {
    root.removeAttribute('data-theme');
    root.style.colorScheme = '';
  }

  const resolvedDark =
    preference === 'dark' ||
    (preference === 'system' &&
      typeof window !== 'undefined' &&
      Boolean(window.matchMedia?.('(prefers-color-scheme: dark)')?.matches));

  const themeMeta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (themeMeta) {
    themeMeta.setAttribute('content', resolvedDark ? '#0a0a0a' : '#ffffff');
  }
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, preference);
    }
  } catch {
    // Ignore storage unavailability
  }
  applyTheme(preference);
}

export function initTheme(): ThemePreference {
  const pref = getThemePreference();
  applyTheme(pref);
  return pref;
}
