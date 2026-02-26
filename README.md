# WebGPU Mega-Constellation Demo (Browser)

A browser-first digital twin scaffold for large LEO constellations, designed to run on GitHub Pages.

## What is implemented

- TypeScript + Vite browser app
- WebGPU renderer (preferred)
- Canvas2D CPU fallback (best-effort)
- On-device SGP4 propagation in a web worker (`satellite.js`)
- Approximate LISL candidate generation + greedy LT matching worker
- TLE snapshot loader (`.gz` + metadata checksum verification)
- Daily GitHub Action for Starlink TLE snapshot refresh

## Quick start

```bash
npm install
npm run dev
```

Open the local URL shown by Vite.

## Build for project page

```bash
npm run build
```

The Vite config uses `base: './'` for static hosting compatibility.

## Data pipeline

Local/manual refresh:

```bash
npm run update:tle
```

Generated files:

- `public/data/tle/starlink.latest.tle.gz`
- `public/data/tle/starlink.latest.meta.json`
- `public/data/tle/starlink.YYYY-MM-DD.tle.gz`

CI refresh is in `.github/workflows/update-tle.yml`.

## Current constraints

- Direct browser fetch from CelesTrak is not used due CORS reliability limits.
- CPU fallback attempts full constellation but has no FPS guarantee.
- WebGPU compute shader (`src/gpu/edge-score.compute.wgsl`) is included as a foundation and not yet the source of truth for matching.
