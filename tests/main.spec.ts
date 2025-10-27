import { expect, test } from '@playwright/test';
import nextEnv from '@next/env';
import dayjs from 'dayjs';

nextEnv.loadEnvConfig(process.cwd());
const { USERNAME, PASSWORD } = process.env;

// 需求：预定每周日晚上4～8点，任意连续两个小时的舞蹈室或者活动室（大），石塘咀体育馆
// 每周一早上7点放号

test('dancing', async ({ page }) => {
  // await page.setViewportSize({ width: 1600, height:  });
  await page.addInitScript(() => {
    const dt = new Date().getFullYear() + new Date().getHours();
    localStorage.setItem('devtools', `${dt}`);
    localStorage.setItem('webapplanguage', 'zh-cn');
  });
  // dont wait until network is idle, just wait until domcontentloaded
  await page.goto('https://www.smartplay.lcsd.gov.hk/home', { waitUntil: 'commit' });

  async function login() {
    await expect(page.getByRole('heading', { name: '登入 SmartPLAY' })).toBeVisible();
    await page.getByRole('textbox', { name: 'SmartPLAY用户帐号或别名' }).fill(USERNAME!);
    await page.getByRole('textbox', { name: '密码' }).fill(PASSWORD!);
    await page.getByRole('button', { name: '登入' }).click();
  }

  // wait until 7am
  async function waitUntil7am() {
    let now = dayjs();
    const sevenAm = now.hour(7).minute(0).second(0);
    while (!now.isAfter(sevenAm)) {
      await page.waitForTimeout(1_000);
      now = dayjs();
    }
  }

  await waitUntil7am();
  await login();

  await page.locator('.left-menu-continer li:nth-child(2)').click();
  // const sunday = dayjs().day(0).add(7, 'day').format('YYYY-MM-DD');
  const sunday = dayjs().add(7, 'day').format('YYYY-MM-DD');

  // 维多利亚公园 网球
  // https://www.smartplay.lcsd.gov.hk/facilities/select/court?venueId=70001436&fatId=333&venueName=%E9%A6%99%E6%B8%AF%E7%BD%91%E7%90%83%E4%B8%AD%E5%BF%83&sessionIndex=0&dateIndex=0&playDate=2025-11-02&district=CW,EN,SN,WCH&typeCode=TENC&sportCode=BAGM&frmFilterType=&isFree=false
  // fatId = 510, 332
  // const url = `https://www.smartplay.lcsd.gov.hk/facilities/select/court?venueId=70001436&fatId=332&sessionIndex=4&dateIndex=0&playDate=${sunday}&district=CW,EN,SN,WCH&typeCode=TENC&sportCode=BAGM&frmFilterType=&isFree=false`;

  await page.goto(`https://www.smartplay.lcsd.gov.hk/facilities/select/court?venueId=207&fatId=311&venueName=%E7%9F%B3%E5%A1%98%E5%92%80%E4%BD%93%E8%82%B2%E9%A6%86&sessionIndex=0&dateIndex=0&playDate=${sunday}&district=CW,EN,SN,WCH&typeCode=DNRM&keywords=&sportCode=DAAC&frmFilterType=&isFree=false`, {
    waitUntil: 'domcontentloaded'
  });
  await expect(page.getByText('上午段节')).toBeVisible({ timeout: 60_000 });

  // uncheck all selected, classname 'session-tag-box-select'
  const selectedTags = await page.$$('.session-tag-box-select');
  for (const selected of selectedTags) {
    await selected.click();
  }

  // find divs with .facilities-sc-content-all-item, from 10th to 13rd 
  // if any two consecutive items, which contains text '可供租订', select them 
  const items = await page.$$('.facilities-sc-content-all-item');
  let selected = false;

  const targetIdx = 10;
  const endIdx = targetIdx + 4;
  // const targetIdx = 0;
  // const endIdx = items.length - 1;
  for (let i = targetIdx; i < endIdx; i++) {
    const item = items[i];
    const nextItem = items[i + 1];

    const itemText = await item?.textContent() || '';
    const canCheck1 = await item?.$('.session-tag-box-special-primary');
    const nextItemText = await nextItem?.textContent() || '';
    const canCheck2 = await nextItem?.$('.session-tag-box-special-primary');

    const canCheck = canCheck1 && canCheck2;
    // can check when item children div with class 'session-tag-box-special-primary' exists
    if (itemText.includes('可供租订') && nextItemText.includes('可供租订')) {
      if (!canCheck) {
        continue;
      }

      await item?.click();
      await nextItem?.click();
      if (item && nextItem) {
        selected = true;
      }
      break;
    }
  }
  console.log('selected', selected);
  // proceed to confirm
  await page.getByRole('button', { name: '继续' }).click();

  const loginVisible = await page.getByRole('heading', { name: '登入 SmartPLAY' }).isVisible();
  if (loginVisible) {
    await page.locator('input[name="pc-login-username"]').fill(USERNAME!);
    await page.locator('input[name="pc-login-password"]').fill(PASSWORD!);
    await page.getByRole('button', { name: '登入' }).click();
    // proceed to confirm again
    await page.getByRole('button', { name: '继续' }).click();
  }

  // no for booking other instruments
  await page.getByRole('button', { name: '否', exact: true }).click();
  // confirm to payment
  await page.getByRole('button', { name: '继续', exact: true }).click();

  await page.getByRole('button', { name: '未能提供' }).first().click();
  await page.getByRole('button', { name: '未能提供' }).nth(1).click();
  await page.getByRole('button', { name: '确认并同意' }).click();

  const tokenHeader = await page.evaluate(() => localStorage.getItem('webappaccessToken'));
  // console.log('tokenHeader', tokenHeader);
});
