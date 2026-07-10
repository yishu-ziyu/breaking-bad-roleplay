import { chromium } from 'playwright';
import fs from 'fs';

const browser = await chromium.launch();
const page = await browser.newPage();

// Step 1: Screenshot landing
await page.goto('http://localhost:5173');
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/bbr-r1-cq-1.png', fullPage: true });
console.log('Screenshot 1 saved');

// Step 2: Inject localStorage
await page.evaluate(() => {
  localStorage.setItem('abq_enteredWorld', 'true');
  localStorage.setItem('abq_sessionId', 'play-r1-cq');
});

// Step 3: Reload, wait 1s
await page.reload();
await page.waitForTimeout(1500);
console.log('Reloaded with localStorage');

// Step 4: Click Jesse Pinkman
const jesseBtn = page.locator('button.char-card:has-text("Jesse")').first();
await jesseBtn.click();
console.log('Clicked Jesse');
await page.waitForTimeout(500);

// Switch to Chinese
const zhBtn = page.locator('button:has-text("中文")').first();
await zhBtn.click();
console.log('Switched to Chinese');
await page.waitForTimeout(500);

// Switch to Story mode
const storyBtn = page.locator('button:has-text("剧情任务")').first();
const storyCount = await storyBtn.count();
if (storyCount > 0) {
  await storyBtn.click();
  console.log('Switched to Story mode');
  await page.waitForTimeout(800);
}

await page.screenshot({ path: '/tmp/bbr-r1-cq-select2.png', fullPage: true });

// Step 5: Fill the mission brief textarea
// Find the textarea in the modal
const textarea = page.locator('textarea').first();
const textareaCount = await textarea.count();
console.log('Textarea count:', textareaCount);

if (textareaCount > 0) {
  await textarea.click();
  await page.waitForTimeout(200);

  // Clear and type
  await textarea.fill('');
  await page.keyboard.type('Jesse 想要退出制毒生意，但 Walter 不同意', { delay: 30 });
  console.log('Brief filled');
  await page.waitForTimeout(500);

  // Get the value
  const val = await textarea.inputValue();
  console.log('Textarea value:', val);
} else {
  console.log('No textarea found');
}

await page.screenshot({ path: '/tmp/bbr-r1-cq-filled.png', fullPage: true });

// Step 6: Click "开始任务"
const startBtn = page.locator('button:has-text("开始任务")').first();
const startCount = await startBtn.count();
console.log('Start button count:', startCount);

if (startCount > 0) {
  await startBtn.click();
  console.log('Clicked 开始任务');
} else {
  console.log('Could not find 开始任务 button');
}

// Wait 20s for full beat
console.log('Waiting 20s for story generation...');
await page.waitForTimeout(20000);

// Screenshot result
await page.screenshot({ path: '/tmp/bbr-r1-cq-2.png', fullPage: true });

// Read ALL generated content
const finalHTML = await page.innerHTML('body');
const finalText = await page.textContent('body');

fs.writeFileSync('/tmp/bbr-r1-cq-final.html', finalHTML);
fs.writeFileSync('/tmp/bbr-r1-cq-final.txt', finalText);

console.log('Final text length:', finalText.length);
console.log('=== CONTENT PREVIEW (first 4000 chars) ===');
console.log(finalText.substring(0, 4000));

await browser.close();
