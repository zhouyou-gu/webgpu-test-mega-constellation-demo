import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const mode = process.argv[3] || 'gpu';

const args =
  mode === 'gpu'
    ? ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-features=Vulkan,UseSkiaRenderer']
    : [];

const scenarios = [
  { name: 'desktop-1440x900', width: 1440, height: 900, hasTouch: false },
  { name: 'laptop-1280x720', width: 1280, height: 720, hasTouch: false },
  { name: 'tablet-1024x1366', width: 1024, height: 1366, hasTouch: true },
  { name: 'mobile-390x844', width: 390, height: 844, hasTouch: true }
];

const browser = await chromium.launch({ headless: true, args });
const results = [];

for (const s of scenarios) {
  const page = await browser.newPage({
    viewport: { width: s.width, height: s.height },
    hasTouch: s.hasTouch,
    isMobile: s.hasTouch
  });

  await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(6000);

  const cx = Math.floor(s.width * 0.55);
  const cy = Math.floor(s.height * 0.58);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(Math.floor(s.width * 0.75), Math.floor(s.height * 0.46), { steps: 30 });
  await page.mouse.up();
  await page.waitForTimeout(1200);

  await page.mouse.dblclick(cx, cy, { delay: 40 });
  await page.waitForTimeout(900);

  if (!s.hasTouch) {
    for (let i = 0; i < 3; i += 1) {
      await page.mouse.wheel(0, -220);
      await page.waitForTimeout(100);
    }
    for (let i = 0; i < 3; i += 1) {
      await page.mouse.wheel(0, 220);
      await page.waitForTimeout(100);
    }
  }

  await page.waitForTimeout(1200);
  const screenshot = `/tmp/ux-${mode}-${s.name}.png`;
  await page.screenshot({ path: screenshot, fullPage: true });

  const summary = await page.evaluate(() => {
    const modeEl = document.querySelector('.hud-mode-chip');
    const title = document.querySelector('.hud-title-main')?.textContent?.trim() ?? '';
    const author = document.querySelector('.hud-title-sub')?.textContent?.trim() ?? '';
    const config = document.querySelector('[data-pane="config"]')?.textContent?.trim().split('\n').slice(0, 3) ?? [];
    const status = document.querySelector('[data-pane="status"]')?.textContent?.trim().split('\n').slice(0, 3) ?? [];
    const profile = document.querySelector('[data-pane="profile"]')?.textContent?.trim().split('\n').slice(0, 3) ?? [];
    return {
      mode: modeEl?.textContent?.trim() ?? 'UNKNOWN',
      title,
      author,
      config,
      status,
      profile
    };
  });

  results.push({ scenario: s.name, screenshot, ...summary });
  await page.close();
}

await browser.close();
console.log(JSON.stringify({ modeRequested: mode, results }, null, 2));
