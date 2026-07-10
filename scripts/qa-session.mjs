import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// Step 1: initial screenshot (already taken by CLI, but let's do it here too)
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.screenshot({ path: '/tmp/bbr-r1-1.png' });
console.log('Screenshot 1 done');

// Step 2: inject localStorage
await page.evaluate(() => {
  localStorage.setItem('abq_enteredWorld', 'true');
  localStorage.setItem('abq_sessionId', 'play-r1-1');
});
console.log('localStorage injected');

// Step 3: reload and wait
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/bbr-r1-reload.png' });

// Get page text to understand UI
const bodyText = await page.evaluate(() => document.body.innerText);
console.log('=== PAGE TEXT ===');
console.log(bodyText.substring(0, 3000));

// Get the HTML to understand form structure
const bodyHTML = await page.evaluate(() => document.body.innerHTML.substring(0, 3000));
console.log('=== HTML SNIPPET ===');
console.log(bodyHTML);

await browser.close();
