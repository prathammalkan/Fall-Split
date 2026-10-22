/** Resolve the public origin used by invitation links and QR codes. */
function isLocalhost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host === '0.0.0.0' ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

export function getInviteUrl(
  token: string,
  configuredUrl: string | undefined,
  currentOrigin: string,
  isProduction: boolean
): string {
  let origin: URL;
  if (configuredUrl?.trim()) {
    try {
      origin = new URL(configuredUrl.trim());
    } catch {
      throw new Error('The invitation URL configuration is invalid.');
    }
    const localHost = isLocalhost(origin.hostname);
    if (
      !['https:', 'http:'].includes(origin.protocol) ||
      (isProduction && localHost) ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash ||
      (isProduction && origin.protocol !== 'https:')
    ) {
      throw new Error('Configure the invitation URL as a public HTTPS origin.');
    }
  } else {
    let current: URL;
    try {
      current = new URL(currentOrigin);
    } catch {
      throw new Error('Configure VITE_APP_URL before creating invitation links.');
    }
    const localHost = isLocalhost(current.hostname);
    if (isProduction || !localHost) {
      throw new Error('Configure VITE_APP_URL before creating invitation links.');
    }
    origin = current;
  }
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(token)) {
    throw new Error('The invitation token is invalid.');
  }
  return new URL(`/invite/${token}`, origin.origin).toString();
}

/** Accept only a direct invitation URL for the configured app origin. */
export function parseInviteUrl(
  value: string,
  configuredUrl: string | undefined,
  currentOrigin: string,
  isProduction: boolean
): string {
  const expectedUrl = getInviteUrl('a'.repeat(16), configuredUrl, currentOrigin, isProduction);
  const expectedOrigin = new URL(expectedUrl).origin;
  let scanned: URL;
  try {
    scanned = new URL(value.trim());
  } catch {
    throw new Error('This QR code is not a valid Fall Split invitation link.');
  }
  const match = /^\/invite\/([a-zA-Z0-9_-]{16,128})$/.exec(scanned.pathname);
  if (
    scanned.origin !== expectedOrigin ||
    scanned.username ||
    scanned.password ||
    scanned.search ||
    scanned.hash ||
    !match
  ) {
    throw new Error('This QR code is not a valid Fall Split invitation link.');
  }
  return match[1]!;
}
