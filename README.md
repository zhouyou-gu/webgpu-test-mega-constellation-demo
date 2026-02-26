# 🛰️ Mega-Constellation Browser Twin
## A WebGPU-First 3D Starlink LISL Visualizer for the Web

*The entire constellation in one browser tab. Satellites, laser terminals, and terminal-aware links are rendered in real time with WebGPU (and CPU fallback when needed).* 

This project ports the source **Mega-Constellation Digital Twin** experience to a browser-native stack so students and reviewers can run it directly from a URL (including GitHub Pages).

## Why This Project Matters 🌌

Large LEO constellations are hard to explain with static plots.
This web twin provides an interactive, shareable way to inspect:
- satellite motion and shell geometry
- directional laser terminal constraints (4 terminals per satellite)
- dynamic inter-satellite link matching

The goal is educational + research utility with zero local Python/OpenGL setup.

## Features ✨

- **WebGPU rendering path** for smooth browser visualization
- **CPU fallback path** when WebGPU is unavailable
- **Worker-based simulation** for propagation and link matching
- **Earth texture + frame-aligned rotation** to match source behavior
- **Terminal-aware links**
  - one connection shown as two colored segments
  - each segment color indicates which terminal is used on that satellite
- **Source-aligned satellite/LCT visuals**
  - 4 LCT terminal directions per satellite
  - terminal strokes thicker than link strokes
  - line/terminal thickness scales with zoom
- **Camera and UX tuning**
  - source-like initial camera setup
  - orbit + wheel/pinch zoom
  - zoom-in clamp to avoid camera crossing Earth
- **HUD and controls**
  - fixed title with author/supervisor line
  - one foldable status panel
  - time-speed slider (`x1` to `x30`)
  - reset simulation to current real-world time

## Demo Behavior 🎥

The app loads a Starlink TLE snapshot from `public/data/tle/`, propagates satellites in workers, computes feasible LISL candidates, then renders matched links continuously.

Visual model conventions:
- Earth and satellites are in a space-fixed frame consistent with the source model intent
- each satellite has four directional terminals (front/back/right/left)
- valid links are drawn by terminal pair colors

## Quick Glossary 📚

- **TLE**: Two-Line Element orbital data
- **LISL**: Laser Inter-Satellite Link
- **LCT**: Laser Communication Terminal
- **LEO**: Low Earth Orbit

## Research Papers 📖

This browser twin follows the source project research direction:

1. [Duality-Guided Graph Learning for Real-Time Joint Connectivity and Routing in LEO Mega-Constellations](https://arxiv.org/abs/2601.21921)
2. [Joint Laser Inter-Satellite Link Matching and Traffic Flow Routing in LEO Mega-Constellations via Lagrangian Duality](https://arxiv.org/abs/2601.21914)

**BibTeX:**

```bibtex
@article{gu2026duality,
   title={Duality-Guided Graph Learning for Real-Time Joint Connectivity and Routing in LEO Mega-Constellations},
   author={Gu, Zhouyou and Choi, Jinho and Quek, Tony Q. S. and Park, Jihong},
   journal={arXiv preprint arXiv:2601.21921},
   year={2026}
}

@article{gu2026joint,
   title={Joint Laser Inter-Satellite Link Matching and Traffic Flow Routing in LEO Mega-Constellations via Lagrangian Duality},
   author={Gu, Zhouyou and Park, Jihong and Choi, Jinho},
   journal={arXiv preprint arXiv:2601.21914},
   year={2026}
}
```

## Repository Layout 📂

- `src/app/bootstrap.ts` — startup, mode selection, runtime clock, worker wiring
- `src/gpu/renderer.ts` — WebGPU renderer
- `src/fallback/cpu-render.ts` — Canvas/CPU fallback renderer
- `src/sim/propagator.worker.ts` — satellite propagation worker
- `src/sim/link.worker.ts` — LISL candidate + matching worker
- `src/ui/overlay.ts` — title, foldable status, controls
- `src/styles.css` — HUD and responsive layout styles
- `public/data/tle/` — TLE snapshots + metadata
- `scripts/` — visual, FPS, and UX validation scripts

## Quick Start 🚀

```bash
npm install
npm run dev
```

Then open the local Vite URL.

## Build and Preview

```bash
npm run build
npm run preview
```

The app is configured for static hosting (`base: './'`) and is compatible with GitHub Pages.

## TLE Snapshot Refresh 🔄

Manual refresh:

```bash
npm run update:tle
```

Outputs:
- `public/data/tle/starlink.latest.tle.gz`
- `public/data/tle/starlink.latest.meta.json`

Automated refresh workflow:
- `.github/workflows/update-tle.yml`

## Controls 🎮

- **Drag**: orbit camera
- **Wheel / pinch**: zoom
- **Double-click**: reset camera view
- **Time speed slider**: set simulation speed (`x1` to `x30`)
- **Reset To Real-World Time**: re-anchor simulation epoch to current UTC time

## Configuration Notes 🎛️

Common runtime parameters include:
- LISL max distance: `3000 km`
- field of regard: `+/-15 deg`
- initial time scale: `x10`

These values are shown in the status panel and used by worker matching logic.

## Validation and Testing ✅

Primary checks used during development:

```bash
npm run typecheck
npm run build
node scripts/pw-visual-verify.mjs
node scripts/pw-visual-iterate.mjs
node scripts/pw-fps-test.mjs
node scripts/pw-ux-matrix.mjs
```

Focus areas:
- GPU/CPU mode behavior
- visual parity with source screenshots
- camera zoom/rotate behavior
- desktop + mobile interaction quality

## Performance Tips 🚄

- Prefer a WebGPU-enabled browser for best performance.
- Keep CPU fallback for compatibility, but expect lower FPS at full scale.
- Reduce simulation speed if your device is thermally constrained.

## Common Issues & Fixes 🆘

- **WebGPU unavailable**: app automatically enters CPU fallback mode.
- **Low FPS in CPU mode**: lower time speed; keep one tab active.
- **No Earth texture**: ensure files in `public/data/tle/` and static assets are present after build.

## GitHub Pages 🌐

If published from this repository, expected URL:

- `https://zhouyou-gu.github.io/webgpu-test-mega-constellation-demo/`

## Attribution

Source reference project:
- `zhouyou-gu/mega-constellation-demo`

UI title attribution used in this app:
- **Auth.: Z. Gu, Supr.: J. Park, Aff.: SUTD**
