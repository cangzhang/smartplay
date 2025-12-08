import { PlaywrightCrawler, playwrightUtils } from 'crawlee';
import nextEnv from '@next/env';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import TelegramBot from 'node-telegram-bot-api';

dayjs.extend(utc);
dayjs.extend(timezone);

nextEnv.loadEnvConfig(process.cwd());

const { USERNAME, PASSWORD, TG_BOT_TOKEN, TG_CHAT_ID } = process.env;
const bot = new TelegramBot(TG_BOT_TOKEN!, { polling: true });

const isDev = process.env.NODE_ENV !== 'production';

// Helper function to get formatted timestamp
function getTimestamp(): string {
  return dayjs().tz('Asia/Hong_Kong').format('YYYY-MM-DD HH:mm:ss.SSS');
}

const TARGET_IDX = 10; // 5pm - 9pm slots
// const TARGET_IDX = 0;

// 需求：预定每周日晚上4～8点，任意连续两个小时的舞蹈室或者活动室（大），石塘咀体育馆
// 每周一早上7点放号

async function main() {
  console.log(`[${getTimestamp()}] 🚀 Starting SmartPLAY booking crawler...`);

  if (!USERNAME || !PASSWORD) {
    throw new Error('USERNAME and PASSWORD must be set in environment variables');
  }

  // Booking result tracking
  const bookingResult = {
    status: 'pending' as 'success' | 'failed' | 'pending',
    startTime: dayjs(),
    endTime: null as dayjs.Dayjs | null,
    targetDate: '',
    venue: '石塘咀体育馆',
    facilityType: '舞蹈室/活动室',
    selectedSlots: [] as string[],
    slotIndices: [] as number[],
    loginTime: null as dayjs.Dayjs | null,
    error: null as string | null,
  };

  const crawler = new PlaywrightCrawler({
    launchContext: {
      useIncognitoPages: true,
      launchOptions: {
        headless: !isDev,
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
        await playwrightUtils.blockRequests(page, {
          urlPatterns: ['.jpg', '.ttf', '.gif', '.png'],
        });
      },
    ],
    requestHandler: async ({ page, request, log }) => {
      log.info(`[${getTimestamp()}] Processing ${request.url}`);
      const url = request.url;
      let queueNum = null;
      // intercept request to /rest/patron/api/v1/publ/queue
      await page.route('https://www.smartplay.lcsd.gov.hk/rest/patron/api/v1/publ/queue', async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        queueNum = json.data?.queueNum;
        log.info(`[${getTimestamp()}] queueNum: ${queueNum}`);
        route.fulfill({
          status: response.status(),
          body: JSON.stringify(json),
        });
      });

      // Handle home page
      if (url.includes('/home')) {
        log.info(`[${getTimestamp()}] Not on facility selection page, waiting until 7am...`);
        await waitUntil7am(page, log);

        log.info(`[${getTimestamp()}] Time to login!`);
        await login(page, log);
        // wait until queueNum is not null
        let retryCount = 0;
        while (!queueNum) {
          if (retryCount > 100) {
            await login(page, log);
            retryCount = 0;
            continue;
          }

          await page.waitForTimeout(1000);
          retryCount++;
          log.info(`[${getTimestamp()}] Waiting for queueNum...`);
        }
        log.info(`[${getTimestamp()}] Queue num found: ${queueNum}`);
        // await page.waitForTimeout(5 * 1000);

        // perform request https://www.smartplay.lcsd.gov.hk/rest/patron/api/v1/publ/queue/${queueNum}
        const queueResponse = await page.request.get(
          `https://www.smartplay.lcsd.gov.hk/rest/patron/api/v1/publ/queue/${queueNum}`,
          {
            headers: {
              'User-Agent': await page.evaluate(() => navigator.userAgent),
              'Accept': 'application/json',
              'Referer': page.url(),
              'channel': 'INTERNET',
            }
          }
        );
        const queueJson = await queueResponse.json();
        log.info(`[${getTimestamp()}] Queue response: ${JSON.stringify(queueJson)}`);

        // let waitingRoomUrl = `https://www.smartplay.lcsd.gov.hk/waiting-room?loginNum=${queueNum}&authType=INDIVIDUAL`;
        // log.info(`[${getTimestamp()}] Navigating to waiting room: ${waitingRoomUrl}`);
        // await page.goto(waitingRoomUrl);
        // if there was a modal. click on cancel button


        // try waiting for url change to https://www.smartplay.lcsd.gov.hk/waiting-room*, the url must contain /waiting-room*
        // if timeout, continue
        // try {
        //   await page.waitForURL((url) => url.pathname.includes('/waiting-room'), { timeout: 60 * 1000 });
        //   log.info(`[${getTimestamp()}] Waiting room found, continuing...`);
        // } catch (error) {
        //   log.info(`[${getTimestamp()}] Waiting room not found, continuing...`);
        // }

        let shouldWait = true;
        if (!queueJson?.data) {
          shouldWait = false;
        }
        if (shouldWait) {
          // if page contains '虚拟等候室'
          const virtualWaitingRoom = await page.getByText('虚拟等候室').isVisible();
          if (virtualWaitingRoom) {
            log.info(`[${getTimestamp()}] Virtual waiting room found, waiting...`);
            // wait until the page contains '虚拟等候室' is not visible
            await page.waitForSelector('text=虚拟等候室', { state: 'hidden', timeout: 60 * 60 * 1000 });
            log.info(`[${getTimestamp()}] Virtual waiting room disappeared, continuing...`);
          }
        }

        // Navigate to facilities menu
        log.info(`[${getTimestamp()}] Navigating to facilities...`);
        await page.locator('.left-menu-continer li:nth-child(2)').click();
        await page.waitForTimeout(2000);

        const sunday = dayjs().add(6, 'day').format('YYYY-MM-DD');
        bookingResult.targetDate = sunday;
        log.info(`[${getTimestamp()}] Target date: ${sunday}`);

        const facilitiesUrl = `https://www.smartplay.lcsd.gov.hk/facilities/select/court?venueId=207&fatId=311&venueName=%E7%9F%B3%E5%A1%98%E5%92%80%E4%BD%93%E8%82%B2%E9%A6%86&sessionIndex=0&dateIndex=0&playDate=${sunday}&district=CW,EN,SN,WCH&typeCode=DNRM&keywords=&sportCode=DAAC&frmFilterType=&isFree=false`;

        await crawler.addRequests([{ url: facilitiesUrl, userData: { step: 'facilities' } }]);
      }

      // Handle facility selection page
      if (url.includes('/facilities/select/court')) {
        log.info(`[${getTimestamp()}] On facility selection page`);

        try {
          await page.waitForSelector('.facilities-sc-content-all-item', { timeout: 60_000 });
          log.info(`[${getTimestamp()}] Facility items loaded`);

          // Uncheck all selected items
          const selectedTags = await page.$$('.session-tag-box-select');
          log.info(`[${getTimestamp()}] Found ${selectedTags.length} pre-selected tags, unchecking...`);
          for (const selected of selectedTags) {
            await selected.click();
            await page.waitForTimeout(100);
          }

          // Find and select two consecutive available slots
          const items = await page.$$('.facilities-sc-content-all-item');
          log.info(`[${getTimestamp()}] Found ${items.length} time slots`);

          // Target 5pm - 9pm slots (indices 10-13)
          const endIdx = Math.min(TARGET_IDX + 4, items.length - 1);

          let selectedSlots = false;
          for (let i = TARGET_IDX; i < endIdx; i++) {
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
                log.info(`[${getTimestamp()}] Slots at ${i} and ${i + 1} are available but not checkable`);
                continue;
              }

              log.info(`[${getTimestamp()}] Selecting slots at index ${i} and ${i + 1}`);

              // Get time slot information
              const slot1Text = await item.textContent() || '';
              const slot2Text = await nextItem.textContent() || '';
              bookingResult.slotIndices = [i, i + 1];
              bookingResult.selectedSlots = [
                (slot1Text || '').trim().split('\n')[0] || '',
                (slot2Text || '').trim().split('\n')[0] || ''
              ];

              await item.click();
              await page.waitForTimeout(200);
              await nextItem.click();
              await page.waitForTimeout(200);
              selectedSlots = true;
              log.info(`[${getTimestamp()}] ✅ Successfully selected slots`);
              break;
            }
          }

          if (selectedSlots) {
            // Proceed to confirm
            log.info(`[${getTimestamp()}] Clicking continue button...`);
            await page.getByRole('button', { name: '继续' }).click();
            await page.waitForTimeout(2000);
            // Answer no for booking other instruments
            log.info(`[${getTimestamp()}] Answering questions...`);
            await page.getByRole('button', { name: '否', exact: true }).click();
            await page.waitForTimeout(1000);

            // Confirm to payment
            log.info(`[${getTimestamp()}] Proceeding to payment...`);
            await page.getByRole('button', { name: '继续', exact: true }).click();
            await page.waitForTimeout(2000);

            // Handle health declaration
            log.info(`[${getTimestamp()}] Completing health declaration...`);
            await page.getByRole('button', { name: '未能提供' }).first().click();
            await page.waitForTimeout(500);
            await page.getByRole('button', { name: '未能提供' }).nth(1).click();
            await page.waitForTimeout(500);
            await page.getByRole('button', { name: '确认并同意' }).click();

            bookingResult.status = 'success';
            bookingResult.endTime = dayjs();
            log.info(`[${getTimestamp()}] ✅ Booking completed successfully!`);
          } else {
            bookingResult.status = 'failed';
            bookingResult.endTime = dayjs();
            bookingResult.error = 'No available consecutive slots found';
            log.error(`[${getTimestamp()}] ❌ No available consecutive slots found`);
          }
        } catch (error) {
          bookingResult.status = 'failed';
          bookingResult.endTime = dayjs();
          bookingResult.error = String(error);
          log.error(`[${getTimestamp()}] Error during booking process: ${error}`);
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
    const HK_TIMEZONE = 'Asia/Hong_Kong'; // UTC+8
    let now = dayjs().tz(HK_TIMEZONE);
    const sevenAm = now.hour(7).minute(0).second(0).millisecond(0);

    if (now.isAfter(sevenAm)) {
      log.info(`[${getTimestamp()}] Already past 7am HKT, proceeding immediately`);
      return;
    }

    const waitTime = sevenAm.diff(now, 'milliseconds');
    log.info(`[${getTimestamp()}] Waiting until 7am HKT (${Math.round(waitTime / 1000 / 60)} minutes)...`);

    while (!now.isAfter(sevenAm)) {
      await page.waitForTimeout(1_000);
      now = dayjs().tz(HK_TIMEZONE);

      // Log progress every minute
      if (now.second() === 0) {
        const remaining = sevenAm.diff(now, 'minutes');
        log.info(`[${getTimestamp()}] ${remaining} minutes until 7am HKT...`);
      }
    }

    log.info(`[${getTimestamp()}] It's 7am HKT! Starting booking process...`);
  }

  // Helper function to login
  async function login(page: any, log: any) {
    // await page.reload();
    log.info(`[${getTimestamp()}] Waiting for login form...`);
    // Wait for the login heading to be visible
    await page.waitForSelector('text=登入 SmartPLAY', { timeout: 30_000 });

    // clear all input fields
    await page.getByRole('textbox', { name: 'SmartPLAY用户帐号或别名' }).clear();
    await page.getByRole('textbox', { name: '密码' }).clear();

    log.info(`[${getTimestamp()}] Filling credentials...`);
    await page.getByRole('textbox', { name: 'SmartPLAY用户帐号或别名' }).fill(USERNAME!);
    await page.getByRole('textbox', { name: '密码' }).fill(PASSWORD!);

    log.info(`[${getTimestamp()}] Clicking login button...`);
    await page.getByRole('button', { name: '登入' }).click();

    // await page.waitForTimeout(3000);
    bookingResult.loginTime = dayjs();
    log.info(`[${getTimestamp()}] ✅ Login successful`);
  }

  // Start crawling
  await crawler.run(['https://www.smartplay.lcsd.gov.hk/home']);

  // Print beautiful summary
  await printBookingSummary(bookingResult);
}

async function printBookingSummary(result: any) {
  const duration = result.endTime
    ? result.endTime.diff(result.startTime, 'second')
    : dayjs().diff(result.startTime, 'second');

  const durationFormatted = duration >= 60
    ? `${Math.floor(duration / 60)}分${duration % 60}秒`
    : `${duration}秒`;

  const lines: string[] = [];

  lines.push('='.repeat(20));
  lines.push('🎯 SmartPLAY 预订结果摘要');
  lines.push('='.repeat(20));
  lines.push('');

  if (result.status === 'success') {
    lines.push('📊 状态: ✅ 预订成功');
  } else {
    lines.push('📊 状态: ❌ 预订失败');
  }

  lines.push(`🏢 场馆: ${result.venue}`);
  lines.push(`🏃 设施类型: ${result.facilityType}`);
  lines.push(`📅 目标日期: ${result.targetDate || 'N/A'}`);

  if (result.selectedSlots.length > 0) {
    lines.push(`⏰ 已选时间段:`);
    result.selectedSlots.forEach((slot: string, index: number) => {
      lines.push(`   ${index + 1}. ${slot} (索引 ${result.slotIndices[index]})`);
    });
  } else {
    lines.push(`⏰ 已选时间段: 无`);
  }

  lines.push(`👤 用户: ${USERNAME}`);
  lines.push(`🔐 登录时间: ${result.loginTime ? result.loginTime.format('HH:mm:ss') : 'N/A'}`);
  lines.push(`⏱️  开始时间: ${result.startTime.format('YYYY-MM-DD HH:mm:ss')}`);
  lines.push(`⏱️  结束时间: ${result.endTime ? result.endTime.format('YYYY-MM-DD HH:mm:ss') : 'N/A'}`);
  lines.push(`⌛ 总耗时: ${durationFormatted}`);

  if (result.error) {
    lines.push(`⚠️  错误信息: ${result.error}`);
  }

  if (result.status === 'success') {
    lines.push('='.repeat(20));
    lines.push('🎉 恭喜！预订成功完成！');
  }
  lines.push('='.repeat(20));

  const summary = lines.join('\n');

  // Print to console
  console.log(`[${getTimestamp()}]\n` + summary + '\n');

  // Send to Telegram
  await bot.sendMessage(TG_CHAT_ID!, summary);
}

(async function () {
  try {
    await main();
    exit(0);
  } catch (error) {
    console.error(`[${getTimestamp()}] Fatal error:`, error);
    exit(1);
  }
})()

function exit(code: number) {
  process.exit(code);
}
