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

// After switching to Chinese, check the page
await page.locator('text=中文').first().click();
await page.waitForTimeout(800);

const afterChinese = await page.evaluate(() => document.body.innerText);
console.log('=== AFTER CHINESE SWITCH ===');
console.log(afterChinese.substring(0, 2000));

// Look for story-related buttons
const storyElements = await page.evaluate(() => {
  const allText = document.body.innerText;
  const hasStory = allText.includes('故事');
  const hasModeLabel = allText.includes('模式') || allText.includes('Mode');
  return { hasStory, hasModeLabel };
});
console.log('Story elements:', storyElements);

// Get all button text
const buttons = await page.evaluate(() => {
  const buttons = [];
  document.querySelectorAll('button, [role="button"], .btn, .mode-btn').forEach(b => {
    buttons.push(b.textContent.trim().substring(0, 50));
  });
  return buttons.filter(b => b.length > 0).slice(0, 20);
});
console.log('=== BUTTONS ===');
console.log(buttons.join('\n'));

await browser.close();
