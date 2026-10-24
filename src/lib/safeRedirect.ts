/**
 * Validate that a URL path is a safe, relative application path
 * and cannot be exploited for open redirects.
 */
export function isSafeRedirect(path?: string | null): path is string {
  if (!path || typeof path !== 'string') return false;
  const trimmed = path.trim();
  // Must start with exactly one forward slash, not double slash or backslash
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return false;
  }
  // Must not contain backslashes anywhere (which some browsers treat as slashes)
  if (trimmed.includes('\\')) {
    return false;
  }
  // Must not contain control characters
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code < 32 || code === 127) {
      return false;
    }
  }
  // Must not contain URI scheme patterns (e.g. /javascript:...)
  if (/^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return false;
  }
  return true;
}
