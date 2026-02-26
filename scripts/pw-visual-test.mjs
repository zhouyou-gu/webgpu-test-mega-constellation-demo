import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:4173/';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
const consoleErrors = [];

page.on('pageerror', (err) => errors.push(String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(10000);

const overlayText = await page.locator('#overlay').innerText();
const satMatch = overlayText.match(/Satellites:\s*(\d+)/);
const linkMatch = overlayText.match(/Connected links:\s*(\d+)/);
const satCount = satMatch ? Number(satMatch[1]) : -1;
const linkCount = linkMatch ? Number(linkMatch[1]) : -1;

await page.screenshot({ path: '/tmp/mega-constellation-visual-test.png', fullPage: true });

const canvasState = await page.evaluate(() => {
  const canvas = document.querySelector('#scene');
  if (!(canvas instanceof HTMLCanvasElement)) {
    return { exists: false, width: 0, height: 0 };
  }
  return { exists: true, width: canvas.width, height: canvas.height };
});

const result = {
  url,
  satCount,
  linkCount,
  canvasState,
  pageErrors: errors,
  consoleErrors,
  screenshot: '/tmp/mega-constellation-visual-test.png',
  overlayText
};

console.log(JSON.stringify(result, null, 2));
await browser.close();
