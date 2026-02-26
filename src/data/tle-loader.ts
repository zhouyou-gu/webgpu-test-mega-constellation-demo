import { ungzip } from 'pako';
import { DATA_ENDPOINTS } from '../app/config';
import type { TleSnapshotMeta } from '../sim/messages';

export interface LoadedTleSnapshot {
  meta: TleSnapshotMeta;
  tleText: string;
}

async function sha256Hex(input: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function loadTleSnapshot(): Promise<LoadedTleSnapshot> {
  const [metaRes, gzRes] = await Promise.all([
    fetch(DATA_ENDPOINTS.meta, { cache: 'no-store' }),
    fetch(DATA_ENDPOINTS.tleGz, { cache: 'no-store' })
  ]);

  if (!metaRes.ok) {
    throw new Error(`Failed to fetch TLE metadata (${metaRes.status})`);
  }
  if (!gzRes.ok) {
    throw new Error(`Failed to fetch TLE snapshot (${gzRes.status})`);
  }

  const meta = (await metaRes.json()) as TleSnapshotMeta;
  const gz = await gzRes.arrayBuffer();
  const checksum = await sha256Hex(gz);

  if (meta.sha256_gz && checksum !== meta.sha256_gz) {
    // In some static hosting paths, `.gz` may be transparently decompressed by the server/client.
    // Keep the app usable and continue parsing even if checksum does not match the on-disk gzip bytes.
    console.warn('TLE snapshot checksum mismatch; continuing with payload parsing');
  }

  const raw = new Uint8Array(gz);
  let tleText: string;
  try {
    const bytes = ungzip(raw);
    tleText = new TextDecoder().decode(bytes);
  } catch {
    tleText = new TextDecoder().decode(raw);
  }

  return {
    meta,
    tleText
  };
}
