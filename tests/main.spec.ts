import { expect, test } from '@playwright/test';
import nextEnv from '@next/env';
import dayjs from 'dayjs';

nextEnv.loadEnvConfig(process.cwd());
const { USERNAME, PASSWORD } = process.env;

// 需求：预定每周日晚上4～8点，任意连续两个小时的舞蹈室或者活动室（大），石塘咀体育馆
// 每周一早上7点放号

test('main', async ({ page }) => {
  // await page.setViewportSize({ width: 1600, height:  });
  await page.addInitScript(() => {
    const dt = new Date().getFullYear() + new Date().getHours();
    localStorage.setItem('devtools', `${dt}`);
    localStorage.setItem('webapplanguage', 'zh-cn');
  });
  // dont wait until network is idle, just wait until domcontentloaded
  await page.goto('https://www.smartplay.lcsd.gov.hk/home', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: '登入 SmartPLAY' })).toBeVisible();
  await page.getByRole('textbox', { name: 'SmartPLAY用户帐号或别名' }).fill(USERNAME!);
  await page.getByRole('textbox', { name: '密码' }).fill(PASSWORD!);
  await page.getByRole('button', { name: '登入' }).click();

  await page.locator('.left-menu-continer li:nth-child(2)').click();
  const sunday = dayjs().day(0).add(7, 'day').format('YYYY-MM-DD');

  // await page.goto('https://www.smartplay.lcsd.gov.hk/facilities/search-result?keywords=&district=CW,EN,SN,WCH&startDate=&typeCode=DNRM&venueCode=&sportCode=DAAC&typeName=%E8%88%9E%E8%B9%88&frmFilterType=&venueSportCode=&isFree=false');
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
  for (let i = 9; i < 13; i++) {
    const item = items[i];
    const nextItem = items[i + 1];
    const itemText = await item?.textContent() || '';
    const nextItemText = await nextItem?.textContent() || '';
    if (itemText.includes('可供租订') && nextItemText.includes('可供租订')) {
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
  // no for booking other instruments
  await page.getByRole('button', { name: '否', exact: true }).click();
  // confirm to payment
  await page.getByRole('button', { name: '继续', exact: true }).click();

  const tokenHeader = await page.evaluate(() => localStorage.getItem('webappaccessToken'));
  // console.log('tokenHeader', tokenHeader);
});
