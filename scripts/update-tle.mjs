import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'public', 'data', 'tle');
const URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle';
const KEEP_HISTORY = 7;

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function countSatellites(tleText) {
  const lines = tleText
    .split('\n')
    .map((x) => x.trimEnd())
    .filter(Boolean);

  let count = 0;
  for (let i = 0; i < lines.length; ) {
    if (lines[i].startsWith('1 ') && i + 1 < lines.length && lines[i + 1].startsWith('2 ')) {
      count += 1;
      i += 2;
      continue;
    }
    if (i + 2 < lines.length && lines[i + 1].startsWith('1 ') && lines[i + 2].startsWith('2 ')) {
      count += 1;
      i += 3;
      continue;
    }
    i += 1;
  }
  return count;
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function pruneOldSnapshots() {
  const entries = await readdir(OUT_DIR);
  const gzFiles = entries
    .filter((name) => /^starlink\.\d{4}-\d{2}-\d{2}\.tle\.gz$/.test(name))
    .sort();

  if (gzFiles.length <= KEEP_HISTORY) {
    return;
  }

  const removeCount = gzFiles.length - KEEP_HISTORY;
  for (let i = 0; i < removeCount; i += 1) {
    await rm(path.join(OUT_DIR, gzFiles[i]));
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const latestGzPath = path.join(OUT_DIR, 'starlink.latest.tle.gz');
  const dailyGzPath = path.join(OUT_DIR, `starlink.${todayIsoDate()}.tle.gz`);
  const metaPath = path.join(OUT_DIR, 'starlink.latest.meta.json');

  let tleText = '';
  let lastError = null;
  try {
    const response = await fetch(URL, {
      headers: {
        'User-Agent': 'mega-constellation-github-action/1.0'
      }
    });
    if (!response.ok) {
      throw new Error(`CelesTrak fetch failed: ${response.status}`);
    }
    tleText = await response.text();
  } catch (err) {
    lastError = err;
    try {
      // Fallback for environments where Node DNS/network is restricted but curl is allowed.
      tleText = execFileSync('curl', ['-L', '-sS', URL], { encoding: 'utf8' });
    } catch (curlErr) {
      lastError = curlErr;
    }
  }

  if (!tleText.trim()) {
    try {
      await stat(latestGzPath);
      console.warn('Could not refresh TLE snapshot; keeping existing files.');
      if (lastError) {
        console.warn(String(lastError));
      }
      return;
    } catch {
      throw new Error(`CelesTrak fetch failed and no existing snapshot is available. ${String(lastError ?? '')}`);
    }
  }

  const gz = gzipSync(Buffer.from(tleText, 'utf8'), { level: 9 });
  const checksum = sha256Hex(gz);
  const satCount = countSatellites(tleText);

  const meta = {
    source: 'celestrak',
    group: 'starlink',
    fetched_at_utc: new Date().toISOString(),
    sat_count: satCount,
    tle_lines: tleText.split('\n').filter(Boolean).length,
    sha256_gz: checksum,
    schema_version: 1
  };

  await writeFile(latestGzPath, gz);
  await writeFile(dailyGzPath, gz);
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  await pruneOldSnapshots();

  const latestStats = await stat(latestGzPath);
  console.log(`Wrote ${latestGzPath} (${latestStats.size} bytes), satellites=${satCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
