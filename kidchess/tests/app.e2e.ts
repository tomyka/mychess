import { test, expect } from '@playwright/test';

test.describe('Login page', () => {
  test('shows KidChess title and Google sign-in button', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('h1')).toContainText('KidChess');
    await expect(page.locator('button')).toContainText('Sign in with Google');
  });
});

test.describe('Unauthenticated redirects', () => {
  test('redirects / to /login when not authenticated', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('redirects /learn to /login when not authenticated', async ({ page }) => {
    await page.goto('/learn');
    await expect(page).toHaveURL(/\/login/);
  });

  test('redirects /coach to /login when not authenticated', async ({ page }) => {
    await page.goto('/coach');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Join page', () => {
  test('shows invalid invite message for bad token', async ({ page }) => {
    await page.goto('/join/invalid-token-xyz');
    await expect(page.locator('h1')).toContainText('Invalid Invite');
  });
});
