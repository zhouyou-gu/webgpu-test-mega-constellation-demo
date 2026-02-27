import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const outPath = process.argv[3] || 'public/social-preview.png';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-features=Vulkan,UseSkiaRenderer']
});

const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(8000);

await page.evaluate(() => {
  const details = document.querySelector('.hud-section');
  if (details instanceof HTMLDetailsElement) {
    details.open = false;
  }
  const controls = document.querySelector('.hud-controls');
  if (controls instanceof HTMLElement) {
    controls.style.display = 'none';
  }
  const warning = document.querySelector('.hud-warning');
  if (warning instanceof HTMLElement) {
    warning.style.display = 'none';
  }
});

await page.screenshot({ path: outPath, type: 'png' });
await browser.close();

console.log(`Saved social preview image: ${outPath}`);
