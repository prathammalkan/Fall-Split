import { expect, test } from '@playwright/test';

test.describe('unauthenticated navigation', () => {
  test('shows the sign-in screen and reaches registration', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Password' })).toBeVisible();

    await page.getByRole('link', { name: 'Create one' }).click();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible();
  });

  test('keeps legal and support pages reachable', async ({ page }) => {
    await page.goto('/login');

    await page.getByRole('link', { name: 'Privacy' }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole('heading', { name: /privacy/i })).toBeVisible();
  });

  test('displays expired verification recovery UI on callback error', async ({ page }) => {
    await page.goto(
      '/auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
    );

    await expect(page.getByText(/this email verification link has expired/i)).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /request a new verification link/i })
    ).toBeVisible();
    await expect(page.getByLabel(/email address for verification/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /send new link/i })).toBeVisible();

    await page.getByRole('button', { name: /back to sign in/i }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('displays friendly message when visiting callback without credentials', async ({ page }) => {
    await page.goto('/auth/callback');

    await expect(page.getByText(/no authentication details were found/i)).toBeVisible();
    await page.getByRole('button', { name: /back to sign in/i }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('displays intro screen with branding and developer credit on fresh load', async ({
    page,
  }) => {
    await page.goto('/');

    const credit = page.getByText('Developed by Pratham Malkan');
    await expect(credit).toBeVisible();
    await expect(page.getByRole('heading', { name: /Fall\s*Split/i })).toBeVisible();

    // Transitions into the application after intro duration
    await expect(page).toHaveURL(/\/login$/);
  });

  test('redirects protected routes to sign-in and renders lazy auth/legal routes cleanly', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/friends');
    await expect(page).toHaveURL(/\/login$/);

    await page.goto('/forgot-password');
    await expect(page.getByRole('heading', { name: 'Forgot password' })).toBeVisible();

    await page.goto('/reset-password');
    await expect(page.getByRole('heading', { name: 'Set new password' })).toBeVisible();

    await page.goto('/terms');
    await expect(page.getByRole('heading', { name: 'Terms & Conditions' })).toBeVisible();

    await page.goto('/support');
    await expect(page.getByRole('heading', { name: 'Contact & Support' })).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test('handles OAuth cancellation and exchange errors cleanly without email resend UI', async ({
    page,
  }) => {
    await page.goto('/auth/callback?error=access_denied&error_description=User+denied+access');
    await expect(page.getByText(/sign-in was cancelled/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /send new link/i })).toHaveCount(0);

    await page.goto(
      '/auth/callback?error=server_error&error_description=Unable+to+exchange+external+code%3A+invalid_grant'
    );
    await expect(page.getByText(/google or oauth sign-in could not be completed/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /send new link/i })).toHaveCount(0);
  });

  test('initiates Google OAuth PKCE redirect with same-origin callback URL', async ({ page }) => {
    let capturedAuthUrl = '';
    await page.route('**/auth/v1/authorize**', async (route) => {
      capturedAuthUrl = route.request().url();
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>OAuth Redirect Intercepted</body></html>',
      });
    });

    await page.goto('/login');
    const appOrigin = new URL(page.url()).origin;
    await page.getByRole('button', { name: /continue with google/i }).click();

    await expect.poll(() => capturedAuthUrl).toContain('/auth/v1/authorize');
    const parsedUrl = new URL(capturedAuthUrl);
    expect(parsedUrl.searchParams.get('provider')).toBe('google');
    expect(parsedUrl.searchParams.get('code_challenge_method')?.toLowerCase()).toBe('s256');
    expect(parsedUrl.searchParams.get('redirect_to')).toBe(`${appOrigin}/auth/callback`);
  });
});
