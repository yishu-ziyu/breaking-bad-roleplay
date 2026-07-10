import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// Step 1: Initial screenshot
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.screenshot({ path: '/tmp/bbr-r1-1.png', fullPage: false });
console.log('Screenshot 1 (landing) done');

// Step 2: Inject localStorage to skip landing screen
await page.evaluate(() => {
  localStorage.setItem('abq_enteredWorld', 'true');
  localStorage.setItem('abq_sessionId', 'play-r1-1');
});
console.log('localStorage injected: abq_enteredWorld=true, abq_sessionId=play-r1-1');

// Step 3: Reload
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
console.log('Reloaded, waited 1.5s');

// Screenshot after reload (main UI)
await page.screenshot({ path: '/tmp/bbr-r1-2-main-ui.png', fullPage: false });

// Check current view
const info = await page.evaluate(() => {
  const landing = document.querySelector('.landing-screen');
  const appShell = document.querySelector('.app-shell');
  const text = document.body.innerText.substring(0, 100);
  return {
    hasLanding: !!landing,
    hasAppShell: !!appShell,
    textSnippet: text
  };
});
console.log('Page info:', JSON.stringify(info, null, 2));

await browser.close();
