import { PlaywrightCrawler } from 'crawlee';
import nextEnv from '@next/env';
import dayjs from 'dayjs';

nextEnv.loadEnvConfig(process.cwd());
const { USERNAME, PASSWORD } = process.env;

// 需求：预定每周日晚上4～8点，任意连续两个小时的舞蹈室或者活动室（大），石塘咀体育馆
// 每周一早上7点放号

async function main() {
  console.log('Starting SmartPLAY booking crawler...');
  
  if (!USERNAME || !PASSWORD) {
    throw new Error('USERNAME and PASSWORD must be set in environment variables');
  }

  const crawler = new PlaywrightCrawler({
    launchContext: {
      launchOptions: {
        headless: false, // Set to true for production
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
    requestHandler: async ({ page, request, log }) => {
      log.info(`Processing ${request.url}`);

      const url = request.url;

      // Handle home page
      if (url.includes('/home')) {
        log.info('On home page, waiting until 7am...');
        await waitUntil7am(page, log);
        
        log.info('Time to login!');
        await login(page, log);

        // Navigate to facilities menu
        log.info('Navigating to facilities...');
        await page.locator('.left-menu-continer li:nth-child(2)').click();
        await page.waitForTimeout(2000);
        
        const sunday = dayjs().add(7, 'day').format('YYYY-MM-DD');
        log.info(`Target date: ${sunday}`);
        
        const facilitiesUrl = `https://www.smartplay.lcsd.gov.hk/facilities/select/court?venueId=207&fatId=311&venueName=%E7%9F%B3%E5%A1%98%E5%92%80%E4%BD%93%E8%82%B2%E9%A6%86&sessionIndex=0&dateIndex=0&playDate=${sunday}&district=CW,EN,SN,WCH&typeCode=DNRM&keywords=&sportCode=DAAC&frmFilterType=&isFree=false`;
        
        await crawler.addRequests([{ url: facilitiesUrl, userData: { step: 'facilities' } }]);
      }

      // Handle facility selection page
      if (url.includes('/facilities/select/court')) {
        log.info('On facility selection page');
        
        try {
          await page.waitForSelector('.facilities-sc-content-all-item', { timeout: 60_000 });
          log.info('Facility items loaded');
          
          // Uncheck all selected items
          const selectedTags = await page.$$('.session-tag-box-select');
          log.info(`Found ${selectedTags.length} pre-selected tags, unchecking...`);
          for (const selected of selectedTags) {
            await selected.click();
            await page.waitForTimeout(100);
          }

          // Find and select two consecutive available slots
          const items = await page.$$('.facilities-sc-content-all-item');
          log.info(`Found ${items.length} time slots`);
          
          // Target 5pm - 9pm slots (indices 10-13)
          const targetIdx = 10;
          const endIdx = Math.min(targetIdx + 4, items.length - 1);
          
          let selectedSlots = false;
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
                log.info(`Slots at ${i} and ${i + 1} are available but not checkable`);
                continue;
              }

              log.info(`Selecting slots at index ${i} and ${i + 1}`);
              await item.click();
              await page.waitForTimeout(200);
              await nextItem.click();
              await page.waitForTimeout(200);
              selectedSlots = true;
              log.info(`✓ Successfully selected slots`);
              break;
            }
          }

          if (selectedSlots) {
            // Proceed to confirm
            log.info('Clicking continue button...');
            await page.getByRole('button', { name: '继续' }).click();
            await page.waitForTimeout(2000);
            
            // Check if login modal appears again
            const loginVisible = await page.getByRole('heading', { name: '登入 SmartPLAY' }).isVisible().catch(() => false);
            if (loginVisible) {
              log.info('Login modal appeared again, logging in...');
              await page.locator('input[name="pc-login-username"]').fill(USERNAME!);
              await page.locator('input[name="pc-login-password"]').fill(PASSWORD!);
              await page.getByRole('button', { name: '登入' }).click();
              await page.waitForTimeout(2000);
              await page.getByRole('button', { name: '继续' }).click();
              await page.waitForTimeout(2000);
            }

            // Answer no for booking other instruments
            log.info('Answering questions...');
            await page.getByRole('button', { name: '否', exact: true }).click();
            await page.waitForTimeout(1000);
            
            // Confirm to payment
            log.info('Proceeding to payment...');
            await page.getByRole('button', { name: '继续', exact: true }).click();
            await page.waitForTimeout(2000);

            // Handle health declaration
            log.info('Completing health declaration...');
            await page.getByRole('button', { name: '未能提供' }).first().click();
            await page.waitForTimeout(500);
            await page.getByRole('button', { name: '未能提供' }).nth(1).click();
            await page.waitForTimeout(500);
            await page.getByRole('button', { name: '确认并同意' }).click();

            log.info('✓ Booking completed successfully!');
          } else {
            log.error('✗ No available consecutive slots found');
          }
        } catch (error) {
          log.error(`Error during booking process: ${error}`);
          throw error;
        }
      }
    },
    maxRequestsPerCrawl: 10,
    maxConcurrency: 1,
    requestHandlerTimeoutSecs: 7200, // 2 hours timeout
  });

  // Helper function to wait until 7am
  async function waitUntil7am(page: any, log: any) {
    let now = dayjs();
    const sevenAm = now.hour(7).minute(0).second(0);
    
    if (now.isAfter(sevenAm)) {
      log.info('Already past 7am, proceeding immediately');
      return;
    }
    
    const waitTime = sevenAm.diff(now, 'milliseconds');
    log.info(`Waiting until 7am (${Math.round(waitTime / 1000 / 60)} minutes)...`);
    
    while (!now.isAfter(sevenAm)) {
      await page.waitForTimeout(1_000);
      now = dayjs();
      
      // Log progress every minute
      if (now.second() === 0) {
        const remaining = sevenAm.diff(now, 'minutes');
        log.info(`${remaining} minutes until 7am...`);
      }
    }
    
    log.info('It\'s 7am! Starting booking process...');
  }

  // Helper function to login
  async function login(page: any, log: any) {
    log.info('Waiting for login form...');
    // Wait for the login heading to be visible
    await page.waitForSelector('text=登入 SmartPLAY', { timeout: 30_000 });
    
    log.info('Filling credentials...');
    await page.getByRole('textbox', { name: 'SmartPLAY用户帐号或别名' }).fill(USERNAME!);
    await page.getByRole('textbox', { name: '密码' }).fill(PASSWORD!);
    
    log.info('Clicking login button...');
    await page.getByRole('button', { name: '登入' }).click();
    
    await page.waitForTimeout(3000);
    log.info('✓ Login successful');
  }

  // Start crawling
  await crawler.run(['https://www.smartplay.lcsd.gov.hk/home']);
  
  console.log('Crawler finished!');
}

// Run the main function
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

