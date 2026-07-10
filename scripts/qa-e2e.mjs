import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// Setup: landing page
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });

// Click "Enter as Guest" to skip auth (since abq_enteredWorld=true might still show auth)
const guestBtn = page.locator('text=Enter as Guest');
if (await guestBtn.count() > 0) {
  await guestBtn.click();
  await page.waitForTimeout(500);
  console.log('Clicked Enter as Guest');
}

// Now we should be in the main app
const pageText = await page.evaluate(() => document.body.innerText);
console.log('=== After entering world ===');
console.log(pageText.substring(0, 500));

// Screenshot initial main UI
await page.screenshot({ path: '/tmp/bbr-r1-3-initial-main.png', fullPage: false });

// Switch to Chinese
await page.locator('text=中文').first().click();
await page.waitForTimeout(600);
console.log('Switched to Chinese');

// Switch to Story mode (剧情任务)
await page.locator('text=剧情任务').first().click();
await page.waitForTimeout(600);
console.log('Switched to Story mode');

// Screenshot story setup screen
await page.screenshot({ path: '/tmp/bbr-r1-4-story-setup.png', fullPage: false });

// Fill the story prompt
const textarea = await page.locator('textarea').first();
if (await textarea.count() > 0) {
  await textarea.fill('Walter 和 Jesse 在沙漠里制毒');
  console.log('Filled prompt textarea');
}

// Screenshot with filled prompt
await page.screenshot({ path: '/tmp/bbr-r1-5-prompt-filled.png', fullPage: false });

// Click "开始任务"
await page.locator('text=开始任务').first().click();
console.log('Clicked Start Story');

// Screenshot during connecting state
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/bbr-r1-6-connecting.png', fullPage: false });

// Wait for streaming to begin
await page.waitForTimeout(8000);
console.log('Waited 8s total, checking state...');

const currentState = await page.evaluate(() => {
  const text = document.body.innerText;
  const hasStreaming = text.includes('播放中') || text.includes('Streaming');
  const hasContent = text.includes('Walter') || text.includes('Jesse') || text.includes('任务现场');
  return {
    textSnippet: text.substring(0, 800),
    hasStreaming,
    hasContent,
    connectionText: text.includes('Streaming') || text.includes('连接现场') || text.includes('现场已连接')
  };
});
console.log('Current state:', JSON.stringify(currentState, null, 2));

// Screenshot after streaming
await page.screenshot({ path: '/tmp/bbr-r1-7-streaming.png', fullPage: false });

await browser.close();
console.log('Done');
