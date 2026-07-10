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

// Screenshot after reload
await page.screenshot({ path: '/tmp/bbr-r1-reload.png', fullPage: false });

// Click 中文
await page.locator('text=中文').first().click();
await page.waitForTimeout(500);
console.log('Clicked Chinese');

// Click Story mode
await page.locator('text=Story').first().click();
await page.waitForTimeout(500);
console.log('Clicked Story mode');

// Get current text to see if UI changed
const afterSwitch = await page.evaluate(() => document.body.innerText);
console.log('=== AFTER SWITCH ===');
console.log(afterSwitch.substring(0, 2000));

await browser.close();
