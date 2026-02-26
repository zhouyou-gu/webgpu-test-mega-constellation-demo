import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-features=Vulkan,UseSkiaRenderer']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(12000);
const text = await page.locator('#overlay').innerText();
await page.screenshot({ path: '/tmp/mega-constellation-verify-headful.png', fullPage: true });
console.log(text.split('\n').slice(0, 7).join('\n'));
await browser.close();
