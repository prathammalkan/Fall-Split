/** Resolve the public origin used by invitation links and QR codes. */
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
    if (
      !['https:', 'http:'].includes(origin.protocol) ||
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
    const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(current.hostname);
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
