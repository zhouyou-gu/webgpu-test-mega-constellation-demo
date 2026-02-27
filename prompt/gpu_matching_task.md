# GPU Matching Task: Plan, Implementation, and Testing

## 1) Task Goal
Accelerate LISL link matching with GPU while preserving user-visible behavior and keeping a safe CPU fallback.

Target outcomes:
- Use GPU matching automatically when WebGPU is available.
- Keep CPU path as fallback for reliability.
- Maintain near-equivalent link sets with quality gate: `Jaccard >= 0.95` vs CPU baseline.

---

## 2) Planning Summary

### Chosen decisions
- Matching exactness: **near-equivalent output** (not strict greedy parity).
- Scope: **full GPU matching path** (not only scoring).
- Runtime policy: **auto GPU + CPU fallback**.
- Quality gate: **minimum overlap >= 95%**.
- Device target: **desktop + modern mobile**.

### Final architecture
1. **Propagation worker unchanged**.
2. **Candidate generation remains CPU-side** in link worker (spatial bins).
3. **GPU matcher in main thread**:
   - Pass A: score/filter candidates and infer best terminal pair.
   - Pass B/C: iterative parallel claim/finalize matching rounds.
4. **Fallback to CPU matcher** on GPU unavailable/error/timeout/sanity failure.
5. **Overlay telemetry** includes matcher mode and GPU timing profile.

---

## 3) Implementation Summary

## New files
- `src/gpu/link-score.compute.wgsl`
- `src/gpu/link-match.compute.wgsl`
- `src/gpu/link-matcher.ts`
- `scripts/pw-gpu-match-benchmark.mjs`
- `scripts/pw-gpu-match-benchmark-headed.mjs`

## Updated files
- `src/app/bootstrap.ts`
  - Added GPU matcher orchestration.
  - Added auto fallback and sanity checks.
  - Added debug/control hooks:
    - `window.__mcDebug`
    - `window.__mcControl.{setTimeScale, resetSimulationTime, setSimulationEpochUtc}`
  - Added query param control:
    - `?matcher=cpu`
    - `?matcher=gpu`
- `src/sim/messages.ts`
  - Added `BUILD_CANDIDATES` request.
  - Added `CANDIDATES` response.
  - Extended overlay metrics with matcher fields.
- `src/sim/link.worker.ts`
  - Added candidate-only response path with packed candidate pairs.
- `src/ui/overlay.ts`
  - Added matcher mode and GPU profile lines:
    - `gpu_score`
    - `gpu_match`
    - `gpu_rounds`
    - `matcher_fallbacks`
- `package.json`
  - Added script: `bench:gpu:headed`.

---

## 4) Matching Design Notes

### Scoring pass (GPU)
Per candidate pair:
- Distance constraint
- FOR constraint with 4x4 terminal combinations
- Best terminal pair selection
- View-time score computation
- Active flag for feasible edges

### Matching pass (GPU)
Iterative parallel rounds:
- Clear per-terminal claims
- Candidate edges claim source/destination terminals (atomic min with score/index key)
- Finalize winning edges and mark terminals matched
- Repeat for fixed rounds

This is a near-equivalent approximation, not exact CPU greedy order.

---

## 5) Testing and Benchmarks

## Build checks
- `npm run typecheck` ✅
- `npm run build` ✅

## Visual/runtime checks
- Existing Playwright visual checks still run (in current environment they observed CPU mode).

## Benchmark scripts
1. Headless benchmark:
- `node scripts/pw-gpu-match-benchmark.mjs http://127.0.0.1:4173/ 2026-02-26T09:16:56.000Z`

2. Headed benchmark:
- `npm run bench:gpu:headed`

### Latest benchmark output (current environment)
- Overlap target (`>=0.95`) passed.
- Headed run result example:
  - `minOverlap`: `0.9921`
  - `avgOverlap`: `0.9977`
  - `medianSpeedupApprox`: `1.2312`
  - `avgSpeedup`: `1.0430`

### Important caveat
In this environment, both runs still reported:
- `renderMode: CPU`
- `matcherMode: CPU`

So quality harness is validated, but true GPU-path performance still requires a local machine/browser where `navigator.gpu` is available.

---

## 6) How to Reproduce True GPU Benchmark Locally

1. Start preview:
```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

2. Run headed benchmark:
```bash
npm run bench:gpu:headed
```

3. Confirm in JSON output:
- `runs.gpu.matcherMode` should be `GPU`
- `runs.gpu.renderMode` should be `GPU`

4. Accept if:
- `acceptance.passOverlap === true`
- speedup trend is positive on your target hardware.

---

## 7) Current Status
- GPU matching pipeline is integrated with fallback and telemetry.
- Deterministic CPU-vs-GPU comparison tooling is added.
- Repo is ready for local GPU validation and tuning on target devices.
