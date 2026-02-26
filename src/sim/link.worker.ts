/// <reference lib="webworker" />

import type {
  LinkConfig,
  LinkWorkerRequest,
  LinkWorkerResponse,
  RuntimeMode
} from './messages';

let mode: RuntimeMode = 'cpu';
let config: LinkConfig = {
  maxDistanceKm: 3000,
  forThetaDeg: 15,
  minViewTimeSec: 100
};

let positions: Float32Array<ArrayBufferLike> = new Float32Array();
let velocities: Float32Array<ArrayBufferLike> = new Float32Array();
let satCount = 0;
let simTimeSec = 0;

type WeightedEdge = {
  srcLt: number;
  dstLt: number;
  srcSat: number;
  dstSat: number;
  weight: number;
};

const neighborOffsets: Array<[number, number, number]> = [];
for (let dx = -1; dx <= 1; dx += 1) {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      neighborOffsets.push([dx, dy, dz]);
    }
  }
}

function key(ix: number, iy: number, iz: number): string {
  return `${ix},${iy},${iz}`;
}

function parseKey(k: string): [number, number, number] {
  const [a, b, c] = k.split(',');
  return [Number(a), Number(b), Number(c)];
}

function dot(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  return ax * bx + ay * by + az * bz;
}

function clamp01Signed(x: number): number {
  if (x > 1) {
    return 1;
  }
  if (x < -1) {
    return -1;
  }
  return x;
}

function buildCandidates(maxDistanceKm: number): Array<[number, number]> {
  const binSize = maxDistanceKm;
  const bins = new Map<string, number[]>();

  for (let i = 0; i < satCount; i += 1) {
    const p = i * 3;
    const ix = Math.floor(positions[p + 0] / binSize);
    const iy = Math.floor(positions[p + 1] / binSize);
    const iz = Math.floor(positions[p + 2] / binSize);
    const k = key(ix, iy, iz);
    const list = bins.get(k);
    if (list) {
      list.push(i);
    } else {
      bins.set(k, [i]);
    }
  }

  const candidates: Array<[number, number]> = [];
  const maxDist2 = maxDistanceKm * maxDistanceKm;

  for (const [baseKey, baseIndices] of bins.entries()) {
    const [bx, by, bz] = parseKey(baseKey);

    for (const [dx, dy, dz] of neighborOffsets) {
      const nk = key(bx + dx, by + dy, bz + dz);
      const other = bins.get(nk);
      if (!other) {
        continue;
      }

      if (nk < baseKey) {
        continue;
      }

      if (nk === baseKey) {
        for (let i = 0; i < baseIndices.length; i += 1) {
          const a = baseIndices[i];
          const ap = a * 3;
          for (let j = i + 1; j < baseIndices.length; j += 1) {
            const b = baseIndices[j];
            const bp = b * 3;
            const dxp = positions[bp + 0] - positions[ap + 0];
            const dyp = positions[bp + 1] - positions[ap + 1];
            const dzp = positions[bp + 2] - positions[ap + 2];
            const d2 = dxp * dxp + dyp * dyp + dzp * dzp;
            if (d2 <= maxDist2) {
              candidates.push([a, b]);
            }
          }
        }
      } else {
        for (let i = 0; i < baseIndices.length; i += 1) {
          const a = baseIndices[i];
          const ap = a * 3;
          for (let j = 0; j < other.length; j += 1) {
            const b = other[j];
            const bp = b * 3;
            const dxp = positions[bp + 0] - positions[ap + 0];
            const dyp = positions[bp + 1] - positions[ap + 1];
            const dzp = positions[bp + 2] - positions[ap + 2];
            const d2 = dxp * dxp + dyp * dyp + dzp * dzp;
            if (d2 <= maxDist2) {
              const iSat = a < b ? a : b;
              const jSat = a < b ? b : a;
              candidates.push([iSat, jSat]);
            }
          }
        }
      }
    }
  }

  return candidates;
}

function scoreAndMatch(candidates: Array<[number, number]>, conf: LinkConfig): {
  weightedEdges: WeightedEdge[];
  connected: WeightedEdge[];
} {
  const n = satCount;
  const front = new Float32Array(n * 3);
  const back = new Float32Array(n * 3);
  const right = new Float32Array(n * 3);
  const left = new Float32Array(n * 3);

  for (let i = 0; i < n; i += 1) {
    const p = i * 3;

    const vx = velocities[p + 0];
    const vy = velocities[p + 1];
    const vz = velocities[p + 2];
    const vNorm = Math.hypot(vx, vy, vz) || 1;
    const fx = vx / vNorm;
    const fy = vy / vNorm;
    const fz = vz / vNorm;
    front[p + 0] = fx;
    front[p + 1] = fy;
    front[p + 2] = fz;
    back[p + 0] = -fx;
    back[p + 1] = -fy;
    back[p + 2] = -fz;

    const px = positions[p + 0];
    const py = positions[p + 1];
    const pz = positions[p + 2];
    const pNorm = Math.hypot(px, py, pz) || 1;
    const dx = px / pNorm;
    const dy = py / pNorm;
    const dz = pz / pNorm;

    const rx = dy * fz - dz * fy;
    const ry = dz * fx - dx * fz;
    const rz = dx * fy - dy * fx;
    right[p + 0] = rx;
    right[p + 1] = ry;
    right[p + 2] = rz;
    left[p + 0] = -rx;
    left[p + 1] = -ry;
    left[p + 2] = -rz;
  }

  const theta = (conf.forThetaDeg * Math.PI) / 180;
  const cosThreshold = Math.cos(theta);
  const weightedEdges: WeightedEdge[] = [];

  for (let c = 0; c < candidates.length; c += 1) {
    const [iSat, jSat] = candidates[c];

    const ip = iSat * 3;
    const jp = jSat * 3;

    const dx = positions[jp + 0] - positions[ip + 0];
    const dy = positions[jp + 1] - positions[ip + 1];
    const dz = positions[jp + 2] - positions[ip + 2];

    const dist = Math.hypot(dx, dy, dz);
    if (dist === 0) {
      continue;
    }

    const invDist = 1 / dist;
    const dirx = dx * invDist;
    const diry = dy * invDist;
    const dirz = dz * invDist;

    const fromViews = [
      dot(front[ip + 0], front[ip + 1], front[ip + 2], dirx, diry, dirz),
      dot(back[ip + 0], back[ip + 1], back[ip + 2], dirx, diry, dirz),
      dot(right[ip + 0], right[ip + 1], right[ip + 2], dirx, diry, dirz),
      dot(left[ip + 0], left[ip + 1], left[ip + 2], dirx, diry, dirz)
    ];

    const toViews = [
      dot(front[jp + 0], front[jp + 1], front[jp + 2], -dirx, -diry, -dirz),
      dot(back[jp + 0], back[jp + 1], back[jp + 2], -dirx, -diry, -dirz),
      dot(right[jp + 0], right[jp + 1], right[jp + 2], -dirx, -diry, -dirz),
      dot(left[jp + 0], left[jp + 1], left[jp + 2], -dirx, -diry, -dirz)
    ];

    let bestFrom = -1;
    let bestTo = -1;
    let bestMinCos = -2;

    for (let a = 0; a < 4; a += 1) {
      if (fromViews[a] <= cosThreshold) {
        continue;
      }
      for (let b = 0; b < 4; b += 1) {
        if (toViews[b] <= cosThreshold) {
          continue;
        }
        const minCos = Math.min(fromViews[a], toViews[b]);
        if (minCos > bestMinCos) {
          bestMinCos = minCos;
          bestFrom = a;
          bestTo = b;
        }
      }
    }

    if (bestFrom < 0 || bestTo < 0) {
      continue;
    }

    const rvx = velocities[jp + 0] - velocities[ip + 0];
    const rvy = velocities[jp + 1] - velocities[ip + 1];
    const rvz = velocities[jp + 2] - velocities[ip + 2];

    const cx = rvy * dz - rvz * dy;
    const cy = rvz * dx - rvx * dz;
    const cz = rvx * dy - rvy * dx;
    const crossNorm = Math.hypot(cx, cy, cz);
    const angularSpeed = crossNorm / dist;

    const acosVal = Math.acos(clamp01Signed(bestMinCos));
    const viewTime = angularSpeed <= 1e-9 ? Number.POSITIVE_INFINITY : (theta - acosVal) / Math.abs(angularSpeed);

    if (viewTime <= conf.minViewTimeSec) {
      continue;
    }

    weightedEdges.push({
      srcLt: iSat * 4 + bestFrom,
      dstLt: jSat * 4 + bestTo,
      srcSat: iSat,
      dstSat: jSat,
      weight: Number.isFinite(viewTime) ? viewTime : 1e12
    });
  }

  weightedEdges.sort((a, b) => b.weight - a.weight);

  const matchedLts = new Set<number>();
  const connected: WeightedEdge[] = [];
  for (let i = 0; i < weightedEdges.length; i += 1) {
    const edge = weightedEdges[i];
    if (matchedLts.has(edge.srcLt) || matchedLts.has(edge.dstLt)) {
      continue;
    }
    matchedLts.add(edge.srcLt);
    matchedLts.add(edge.dstLt);
    connected.push(edge);
  }

  return { weightedEdges, connected };
}

function buildLinks(): LinkWorkerResponse {
  const start = performance.now();
  if (satCount === 0) {
    return {
      type: 'LINKS',
      connectedLts: new Uint32Array(0),
      connectedSatPairs: new Uint32Array(0),
      candidateCount: 0,
      matchedCount: 0,
      computeMs: 0,
      simTimeSec
    };
  }

  const candidates = buildCandidates(config.maxDistanceKm);
  const { weightedEdges, connected } = scoreAndMatch(candidates, config);

  const connectedLts = new Uint32Array(connected.length * 2);
  const connectedSatPairs = new Uint32Array(connected.length * 2);

  for (let i = 0; i < connected.length; i += 1) {
    const e = connected[i];
    connectedLts[i * 2 + 0] = e.srcLt;
    connectedLts[i * 2 + 1] = e.dstLt;
    connectedSatPairs[i * 2 + 0] = e.srcSat;
    connectedSatPairs[i * 2 + 1] = e.dstSat;
  }

  return {
    type: 'LINKS',
    connectedLts,
    connectedSatPairs,
    candidateCount: candidates.length,
    matchedCount: connected.length,
    computeMs: performance.now() - start,
    simTimeSec
  };
}

self.onmessage = (event: MessageEvent<LinkWorkerRequest>) => {
  const msg = event.data;

  try {
    if (msg.type === 'SET_CONFIG') {
      config = msg.config;
      mode = msg.mode;
      void mode;
      return;
    }

    if (msg.type === 'UPDATE_STATE') {
      positions = msg.positions;
      velocities = msg.velocities;
      satCount = msg.satCount;
      simTimeSec = msg.simTimeSec;
      return;
    }

    if (msg.type === 'BUILD_LINKS') {
      const res = buildLinks();
      if (res.type === 'LINKS') {
        self.postMessage(res, [
          res.connectedLts.buffer as ArrayBuffer,
          res.connectedSatPairs.buffer as ArrayBuffer
        ]);
      } else {
        self.postMessage(res);
      }
      return;
    }
  } catch (err) {
    const response: LinkWorkerResponse = {
      type: 'ERROR',
      code: 'LINK_WORKER_ERROR',
      message: err instanceof Error ? err.message : String(err)
    };
    self.postMessage(response);
  }
};
