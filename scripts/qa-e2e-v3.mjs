import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// Use CDP to set localStorage before navigation
const cdp = await context.newCDPSession(page);
await cdp.send('Page.enable');
await cdp.send('DOMStorage.enable');
await cdp.send('Storage.enable');

// Set localStorage via CDP Storage.setStorageItems
await cdp.send('Storage.setStorageItems', {
  storageOrigin: 'http://localhost:5173',
  storageType: 'local_storage',
  storageItems: [
    { key: 'abq_enteredWorld', value: 'true' },
    { key: 'abq_sessionId', value: 'play-r1-1' },
  ]
});

console.log('localStorage set via CDP');

// Navigate
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// Check state
const info = await page.evaluate(() => {
  const landing = document.querySelector('.landing-screen');
  const appShell = document.querySelector('.app-shell');
  const text = document.body.innerText.substring(0, 300);
  return {
    hasLanding: !!landing,
    hasAppShell: !!appShell,
    textSnippet: text
  };
});
console.log('Page info:', JSON.stringify(info, null, 2));

await page.screenshot({ path: '/tmp/bbr-r1-cdp.png', fullPage: false });

await browser.close();
