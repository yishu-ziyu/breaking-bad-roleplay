import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// Pre-set localStorage via CDP before the page loads
const page = await context.newPage();

// Inject localStorage BEFORE the page loads by using a route interception
await page.route('**/*', route => {
  route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: `<!DOCTYPE html><html><head><script>localStorage.setItem('abq_enteredWorld','true');localStorage.setItem('abq_sessionId','play-r1-1');</script></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`,
  });
});

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// Check what we see
const info = await page.evaluate(() => {
  const landing = document.querySelector('.landing-screen');
  const appShell = document.querySelector('.app-shell');
  const sidebar = document.querySelector('.sidebar');
  const text = document.body.innerText.substring(0, 200);
  return {
    hasLanding: !!landing,
    hasAppShell: !!appShell,
    hasSidebar: !!sidebar,
    textSnippet: text
  };
});
console.log('Page info:', JSON.stringify(info, null, 2));

// Take screenshot
await page.screenshot({ path: '/tmp/bbr-r1-injected.png', fullPage: false });

await browser.close();
console.log('Done');
