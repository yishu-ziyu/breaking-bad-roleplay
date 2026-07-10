import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// Use addInitScript to set localStorage before React mounts
await page.addInitScript(() => {
  localStorage.setItem('abq_enteredWorld', 'true');
  localStorage.setItem('abq_sessionId', 'play-r1-1');
});

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// Check what we see
const info = await page.evaluate(() => {
  const landing = document.querySelector('.landing-screen');
  const appShell = document.querySelector('.app-shell');
  const sidebar = document.querySelector('.sidebar');
  const text = document.body.innerText.substring(0, 300);
  return {
    hasLanding: !!landing,
    hasAppShell: !!appShell,
    hasSidebar: !!sidebar,
    textSnippet: text
  };
});
console.log('Page info:', JSON.stringify(info, null, 2));

if (info.hasAppShell) {
  // Screenshot main UI
  await page.screenshot({ path: '/tmp/bbr-r1-main-ui.png', fullPage: false });
  
  // Switch to Chinese
  await page.locator('text=中文').first().click();
  await page.waitForTimeout(600);
  
  // Switch to Story mode
  await page.locator('text=剧情任务').first().click();
  await page.waitForTimeout(600);
  
  await page.screenshot({ path: '/tmp/bbr-r1-story-setup.png', fullPage: false });
  
  // Fill story prompt
  const textarea = await page.locator('textarea').first();
  if (await textarea.count() > 0) {
    await textarea.fill('Walter 和 Jesse 在沙漠里制毒');
  }
  
  await page.screenshot({ path: '/tmp/bbr-r1-prompt-filled.png', fullPage: false });
  
  // Click Start
  await page.locator('text=开始任务').first().click();
  await page.waitForTimeout(15000);
  
  await page.screenshot({ path: '/tmp/bbr-r1-streaming.png', fullPage: false });
  
  const streamInfo = await page.evaluate(() => document.body.innerText.substring(0, 800));
  console.log('=== Streaming text ===');
  console.log(streamInfo);
} else if (info.hasLanding) {
  // We're on the landing page - click "Enter the World"
  const enterBtn = await page.locator('text=进入世界, text=ENTER THE WORLD, button.landing-screen__enter').first();
  await enterBtn.click();
  await page.waitForTimeout(1000);
  
  const afterEnter = await page.evaluate(() => document.body.innerText.substring(0, 300));
  console.log('After entering world:', afterEnter);
  await page.screenshot({ path: '/tmp/bbr-r1-after-enter.png', fullPage: false });
}

await browser.close();
console.log('Done');
