import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-features=Vulkan,UseSkiaRenderer']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(12000);
const summary = await page.evaluate(() => {
  const text = document.querySelector('#overlay')?.textContent ?? '';
  const mode = document.querySelector('.hud-mode-chip')?.textContent?.trim() ?? 'UNKNOWN';
  const sat = Number(text.match(/#n_sats:\s*(\d+)/)?.[1] ?? -1);
  const links = Number(text.match(/#n_c_lp:\s*(\d+)/)?.[1] ?? -1);
  const candidates = Number(text.match(/#n_q_es:\s*(\d+)/)?.[1] ?? -1);
  return { mode, sat, links, candidates };
});
await page.screenshot({ path: '/tmp/mega-constellation-verify-headful.png', fullPage: true });
console.log(
  [
    'Mega-Constellation Browser Twin',
    `Mode: ${summary.mode}`,
    `Satellites: ${summary.sat}`,
    `Connected links: ${summary.links}`,
    `Candidates: ${summary.candidates}`
  ].join('\n')
);
await browser.close();
