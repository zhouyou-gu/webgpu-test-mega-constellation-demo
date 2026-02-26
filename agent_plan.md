## WebGPU Browser Migration Plan for Mega-Constellation Demo (GitHub Pages First)

### Summary
- Goal: deliver a browser version of `mega-constellation-demo` that runs from a GitHub Project Page, prefers GPU acceleration, keeps full `10,000` satellites visible, and includes LISL links and interaction controls.
- Feasibility verdict:
1. Browser rendering with WebGPU: feasible.
2. Full `10k + links` with on-device SGP4 on all devices: feasible for correctness, high risk for smooth FPS on mobile/CPU fallback.
3. Static hosting with live remote TLE fetch: not reliable due CORS; use repo snapshots.
- Key source facts used:
1. Upstream app is Python + Numba + SciPy KDTree + Skyfield/SGP4 + Vispy/OpenGL, so no direct browser runtime parity.
2. CelesTrak endpoint currently does not expose CORS headers for browser fetches.
3. WebGPU support is broadly improving but still not universal/identical across browsers.

References:
- https://github.com/zhouyou-gu/mega-constellation-demo
- https://raw.githubusercontent.com/zhouyou-gu/mega-constellation-demo/main/simulation.py
- https://web.dev/articles/webgpu-implementation-status
- https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle

### Architecture (Decision-Complete)

#### 1) Deployment and runtime model
- Primary deployment: GitHub Pages static site.
- Main runtime: full client-side simulation and rendering.
- GPU preference: WebGPU path used when available.
- CPU fallback requirement: still attempt full `10k + links` (best-effort, no FPS guarantee).
- Optional future extension: add backend API later without changing core client interfaces.

#### 2) Data freshness and ingestion
- Add GitHub Action (daily) to fetch Starlink TLE from CelesTrak and commit snapshot artifacts.
- Store artifacts under `public/data/tle/`:
1. `starlink.latest.tle.gz`
2. `starlink.latest.meta.json`
- Keep last 7 snapshots for rollback and reproducibility.
- Client loads only repo-hosted snapshot files (no browser direct CelesTrak fetch in v1).

#### 3) Client module layout
- `src/app/bootstrap.ts`: capability detection, app startup, mode selection.
- `src/data/tle-loader.ts`: fetch/decompress/parse TLE snapshot.
- `src/sim/propagator.worker.ts`: on-device SGP4 propagation loop.
- `src/sim/link.worker.ts`: candidate generation + matching loop.
- `src/gpu/renderer.ts`: WebGPU render pipelines for Earth/satellites/links.
- `src/gpu/edge-score.compute.wgsl`: GPU scoring/filter pass for edge candidates.
- `src/fallback/cpu-render.ts`: CPU-safe rendering/computation path if WebGPU unavailable.
- `src/ui/overlay.ts`: stats, mode badge, warning/error states, controls.

#### 4) Chosen computation pipeline
- Propagation: on-device SGP4 in worker using TLE snapshot.
- Candidate generation: CPU worker spatial-hash bins (3D normalized position bins around Earth shell) to avoid `O(n^2)` pair enumeration.
- Edge scoring/filtering:
1. GPU mode: upload candidate pairs, evaluate FoR constraints and weight terms in WebGPU compute shader.
2. CPU mode: same math in worker, lower update cadence allowed.
- Matching: greedy max-weight matching on worker (deterministic sorted pass).
- Render:
1. Satellites always render all `10k`.
2. Links render full connected set from latest matching result.
3. Earth textured sphere + camera controls + live stats overlay.

#### 5) Timing policy
- Render loop target: `requestAnimationFrame`.
- GPU mode:
1. SGP4 update cadence: 10 Hz.
2. Link recompute cadence: 2 Hz.
3. Interpolate satellite motion between compute ticks.
- CPU fallback mode:
1. SGP4 cadence: 2-5 Hz depending on frame budget.
2. Link recompute cadence: 0.5-1 Hz.
3. Keep full `10k + links`; do not drop entities, only reduce recompute frequency.

### Public APIs / Interfaces / Types

```ts
// public/data/tle/starlink.latest.meta.json
interface TleSnapshotMeta {
  source: "celestrak";
  group: "starlink";
  fetched_at_utc: string; // ISO8601
  sat_count: number;
  tle_lines: number;
  sha256_gz: string;
  schema_version: 1;
}
```

```ts
// worker protocol
type WorkerRequest =
  | { type: "INIT_TLE"; tleText: string; epochUtc: string }
  | { type: "STEP_PROPAGATION"; simTimeSec: number }
  | { type: "BUILD_LINKS"; config: LinkConfig; simTimeSec: number }
  | { type: "SET_MODE"; mode: "gpu" | "cpu" };

type WorkerResponse =
  | { type: "STATE"; positions: Float32Array; velocities: Float32Array; satCount: number }
  | { type: "LINKS"; connectedPairs: Uint32Array; weightStats: Float32Array }
  | { type: "ERROR"; code: string; message: string };
```

```ts
interface LinkConfig {
  maxDistanceKm: number;      // default 3000
  forThetaDeg: number;        // default 15
  minViewTimeSec: number;     // default 100
}
```

### Milestones and Exit Criteria

1. **M1: Browser skeleton + static data pipeline**
- Implement Vite + TS app, WebGPU capability detection, TLE loader, daily GitHub Action snapshot.
- Exit criteria: site loads from GitHub Pages, snapshot metadata shown in UI.

2. **M2: On-device SGP4 + 10k satellite rendering**
- Worker propagation, Earth mesh, point-cloud satellites, camera controls, live time scale.
- Exit criteria: `10k` satellites visible and updating in browser on desktop and mobile.

3. **M3: LISL candidate + matching v1 (approximate)**
- Spatial hash candidate generation, FoR filter, greedy matching, link rendering.
- Exit criteria: links computed and rendered end-to-end with stable correctness output format.

4. **M4: GPU-accelerated edge scoring**
- Add compute shader for edge scoring/filter stage; keep CPU equivalent for fallback.
- Exit criteria: GPU mode faster than CPU mode on laptop baseline workloads.

5. **M5: Validation + hardening**
- Golden parity checks against Python reference snapshots, failure-state handling, perf overlays.
- Exit criteria: regression suite green, documented known limits for mobile/CPU fallback.

### Test Cases and Scenarios

1. **Correctness**
- Fixed TLE + fixed timestamps: compare satellite position deltas vs Python reference.
- Compare link set overlap and count vs reference pipeline at 3 timestamps.
- Verify deterministic matching order across repeated runs.

2. **Performance**
- Laptop iGPU: measure FPS and recompute latency in GPU mode.
- Mobile devices: validate app remains responsive with `10k + links`.
- CPU fallback: confirm full entities still render and update with best-effort timing.

3. **Compatibility**
- WebGPU available path: Chrome/Edge/Safari where available.
- No WebGPU path: CPU fallback and explicit mode badge.
- Error paths: corrupt snapshot, missing snapshot, worker crash recovery.

4. **Data pipeline**
- Daily action success path.
- Upstream fetch failure preserves previous snapshot.
- Metadata checksum verification before client use.

### Rollout and Monitoring
- Release in staged branches:
1. `v1-render`
2. `v1-links`
3. `v1-gpu-compute`
- In-app diagnostics panel:
1. mode (`gpu`/`cpu`)
2. sat count
3. link count
4. propagation ms
5. matching ms
6. render ms
- Persist last 50 perf samples in `localStorage` and allow JSON export for issue reports.

### Assumptions and Defaults
- Chosen from your inputs:
1. TypeScript + WebGPU stack.
2. Core sim + links + controls in v1.
3. On-device SGP4.
4. `10k` always visible.
5. CPU fallback attempts full `10k + links` with no FPS guarantee.
6. Daily repo snapshot refresh.
- Inferred default:
1. GitHub Pages remains primary deploy target.
2. Backend is optional future enhancement, not required for v1 launch.
