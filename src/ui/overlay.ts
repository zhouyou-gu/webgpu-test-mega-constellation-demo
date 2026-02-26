import type { OverlayMetrics } from '../sim/messages';
import { DEFAULT_LINK_CONFIG, SIMULATION_CONFIG } from '../app/config';

interface StatusOverlayOptions {
  initialTimeScale?: number;
  onTimeScaleChange?: (timeScale: number) => void;
  onResetSimulationTime?: () => void;
}

export class StatusOverlay {
  private readonly el: HTMLElement;
  private readonly panelPre: HTMLElement;
  private readonly warningEl: HTMLElement;
  private readonly speedSlider: HTMLInputElement;
  private readonly speedValueEl: HTMLElement;
  private readonly onTimeScaleChange?: (timeScale: number) => void;
  private readonly onResetSimulationTime?: () => void;
  private frameCount = 0;
  private startedAtMs = performance.now();
  private simEpochMs = Date.now();
  private avgFrameSec = 1 / 60;
  private lastFrameMs = 0;
  private currentTimeScale = SIMULATION_CONFIG.timeScale;

  constructor(el: HTMLElement, options: StatusOverlayOptions = {}) {
    this.el = el;
    this.onTimeScaleChange = options.onTimeScaleChange;
    this.onResetSimulationTime = options.onResetSimulationTime;
    this.currentTimeScale = options.initialTimeScale ?? SIMULATION_CONFIG.timeScale;
    this.el.innerHTML = `
      <div class="hud-root">
        <header class="hud-title">
          <div class="hud-title-main">Mega-Constellation Digital Twin</div>
          <div class="hud-title-sub">Auth.: Z. Gu, Supr.: J. Park, Aff.: SUTD</div>
        </header>

        <details class="hud-section hud-single" open>
          <summary>Status Panel</summary>
          <pre class="hud-pre" data-pane="status-all"></pre>
        </details>

        <div class="hud-controls">
          <label class="hud-speed-label" for="time-speed-slider">
            <span>Time speed</span>
            <span data-pane="speed-value">x${this.currentTimeScale.toFixed(1)}</span>
          </label>
          <input
            id="time-speed-slider"
            class="hud-speed-slider"
            type="range"
            min="1"
            max="30"
            step="0.5"
            value="${this.currentTimeScale.toFixed(1)}"
          />
          <button class="hud-reset-btn" type="button">Reset To Real-World Time</button>
        </div>

        <div class="hud-warning" hidden></div>
      </div>
    `;

    this.panelPre = this.mustQuery('[data-pane="status-all"]');
    this.warningEl = this.mustQuery('.hud-warning');
    this.speedSlider = this.mustQuery('#time-speed-slider') as HTMLInputElement;
    this.speedValueEl = this.mustQuery('[data-pane="speed-value"]');
    const resetBtn = this.mustQuery('.hud-reset-btn');

    this.speedSlider.addEventListener('input', () => {
      const value = Number(this.speedSlider.value);
      if (!Number.isFinite(value)) {
        return;
      }
      this.currentTimeScale = value;
      this.speedValueEl.textContent = `x${value.toFixed(1)}`;
      this.onTimeScaleChange?.(value);
    });

    resetBtn.addEventListener('click', () => {
      this.startedAtMs = performance.now();
      this.frameCount = 0;
      this.lastFrameMs = 0;
      this.simEpochMs = Date.now();
      this.onResetSimulationTime?.();
    });
  }

  render(metrics: OverlayMetrics): void {
    const now = performance.now();
    if (this.lastFrameMs > 0) {
      const dtSec = (now - this.lastFrameMs) / 1000;
      this.avgFrameSec = this.avgFrameSec * 0.92 + dtSec * 0.08;
    }
    this.lastFrameMs = now;
    this.frameCount += 1;

    this.currentTimeScale = metrics.timeScale;
    if (Math.abs(Number(this.speedSlider.value) - metrics.timeScale) > 0.05) {
      this.speedSlider.value = metrics.timeScale.toFixed(1);
    }
    this.speedValueEl.textContent = `x${metrics.timeScale.toFixed(1)}`;

    const elapsedSec = Math.max(0, (now - this.startedAtMs) / 1000);
    const fps = this.avgFrameSec > 0 ? 1 / this.avgFrameSec : 0;
    const simDate = new Date(this.simEpochMs + metrics.simTimeSec * 1000);

    this.panelPre.textContent = [
      'CONSTELLATION CONFIG:',
      `#n_sats: ${metrics.satCount}`,
      `#n_q_es: ${metrics.candidateCount}`,
      `#n_c_lp: ${metrics.linkCount}`,
      `FOR_THETA: +/-${DEFAULT_LINK_CONFIG.forThetaDeg.toFixed(0)}°`,
      `MAX_DIST: ${DEFAULT_LINK_CONFIG.maxDistanceKm.toFixed(0)} km`,
      metrics.tleUpdatedUtc ? `TLE_UTC: ${toCompactUtc(metrics.tleUpdatedUtc)}` : '',
      '',
      'STATUS:',
      `Mode: ${metrics.mode.toUpperCase()}`,
      `AVG: ${this.avgFrameSec.toFixed(4)} s`,
      `UPD: ${this.frameCount}`,
      `TOT: ${elapsedSec.toFixed(2)} s`,
      `FPS: ${fps.toFixed(2)}`,
      `TSc: ${metrics.timeScale.toFixed(2)}`,
      `SWT: ${metrics.simTimeSec.toFixed(2)} s`,
      `DAT: ${toCompactUtc(simDate.toISOString())}`,
      '',
      'TIME PROFILE:',
      `satellite_positions: ${(metrics.propagationMs / 1000).toFixed(4)} s`,
      `greedy_matching: ${(metrics.matchingMs / 1000).toFixed(4)} s`,
      `draw_matching: ${(metrics.renderMs / 1000).toFixed(4)} s`,
      '',
      'INTERACTION:',
      'drag=orbit, wheel/pinch=zoom, double-click=reset view'
    ]
      .filter(Boolean)
      .join('\n');

    if (metrics.warning) {
      this.warningEl.textContent = `Warning: ${metrics.warning}`;
      this.warningEl.hidden = false;
    } else {
      this.warningEl.hidden = true;
      this.warningEl.textContent = '';
    }
  }

  private mustQuery(selector: string): HTMLElement {
    const node = this.el.querySelector(selector);
    if (!(node instanceof HTMLElement)) {
      throw new Error(`Overlay mount failed for selector: ${selector}`);
    }
    return node;
  }
}

function toCompactUtc(isoUtc: string): string {
  const dt = new Date(isoUtc);
  if (Number.isNaN(dt.getTime())) {
    return isoUtc;
  }
  return dt.toISOString().slice(0, 19).replace('T', ' ');
}
