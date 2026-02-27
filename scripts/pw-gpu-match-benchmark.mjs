import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const sampleTimesSec = [5, 10, 15, 20, 25, 30];
const fixedEpochUtc = process.argv[3] || '2026-02-26T09:16:56.000Z';

function jaccard(aSet, bSet) {
  const small = aSet.size <= bSet.size ? aSet : bSet;
  const large = aSet.size <= bSet.size ? bSet : aSet;
  let inter = 0;
  for (const k of small) {
    if (large.has(k)) inter += 1;
  }
  const union = aSet.size + bSet.size - inter;
  return union === 0 ? 1 : inter / union;
}

function edgeSetFromPairs(pairs) {
  const s = new Set();
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const a = pairs[i];
    const b = pairs[i + 1];
    const x = a < b ? a : b;
    const y = a < b ? b : a;
    s.add(`${x}-${y}`);
  }
  return s;
}

async function collectRun(browser, runUrl) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  await page.goto(runUrl, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    window.__mcControl?.setTimeScale(1);
  });
  await page.evaluate((epochUtc) => {
    window.__mcControl?.setSimulationEpochUtc(epochUtc);
  }, fixedEpochUtc);

  const out = [];
  let prevT = 0;
  for (const t of sampleTimesSec) {
    const dt = Math.max(0, t - prevT);
    prevT = t;
    await page.waitForTimeout(dt * 1000);
    const sample = await page.evaluate(() => {
      const d = window.__mcDebug;
      const all = (document.querySelector('#overlay')?.textContent ?? '').replace(/\s+/g, ' ');
      const mode = all.match(/Mode:\s*(\w+)/)?.[1] ?? 'UNKNOWN';
      const matcher = all.match(/Matcher:\s*(\w+)/)?.[1] ?? d?.matcherMode ?? 'unknown';
      return {
        simTimeSec: d?.simTimeSec ?? 0,
        linkCount: d?.linkCount ?? 0,
        candidateCount: d?.candidateCount ?? 0,
        matchingMs: d?.matchingMs ?? NaN,
        scoreMs: d?.scoreMs ?? NaN,
        matchMs: d?.matchMs ?? NaN,
        fallbackCount: d?.fallbackCount ?? 0,
        renderMode: mode,
        matcherMode: matcher,
        pairs: Array.from(d?.connectedSatPairs ?? [])
      };
    });
    out.push({ t, ...sample });
  }

  await page.close();
  return { samples: out, pageErrors, consoleErrors };
}

const args = ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-features=Vulkan,UseSkiaRenderer'];
const browser = await chromium.launch({ headless: true, args });

const cpuRun = await collectRun(browser, `${url}?matcher=cpu`);
const gpuRun = await collectRun(browser, `${url}?matcher=gpu`);

await browser.close();

const comparisons = [];
for (let i = 0; i < sampleTimesSec.length; i += 1) {
  const c = cpuRun.samples[i];
  const g = gpuRun.samples[i];
  const cj = edgeSetFromPairs(c?.pairs ?? []);
  const gj = edgeSetFromPairs(g?.pairs ?? []);
  const overlap = jaccard(cj, gj);
  const cpuMs = Number(c?.matchingMs ?? NaN);
  const gpuMs = Number(g?.matchingMs ?? NaN);
  const speedup = Number.isFinite(cpuMs) && Number.isFinite(gpuMs) && gpuMs > 0 ? cpuMs / gpuMs : NaN;
  comparisons.push({
    t: sampleTimesSec[i],
    cpuLinks: c?.linkCount ?? 0,
    gpuLinks: g?.linkCount ?? 0,
    overlap,
    cpuMs,
    gpuMs,
    speedup,
    gpuMatcherMode: g?.matcherMode,
    gpuFallbacks: g?.fallbackCount ?? 0
  });
}

const overlaps = comparisons.map((x) => x.overlap).filter((x) => Number.isFinite(x));
const speedups = comparisons.map((x) => x.speedup).filter((x) => Number.isFinite(x));
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN);
const min = (arr) => (arr.length ? Math.min(...arr) : NaN);

const result = {
  acceptance: {
    overlapTarget: 0.95,
    minOverlap: min(overlaps),
    passOverlap: overlaps.length > 0 ? min(overlaps) >= 0.95 : false,
    medianSpeedupApprox: speedups.length ? speedups.slice().sort((a, b) => a - b)[Math.floor(speedups.length / 2)] : NaN
  },
  fixedEpochUtc,
  runs: {
    cpu: {
      renderMode: cpuRun.samples[0]?.renderMode,
      matcherMode: cpuRun.samples[0]?.matcherMode,
      pageErrors: cpuRun.pageErrors,
      consoleErrors: cpuRun.consoleErrors
    },
    gpu: {
      renderMode: gpuRun.samples[0]?.renderMode,
      matcherMode: gpuRun.samples[0]?.matcherMode,
      pageErrors: gpuRun.pageErrors,
      consoleErrors: gpuRun.consoleErrors
    }
  },
  summary: {
    avgOverlap: mean(overlaps),
    avgSpeedup: mean(speedups)
  },
  comparisons
};

console.log(JSON.stringify(result, null, 2));
