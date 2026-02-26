import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const mode = process.argv[3] || 'default';
const args = mode === 'gpu'
  ? ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-features=Vulkan,UseSkiaRenderer']
  : [];

const browser = await chromium.launch({ headless: true, args });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(6000);

async function snap(name) {
  const p = `/tmp/iter-${mode}-${name}.png`;
  await page.screenshot({ path: p, fullPage: true });
  const metrics = await page.evaluate(() => {
    const all = (document.querySelector('#overlay')?.textContent ?? '').replace(/\s+/g, ' ');
    const modeValue =
      document.querySelector('.hud-mode-chip')?.textContent?.trim() ??
      all.match(/Mode:\s*(\w+)/)?.[1] ??
      all.match(/\bMode\s+(\w+)/)?.[1] ??
      'UNKNOWN';
    const sat = Number((all.match(/#n_sats:\s*(\d+)/)?.[1]) ?? (all.match(/Satellites:\s*(\d+)/)?.[1] ?? -1));
    const links = Number((all.match(/#n_c_lp:\s*(\d+)/)?.[1]) ?? (all.match(/Connected links:\s*(\d+)/)?.[1] ?? -1));
    const drawSec = Number(all.match(/draw_matching:\s*([0-9.]+)\s*s/)?.[1] ?? NaN);
    const drawMs = Number(all.match(/Render:\s*([0-9.]+)\s*ms/)?.[1] ?? NaN);
    const renderMs = Number.isFinite(drawMs) ? drawMs : Number.isFinite(drawSec) ? drawSec * 1000 : NaN;
    return { modeValue, sat, links, renderMs };
  });
  return {
    name,
    screenshot: p,
    modeObserved: metrics.modeValue,
    sat: metrics.sat,
    links: metrics.links,
    renderMs: Number.isFinite(metrics.renderMs) ? metrics.renderMs : NaN
  };
}

const out = [];
out.push(await snap('initial'));

await page.mouse.move(720, 450);
await page.mouse.down();
await page.mouse.move(980, 430, { steps: 30 });
await page.mouse.up();
await page.waitForTimeout(2000);
out.push(await snap('rotate-1'));

await page.mouse.move(980, 430);
await page.mouse.down();
await page.mouse.move(680, 280, { steps: 30 });
await page.mouse.up();
await page.waitForTimeout(2000);
out.push(await snap('rotate-2'));

for (let i = 0; i < 6; i += 1) {
  await page.mouse.wheel(0, -220);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(2200);
out.push(await snap('zoom-in'));

for (let i = 0; i < 8; i += 1) {
  await page.mouse.wheel(0, 260);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(2200);
out.push(await snap('zoom-out'));

await browser.close();
console.log(JSON.stringify({ modeRequested: mode, checks: out }, null, 2));
