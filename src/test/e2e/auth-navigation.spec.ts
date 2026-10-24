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
});
