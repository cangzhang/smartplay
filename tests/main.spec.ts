import { expect, test } from '@playwright/test';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const { USERNAME, PASSWORD } = process.env;

test('login', async ({ page }) => {
  await page.addInitScript(() => {
    const dt = new Date().getFullYear() + new Date().getHours();
    localStorage.setItem('devtools', `${dt}`);
  });
  await page.goto('https://www.smartplay.lcsd.gov.hk/home');
  await expect(page.getByRole('heading', { name: '登入 SmartPLAY' })).toBeVisible();
  await page.getByRole('textbox', { name: 'SmartPLAY用戶帳號或別名' }).fill(USERNAME!);
  await page.getByRole('textbox', { name: '密碼' }).fill(PASSWORD!);
  await page.getByRole('button', { name: '登入' }).click();
});
