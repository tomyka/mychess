import { test, expect } from '@playwright/test';

test.describe('Login page', () => {
  test('shows the MyChess brand and the magic-link email sign-in form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('link', { name: 'MyChess' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
  });
});

test.describe('Unauthenticated visitors', () => {
  // The landing page renders publicly for a signed-out visitor (see
  // mychess/CLAUDE.md's Auth model section) — it's the one (player) route
  // that doesn't require an account, so it does NOT redirect to /login.
  test('renders the public landing page at / without redirecting', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/^[^?]*\/$/);
    await expect(page.getByRole('heading', { name: 'Your chess, all in one place' })).toBeVisible();
  });

  test('redirects /coach to /login when not authenticated', async ({ page }) => {
    await page.goto('/coach');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Join page', () => {
  test('shows invalid invite message for bad token', async ({ page }) => {
    await page.goto('/join/invalid-token-xyz');
    await expect(page.locator('h1')).toContainText("isn't valid");
  });
});
