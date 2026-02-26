import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const mode = process.argv[3] || 'default';
const waitMs = Number(process.argv[4] || 10000);

const args = [];
if (mode === 'gpu') {
  args.push('--enable-unsafe-webgpu', '--use-angle=metal', '--enable-features=Vulkan,UseSkiaRenderer');
}

const browser = await chromium.launch({ headless: true, args });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(waitMs);

const overlay = await page.evaluate(() => {
  const all = (document.querySelector('#overlay')?.textContent ?? '').replace(/\s+/g, ' ');
  const sat = Number((all.match(/#n_sats:\s*(\d+)/)?.[1]) ?? (all.match(/Satellites:\s*(\d+)/)?.[1] ?? -1));
  const links = Number((all.match(/#n_c_lp:\s*(\d+)/)?.[1]) ?? (all.match(/Connected links:\s*(\d+)/)?.[1] ?? -1));
  const mode =
    (document.querySelector('.hud-mode-chip')?.textContent?.trim() ??
      all.match(/Mode:\s*(\w+)/)?.[1] ??
      all.match(/\bMode\s+(\w+)/)?.[1] ??
      'UNKNOWN');
  return { sat, links, mode };
});

const satCount = overlay.sat;
const linkCount = overlay.links;
const modeObserved = overlay.mode;

const canvasStats = await page.evaluate(() => {
  const canvas = document.querySelector('#scene');
  if (!(canvas instanceof HTMLCanvasElement)) {
    return { ok: false, reason: 'no-canvas' };
  }
  const probe = document.createElement('canvas');
  probe.width = canvas.width;
  probe.height = canvas.height;
  const ctx = probe.getContext('2d');
  if (!ctx) {
    return { ok: false, reason: 'no-2d-context' };
  }
  ctx.drawImage(canvas, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, probe.width, probe.height);

  let sum = 0;
  let nonNearWhite = 0;
  let nonNearBlack = 0;
  let colorful = 0;

  const step = 4 * 8; // sample every 8 pixels
  for (let i = 0; i < data.length; i += step) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = (r + g + b) / 3;
    sum += lum;
    if (!(r > 245 && g > 245 && b > 245)) nonNearWhite += 1;
    if (!(r < 10 && g < 10 && b < 10)) nonNearBlack += 1;
    if ((Math.abs(r - g) > 20 || Math.abs(g - b) > 20 || Math.abs(r - b) > 20) && lum > 20) {
      colorful += 1;
    }
  }

  const samples = Math.floor(data.length / step);
  return {
    ok: true,
    width,
    height,
    avgLum: sum / Math.max(1, samples),
    nonNearWhiteRatio: nonNearWhite / Math.max(1, samples),
    nonNearBlackRatio: nonNearBlack / Math.max(1, samples),
    colorfulRatio: colorful / Math.max(1, samples)
  };
});

const screenshot = `/tmp/mega-constellation-verify-${mode}.png`;
await page.screenshot({ path: screenshot, fullPage: true });

await browser.close();

console.log(
  JSON.stringify(
    {
      modeRequested: mode,
      modeObserved,
      satCount,
      linkCount,
      canvasStats,
      pageErrors,
      consoleErrors,
      screenshot
    },
    null,
    2
  )
);
