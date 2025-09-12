import { expect, test } from '@playwright/test';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const { USERNAME, PASSWORD } = process.env;

test('main', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => {
    const dt = new Date().getFullYear() + new Date().getHours();
    localStorage.setItem('devtools', `${dt}`);
  });
  await page.goto('https://www.smartplay.lcsd.gov.hk/home');
  await expect(page.getByRole('heading', { name: '登入 SmartPLAY' })).toBeVisible();
  await page.getByRole('textbox', { name: 'SmartPLAY用戶帳號或別名' }).fill(USERNAME!);
  await page.getByRole('textbox', { name: '密碼' }).fill(PASSWORD!);
  await page.getByRole('button', { name: '登入' }).click();

  await page.locator('.left-menu-continer li:nth-child(2)').click();
  // await page.getByRole('button', { name: '搜寻运动、场馆' }).click();
  // await page.getByRole('button', { name: '舞蹈' }).click();

  // await page.getByText('地区/组').click();
  // await page.getByLabel('香港未选取').getByAltText('未选中').click();
  // await page.locator('.global-content-mobile').first().click();
  // await page.getByRole('button', { name: '搜寻', exact: true }).click();

  await page.goto('https://www.smartplay.lcsd.gov.hk/facilities/search-result?keywords=&district=CW,EN,SN,WCH&startDate=&typeCode=DNRM&venueCode=&sportCode=DAAC&typeName=%E8%88%9E%E8%B9%88&frmFilterType=&venueSportCode=&isFree=false');

  const tokenHeader = await page.evaluate(() => localStorage.getItem('webappaccessToken'));
  console.log('tokenHeader', tokenHeader);
});
