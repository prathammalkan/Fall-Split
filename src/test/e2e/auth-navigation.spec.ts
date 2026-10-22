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
});
