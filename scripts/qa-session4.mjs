import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.evaluate(() => {
  localStorage.setItem('abq_enteredWorld', 'true');
  localStorage.setItem('abq_sessionId', 'play-r1-1');
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// Switch to Chinese
await page.locator('text=中文').first().click();
await page.waitForTimeout(600);

// Click Story mode (剧情任务)
await page.locator('text=剧情任务').first().click();
await page.waitForTimeout(600);

const afterStory = await page.evaluate(() => document.body.innerText);
console.log('=== AFTER STORY MODE ===');
console.log(afterStory.substring(0, 3000));

// Screenshot
await page.screenshot({ path: '/tmp/bbr-r1-story-mode.png', fullPage: false });

await browser.close();
