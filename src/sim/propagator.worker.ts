/// <reference lib="webworker" />

import * as satellite from 'satellite.js';
import type { PropagatorRequest, PropagatorResponse } from './messages';

type Satrec = ReturnType<typeof satellite.twoline2satrec>;

let satrecs: Satrec[] = [];
let epoch = new Date();

function isVec3(v: unknown): v is { x: number; y: number; z: number } {
  if (!v || typeof v !== 'object') {
    return false;
  }
  const obj = v as Record<string, unknown>;
  return typeof obj.x === 'number' && typeof obj.y === 'number' && typeof obj.z === 'number';
}

function parseTleRecords(tleText: string): Satrec[] {
  const lines = tleText
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  const result: Satrec[] = [];

  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (line.startsWith('1 ') && i + 1 < lines.length && lines[i + 1].startsWith('2 ')) {
      try {
        result.push(satellite.twoline2satrec(line, lines[i + 1]));
      } catch {
        // Skip malformed pair.
      }
      i += 2;
      continue;
    }

    if (
      i + 2 < lines.length &&
      lines[i + 1].startsWith('1 ') &&
      lines[i + 2].startsWith('2 ')
    ) {
      try {
        result.push(satellite.twoline2satrec(lines[i + 1], lines[i + 2]));
      } catch {
        // Skip malformed record.
      }
      i += 3;
      continue;
    }

    i += 1;
  }

  return result;
}

function runPropagation(simTimeSec: number): PropagatorResponse {
  const start = performance.now();
  const n = satrecs.length;
  const positions = new Float32Array(n * 3);
  const velocities = new Float32Array(n * 3);

  const targetDate = new Date(epoch.getTime() + simTimeSec * 1000);

  for (let i = 0; i < n; i += 1) {
    const pv = satellite.propagate(satrecs[i], targetDate);
    const p = pv.position;
    const v = pv.velocity;

    const pOffset = i * 3;
    if (!isVec3(p) || !isVec3(v)) {
      positions[pOffset + 0] = 0;
      positions[pOffset + 1] = 0;
      positions[pOffset + 2] = 0;
      velocities[pOffset + 0] = 0;
      velocities[pOffset + 1] = 0;
      velocities[pOffset + 2] = 0;
      continue;
    }

    positions[pOffset + 0] = p.x;
    positions[pOffset + 1] = p.y;
    positions[pOffset + 2] = p.z;
    velocities[pOffset + 0] = v.x;
    velocities[pOffset + 1] = v.y;
    velocities[pOffset + 2] = v.z;
  }

  return {
    type: 'STATE',
    positions,
    velocities,
    satCount: n,
    simTimeSec,
    propagationMs: performance.now() - start
  };
}

self.onmessage = (event: MessageEvent<PropagatorRequest>) => {
  const msg = event.data;

  try {
    if (msg.type === 'INIT_TLE') {
      epoch = new Date(msg.epochUtc);
      satrecs = parseTleRecords(msg.tleText);

      const response: PropagatorResponse = {
        type: 'READY',
        satCount: satrecs.length
      };
      self.postMessage(response);
      return;
    }

    if (msg.type === 'STEP_PROPAGATION') {
      const response = runPropagation(msg.simTimeSec);
      if (response.type === 'STATE') {
        self.postMessage(response, [
          response.positions.buffer as ArrayBuffer,
          response.velocities.buffer as ArrayBuffer
        ]);
      } else {
        self.postMessage(response);
      }
      return;
    }
  } catch (err) {
    const response: PropagatorResponse = {
      type: 'ERROR',
      code: 'PROPAGATOR_ERROR',
      message: err instanceof Error ? err.message : String(err)
    };
    self.postMessage(response);
  }
};
