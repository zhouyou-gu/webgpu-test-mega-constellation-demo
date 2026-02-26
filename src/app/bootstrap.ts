import { CpuRenderer } from '../fallback/cpu-render';
import { WebGpuRenderer } from '../gpu/renderer';
import { loadTleSnapshot } from '../data/tle-loader';
import { DEFAULT_LINK_CONFIG, SIMULATION_CONFIG } from './config';
import type { ConstellationRenderer } from './types';
import type {
  LinkWorkerRequest,
  LinkWorkerResponse,
  OverlayMetrics,
  PropagatorRequest,
  PropagatorResponse,
  RuntimeMode
} from '../sim/messages';
import { StatusOverlay } from '../ui/overlay';

interface RuntimeState {
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

export async function startApp(): Promise<void> {
  let canvas = document.getElementById('scene') as HTMLCanvasElement | null;
  const overlayEl = document.getElementById('overlay');

  if (!(canvas instanceof HTMLCanvasElement) || !(overlayEl instanceof HTMLElement)) {
    throw new Error('App bootstrap failed: missing #scene or #overlay');
  }

  const overlay = new StatusOverlay(overlayEl);
  const state: RuntimeState = {
    satCount: 0,
    linkCount: 0,
    candidateCount: 0,
    simTimeSec: 0,
    propagationMs: 0,
    matchingMs: 0,
    renderMs: 0
  };

  let renderer: ConstellationRenderer;
  const gpuRenderer = await WebGpuRenderer.create(canvas);
  if (gpuRenderer) {
    renderer = gpuRenderer;
  } else {
    renderer = new CpuRenderer(canvas);
    state.warning = 'WebGPU unavailable. Running CPU fallback in best-effort mode.';
  }

  const mode: RuntimeMode = renderer.mode;
  let effectiveMode: RuntimeMode = mode;
  let lastPositions: Float32Array<ArrayBufferLike> | null = null;
  let lastVelocities: Float32Array<ArrayBufferLike> | null = null;
  let lastSatCount = 0;
  let lastConnectedSatPairs: Uint32Array<ArrayBufferLike> = new Uint32Array(0);
  let lastConnectedLts: Uint32Array<ArrayBufferLike> = new Uint32Array(0);

  let tleText = '';
  try {
    const snapshot = await loadTleSnapshot();
    tleText = snapshot.tleText;
    state.tleUpdatedUtc = snapshot.meta.fetched_at_utc;
  } catch (err) {
    state.warning = `TLE load failed: ${err instanceof Error ? err.message : String(err)}`;
    overlay.render(toOverlay(mode, state));
    return;
  }

  const propagator = new Worker(new URL('../sim/propagator.worker.ts', import.meta.url), {
    type: 'module'
  });
  const linker = new Worker(new URL('../sim/link.worker.ts', import.meta.url), {
    type: 'module'
  });
  let propBusy = false;
  let linkBusy = false;

  propagator.onmessage = (event: MessageEvent<PropagatorResponse>) => {
    const msg = event.data;

    if (msg.type === 'ERROR') {
      propBusy = false;
      state.warning = `${msg.code}: ${msg.message}`;
      return;
    }

    if (msg.type === 'READY') {
      state.satCount = msg.satCount;
      return;
    }

    if (msg.type === 'STATE') {
      propBusy = false;
      state.satCount = msg.satCount;
      state.simTimeSec = msg.simTimeSec;
      state.propagationMs = msg.propagationMs;
      lastPositions = msg.positions;
      lastVelocities = msg.velocities;
      lastSatCount = msg.satCount;

      renderer.setSatelliteState(msg.positions, msg.velocities, msg.satCount);

      const posCopy = new Float32Array(msg.positions);
      const velCopy = new Float32Array(msg.velocities);
      const req: LinkWorkerRequest = {
        type: 'UPDATE_STATE',
        positions: posCopy,
        velocities: velCopy,
        satCount: msg.satCount,
        simTimeSec: msg.simTimeSec
      };
      linker.postMessage(req, [posCopy.buffer, velCopy.buffer]);
    }
  };

  linker.onmessage = (event: MessageEvent<LinkWorkerResponse>) => {
    const msg = event.data;

    if (msg.type === 'ERROR') {
      linkBusy = false;
      state.warning = `${msg.code}: ${msg.message}`;
      return;
    }

    if (msg.type === 'LINKS') {
      linkBusy = false;
      state.linkCount = msg.matchedCount;
      state.candidateCount = msg.candidateCount;
      state.matchingMs = msg.computeMs;
      lastConnectedSatPairs = msg.connectedSatPairs;
      lastConnectedLts = msg.connectedLts;
      renderer.setLinks(msg.connectedSatPairs, msg.connectedLts);
    }
  };

  const initReq: PropagatorRequest = {
    type: 'INIT_TLE',
    tleText,
    epochUtc: new Date().toISOString()
  };
  propagator.postMessage(initReq);

  const configReq: LinkWorkerRequest = {
    type: 'SET_CONFIG',
    config: DEFAULT_LINK_CONFIG,
    mode
  };
  linker.postMessage(configReq);

  const startReal = performance.now();
  const propagationIntervalMs =
    1000 / (mode === 'gpu' ? SIMULATION_CONFIG.propagationHzGpu : SIMULATION_CONFIG.propagationHzCpu);
  const linkIntervalMs =
    1000 / (mode === 'gpu' ? SIMULATION_CONFIG.linkHzGpu : SIMULATION_CONFIG.linkHzCpu);

  setInterval(() => {
    if (propBusy) {
      return;
    }
    propBusy = true;
    const simTimeSec = ((performance.now() - startReal) / 1000) * SIMULATION_CONFIG.timeScale;
    state.simTimeSec = simTimeSec;

    const req: PropagatorRequest = {
      type: 'STEP_PROPAGATION',
      simTimeSec
    };
    propagator.postMessage(req);
  }, propagationIntervalMs);

  setInterval(() => {
    if (linkBusy) {
      return;
    }
    linkBusy = true;
    const req: LinkWorkerRequest = { type: 'BUILD_LINKS' };
    linker.postMessage(req);
  }, linkIntervalMs);

  const frame = (): void => {
    state.renderMs = renderer.renderFrame(state.simTimeSec);
    overlay.render(toOverlay(effectiveMode, state));
    requestAnimationFrame(frame);
  };

  // Safety net: if WebGPU path produces black output, fall back to CPU renderer.
  setTimeout(() => {
    if (effectiveMode !== 'gpu') {
      return;
    }
    if (!canvas) {
      return;
    }
    const black = isCanvasMostlyBlack(canvas);
    if (!black) {
      return;
    }
    const newCanvas = document.createElement('canvas');
    newCanvas.id = 'scene';
    canvas.replaceWith(newCanvas);
    canvas = newCanvas;
    renderer = new CpuRenderer(canvas);
    effectiveMode = 'cpu';
    state.warning = 'WebGPU render output was invalid; switched to CPU fallback.';
    if (lastPositions && lastVelocities && lastSatCount > 0) {
      renderer.setSatelliteState(lastPositions, lastVelocities, lastSatCount);
      renderer.setLinks(lastConnectedSatPairs, lastConnectedLts);
    }
  }, 5000);

  requestAnimationFrame(frame);
}

function toOverlay(mode: RuntimeMode, state: RuntimeState): OverlayMetrics {
  return {
    mode,
    satCount: state.satCount,
    linkCount: state.linkCount,
    candidateCount: state.candidateCount,
    simTimeSec: state.simTimeSec,
    propagationMs: state.propagationMs,
    matchingMs: state.matchingMs,
    renderMs: state.renderMs,
    tleUpdatedUtc: state.tleUpdatedUtc,
    warning: state.warning
  };
}

function isCanvasMostlyBlack(canvas: HTMLCanvasElement): boolean {
  const probe = document.createElement('canvas');
  probe.width = canvas.width;
  probe.height = canvas.height;
  const ctx = probe.getContext('2d');
  if (!ctx || probe.width === 0 || probe.height === 0) {
    return false;
  }
  ctx.drawImage(canvas, 0, 0);
  const sample = ctx.getImageData(0, 0, probe.width, probe.height).data;
  let lit = 0;
  const step = 4 * 16;
  for (let i = 0; i < sample.length; i += step) {
    if (sample[i] > 8 || sample[i + 1] > 8 || sample[i + 2] > 8) {
      lit += 1;
    }
  }
  const samples = Math.max(1, Math.floor(sample.length / step));
  return lit / samples < 0.02;
}
