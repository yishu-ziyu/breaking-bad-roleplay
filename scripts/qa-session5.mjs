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

// Click Story mode
await page.locator('text=剧情任务').first().click();
await page.waitForTimeout(600);

// Screenshot after story mode selection
await page.screenshot({ path: '/tmp/bbr-r1-3.png', fullPage: false });

// Fill the story prompt
const textarea = await page.locator('textarea').first();
if (await textarea.count() > 0) {
  await textarea.fill('Walter 和 Jesse 在沙漠里制毒');
  console.log('Filled prompt');
} else {
  // Try contenteditable
  const editable = await page.locator('[contenteditable="true"]').first();
  if (await editable.count() > 0) {
    await editable.fill('Walter 和 Jesse 在沙漠里制毒');
    console.log('Filled editable');
  }
}

// Get the HTML around the input area
const inputArea = await page.evaluate(() => {
  const textareas = document.querySelectorAll('textarea');
  const inputs = document.querySelectorAll('input[type="text"]');
  const editables = document.querySelectorAll('[contenteditable="true"]');
  const divs = document.querySelectorAll('div');
  const inputDivs = [];
  divs.forEach(d => {
    if (d.innerText.includes('任务简报') || d.innerText.includes('开始任务')) {
      inputDivs.push(d.innerHTML.substring(0, 500));
    }
  });
  return {
    textareaCount: textareas.length,
    inputCount: inputs.length,
    editableCount: editables.length,
    inputDivs: inputDivs.slice(0, 3)
  };
});
console.log('=== INPUT AREA INFO ===');
console.log(JSON.stringify(inputArea, null, 2));

await browser.close();
