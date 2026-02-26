import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const mode = process.argv[3] || 'default';
const durationSec = Number(process.argv[4] || 20);

const args = [];
if (mode === 'gpu') {
  args.push('--enable-unsafe-webgpu', '--use-angle=metal', '--enable-features=Vulkan,UseSkiaRenderer');
}

const browser = await chromium.launch({ headless: true, args });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });

await page.evaluate(() => {
  // @ts-ignore
  window.__fpsProbe = { frames: 0, start: performance.now() };
  const tick = () => {
    // @ts-ignore
    window.__fpsProbe.frames += 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const samples = [];
const stopAt = Date.now() + durationSec * 1000;
while (Date.now() < stopAt) {
  await page.waitForTimeout(1000);
  const overlayText = await page.locator('#overlay').innerText();
  const sat = Number((overlayText.match(/Satellites:\s*(\d+)/)?.[1]) ?? -1);
  const links = Number((overlayText.match(/Connected links:\s*(\d+)/)?.[1]) ?? -1);
  const renderMs = Number((overlayText.match(/Render:\s*([0-9.]+)\s*ms/)?.[1]) ?? NaN);
  const modeText = (overlayText.match(/Mode:\s*(\w+)/)?.[1] ?? 'UNKNOWN');
  samples.push({ sat, links, renderMs, modeText });
}

const probe = await page.evaluate(() => {
  // @ts-ignore
  const p = window.__fpsProbe;
  return { frames: p.frames, elapsedMs: performance.now() - p.start };
});

await browser.close();

const validRender = samples.map((s) => s.renderMs).filter((x) => Number.isFinite(x) && x > 0);
const avgRenderMs = validRender.length ? validRender.reduce((a, b) => a + b, 0) / validRender.length : NaN;
const p95RenderMs = validRender.length
  ? validRender.slice().sort((a, b) => a - b)[Math.max(0, Math.floor(validRender.length * 0.95) - 1)]
  : NaN;

const avgSat = samples.length ? samples.reduce((a, s) => a + s.sat, 0) / samples.length : 0;
const avgLinks = samples.length ? samples.reduce((a, s) => a + s.links, 0) / samples.length : 0;
const observedFps = probe.frames / (probe.elapsedMs / 1000);
const inferredFpsFromRender = Number.isFinite(avgRenderMs) && avgRenderMs > 0 ? 1000 / avgRenderMs : NaN;

const result = {
  modeRequested: mode,
  modeObserved: samples[0]?.modeText ?? 'UNKNOWN',
  durationSec,
  observedFps,
  inferredFpsFromRender,
  avgRenderMs,
  p95RenderMs,
  avgSat,
  avgLinks,
  sampleCount: samples.length,
  pageErrors,
  consoleErrors
};

console.log(JSON.stringify(result, null, 2));
