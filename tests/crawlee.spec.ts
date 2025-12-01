import { expect, test } from '@playwright/test';
import { PlaywrightCrawler, ProxyConfiguration } from 'crawlee';
import nextEnv from '@next/env';
import dayjs from 'dayjs';

nextEnv.loadEnvConfig(process.cwd());
const { USERNAME, PASSWORD } = process.env;

// 需求：预定每周日晚上4～8点，任意连续两个小时的舞蹈室或者活动室（大），石塘咀体育馆
// 每周一早上7点放号

test('dancing with crawlee', async () => {
  let loginCompleted = false;
  let bookingCompleted = false;
  let selectedSlots = false;

  const crawler = new PlaywrightCrawler({
    launchContext: {
      launchOptions: {
        headless: false,
        devtools: false,
      },
    },
    preNavigationHooks: [
      async ({ page }) => {
        // Set localStorage before navigation
        await page.addInitScript(() => {
          const dt = new Date().getFullYear() + new Date().getHours();
          localStorage.setItem('devtools', `${dt}`);
          localStorage.setItem('webapplanguage', 'zh-cn');
        });
      },
    ],
    requestHandler: async ({ page, request, enqueueLinks, log }) => {
      log.info(`Processing ${request.url}`);

      const url = request.url;

      // Handle home page
      if (url.includes('/home')) {
        log.info('On home page, waiting until 7am...');
        await waitUntil7am(page);
        
        log.info('Time to login!');
        await login(page);
        loginCompleted = true;

        // Navigate to facilities menu
        await page.locator('.left-menu-continer li:nth-child(2)').click();
        
        const sunday = dayjs().add(7, 'day').format('YYYY-MM-DD');
        const facilitiesUrl = `https://www.smartplay.lcsd.gov.hk/facilities/select/court?venueId=207&fatId=311&venueName=%E7%9F%B3%E5%A1%98%E5%92%80%E4%BD%93%E8%82%B2%E9%A6%86&sessionIndex=0&dateIndex=0&playDate=${sunday}&district=CW,EN,SN,WCH&typeCode=DNRM&keywords=&sportCode=DAAC&frmFilterType=&isFree=false`;
        
        await crawler.addRequests([facilitiesUrl]);
      }

      // Handle facility selection page
      if (url.includes('/facilities/select/court')) {
        log.info('On facility selection page');
        await page.waitForSelector('.facilities-sc-content-all-item', { timeout: 60_000 });
        
        // Uncheck all selected items
        const selectedTags = await page.$$('.session-tag-box-select');
        for (const selected of selectedTags) {
          await selected.click();
        }

        // Find and select two consecutive available slots
        const items = await page.$$('.facilities-sc-content-all-item');
        
        // Target 5pm - 9pm slots (indices 10-13)
        const targetIdx = 10;
        const endIdx = targetIdx + 4;
        
        for (let i = targetIdx; i < endIdx; i++) {
          const item = items[i];
          const nextItem = items[i + 1];

          if (!item || !nextItem) continue;

          const itemText = await item.textContent() || '';
          const canCheck1 = await item.$('.session-tag-box-special-primary');
          const nextItemText = await nextItem.textContent() || '';
          const canCheck2 = await nextItem.$('.session-tag-box-special-primary');

          const canCheck = canCheck1 && canCheck2;
          
          if (itemText.includes('可供租订') && nextItemText.includes('可供租订')) {
            if (!canCheck) {
              continue;
            }

            await item.click();
            await nextItem.click();
            selectedSlots = true;
            log.info(`Selected slots at index ${i} and ${i + 1}`);
            break;
          }
        }

        if (selectedSlots) {
          // Proceed to confirm
          await page.getByRole('button', { name: '继续' }).click();
          
          // Check if login modal appears again
          const loginVisible = await page.getByRole('heading', { name: '登入 SmartPLAY' }).isVisible().catch(() => false);
          if (loginVisible) {
            await page.locator('input[name="pc-login-username"]').fill(USERNAME!);
            await page.locator('input[name="pc-login-password"]').fill(PASSWORD!);
            await page.getByRole('button', { name: '登入' }).click();
            await page.getByRole('button', { name: '继续' }).click();
          }

          // Answer no for booking other instruments
          await page.getByRole('button', { name: '否', exact: true }).click();
          
          // Confirm to payment
          await page.getByRole('button', { name: '继续', exact: true }).click();

          // Handle health declaration
          await page.getByRole('button', { name: '未能提供' }).first().click();
          await page.getByRole('button', { name: '未能提供' }).nth(1).click();
          await page.getByRole('button', { name: '确认并同意' }).click();

          bookingCompleted = true;
          log.info('Booking completed!');
        } else {
          log.warning('No available consecutive slots found');
        }
      }
    },
    maxRequestsPerCrawl: 10,
    maxConcurrency: 1,
  });

  // Helper function to wait until 7am
  async function waitUntil7am(page: any) {
    let now = dayjs();
    const sevenAm = now.hour(7).minute(0).second(0);
    while (!now.isAfter(sevenAm)) {
      await page.waitForTimeout(1_000);
      now = dayjs();
    }
  }

  // Helper function to login
  async function login(page: any) {
    await expect(page.getByRole('heading', { name: '登入 SmartPLAY' })).toBeVisible();
    await page.getByRole('textbox', { name: 'SmartPLAY用户帐号或别名' }).fill(USERNAME!);
    await page.getByRole('textbox', { name: '密码' }).fill(PASSWORD!);
    await page.getByRole('button', { name: '登入' }).click();
  }

  // Start crawling
  await crawler.run(['https://www.smartplay.lcsd.gov.hk/home']);

  // Verify the booking was completed
  expect(loginCompleted).toBe(true);
  expect(bookingCompleted).toBe(true);
});

