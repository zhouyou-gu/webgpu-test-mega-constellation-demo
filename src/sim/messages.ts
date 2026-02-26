export type RuntimeMode = 'gpu' | 'cpu';

export interface LinkConfig {
  maxDistanceKm: number;
  forThetaDeg: number;
  minViewTimeSec: number;
}

export interface TleSnapshotMeta {
  source: 'celestrak';
  group: 'starlink';
  fetched_at_utc: string;
  sat_count: number;
  tle_lines: number;
  sha256_gz: string;
  schema_version: 1;
}

export type PropagatorRequest =
  | { type: 'INIT_TLE'; tleText: string; epochUtc: string }
  | { type: 'STEP_PROPAGATION'; simTimeSec: number };

export type PropagatorResponse =
  | {
      type: 'STATE';
      positions: Float32Array<ArrayBufferLike>;
      velocities: Float32Array<ArrayBufferLike>;
      satCount: number;
      simTimeSec: number;
      propagationMs: number;
    }
  | { type: 'READY'; satCount: number }
  | { type: 'ERROR'; code: string; message: string };

export type LinkWorkerRequest =
  | { type: 'SET_CONFIG'; config: LinkConfig; mode: RuntimeMode }
  | {
      type: 'UPDATE_STATE';
      positions: Float32Array<ArrayBufferLike>;
      velocities: Float32Array<ArrayBufferLike>;
      satCount: number;
      simTimeSec: number;
    }
  | { type: 'BUILD_LINKS' };

export type LinkWorkerResponse =
  | {
      type: 'LINKS';
      connectedLts: Uint32Array<ArrayBufferLike>;
      connectedSatPairs: Uint32Array<ArrayBufferLike>;
      candidateCount: number;
      matchedCount: number;
      computeMs: number;
      simTimeSec: number;
    }
  | { type: 'ERROR'; code: string; message: string };

export interface OverlayMetrics {
  mode: RuntimeMode;
  satCount: number;
  linkCount: number;
  candidateCount: number;
  simTimeSec: number;
  propagationMs: number;
  matchingMs: number;
  renderMs: number;
  tleUpdatedUtc?: string;
  warning?: string;
}
