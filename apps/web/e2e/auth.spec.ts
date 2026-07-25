import { test, expect } from '@playwright/test'
import { signIn } from './helpers'

test.describe('auth', () => {
  test('anonymous visitor is redirected to sign-in', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/sign-in/)
    await expect(page.getByRole('heading', { name: /sign in to pulse/i })).toBeVisible()
  })

  test('protected routes are all guarded', async ({ page }) => {
    for (const route of ['/trends', '/themes', '/chat', '/settings']) {
      await page.goto(route)
      await expect(page).toHaveURL(/\/sign-in/)
    }
  })

  test('wrong password shows an error, right one lands on the queue', async ({ page }) => {
    await page.goto('/sign-in')
    await page.getByPlaceholder('Email or username').fill('dana@example.com')
    await page.getByPlaceholder('Password').fill('wrong-password')
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page.locator('.text-red-600')).toBeVisible()

    await signIn(page)
    await expect(page.getByRole('heading', { name: 'Queue' })).toBeVisible()
  })

  test('sign out returns to sign-in and re-locks the app', async ({ page }) => {
    await signIn(page)
    await page.getByRole('button', { name: /sign out/i }).click()
    await page.goto('/')
    await expect(page).toHaveURL(/\/sign-in/)
  })
})
