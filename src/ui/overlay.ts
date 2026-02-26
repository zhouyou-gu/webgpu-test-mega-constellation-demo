import type { OverlayMetrics } from '../sim/messages';
import { DEFAULT_LINK_CONFIG, SIMULATION_CONFIG } from '../app/config';

export class StatusOverlay {
  private readonly el: HTMLElement;
  private readonly modeChip: HTMLElement;
  private readonly configPre: HTMLElement;
  private readonly statusPre: HTMLElement;
  private readonly profilePre: HTMLElement;
  private readonly warningEl: HTMLElement;
  private frameCount = 0;
  private startedAtMs = performance.now();
  private simEpochMs = Date.now();
  private avgFrameSec = 1 / 60;
  private lastFrameMs = 0;

  constructor(el: HTMLElement) {
    this.el = el;
    this.el.innerHTML = `
      <div class="hud-root">
        <header class="hud-title">
          <div class="hud-title-main">Mega-Constellation Digital Twin</div>
          <div class="hud-title-sub">Auth.: Z. Gu, Supr.: J. Park, Aff.: SUTD</div>
          <div class="hud-mode-row">
            <span class="hud-mode-label">Mode</span>
            <span class="hud-mode-chip" data-mode="cpu">CPU</span>
          </div>
        </header>

        <div class="hud-columns">
          <div class="hud-col hud-col-left">
            <details class="hud-section" open>
              <summary>CONSTELLATION CONFIG</summary>
              <pre class="hud-pre" data-pane="config"></pre>
            </details>
            <details class="hud-section" open>
              <summary>STATUS</summary>
              <pre class="hud-pre" data-pane="status"></pre>
            </details>
          </div>

          <div class="hud-col hud-col-right">
            <details class="hud-section" open>
              <summary>TIME PROFILE</summary>
              <pre class="hud-pre" data-pane="profile"></pre>
            </details>
            <details class="hud-section">
              <summary>INTERACTION</summary>
              <pre class="hud-pre">drag=orbit
wheel/pinch=zoom
double-click=reset view</pre>
            </details>
          </div>
        </div>

        <div class="hud-warning" hidden></div>
      </div>
    `;

    this.modeChip = this.mustQuery('.hud-mode-chip');
    this.configPre = this.mustQuery('[data-pane="config"]');
    this.statusPre = this.mustQuery('[data-pane="status"]');
    this.profilePre = this.mustQuery('[data-pane="profile"]');
    this.warningEl = this.mustQuery('.hud-warning');

    if (window.matchMedia('(max-width: 960px)').matches) {
      const sections = this.el.querySelectorAll<HTMLDetailsElement>('.hud-section');
      sections.forEach((section, idx) => {
        section.open = idx < 1;
      });
    }
  }

  render(metrics: OverlayMetrics): void {
    const now = performance.now();
    if (this.lastFrameMs > 0) {
      const dtSec = (now - this.lastFrameMs) / 1000;
      this.avgFrameSec = this.avgFrameSec * 0.92 + dtSec * 0.08;
    }
    this.lastFrameMs = now;
    this.frameCount += 1;

    this.modeChip.textContent = metrics.mode.toUpperCase();
    this.modeChip.setAttribute('data-mode', metrics.mode);

    const elapsedSec = Math.max(0, (now - this.startedAtMs) / 1000);
    const fps = this.avgFrameSec > 0 ? 1 / this.avgFrameSec : 0;
    const simDate = new Date(this.simEpochMs + metrics.simTimeSec * 1000);

    this.configPre.textContent = [
      `#n_sats: ${metrics.satCount}`,
      `#n_q_es: ${metrics.candidateCount}`,
      `#n_c_lp: ${metrics.linkCount}`,
      `FOR_THETA: +/-${DEFAULT_LINK_CONFIG.forThetaDeg.toFixed(0)}°`,
      `MAX_DIST: ${DEFAULT_LINK_CONFIG.maxDistanceKm.toFixed(0)} km`,
      metrics.tleUpdatedUtc ? `TLE_UTC: ${toCompactUtc(metrics.tleUpdatedUtc)}` : ''
    ]
      .filter(Boolean)
      .join('\n');

    this.statusPre.textContent = [
      `AVG: ${this.avgFrameSec.toFixed(4)} s`,
      `UPD: ${this.frameCount}`,
      `TOT: ${elapsedSec.toFixed(2)} s`,
      `FPS: ${fps.toFixed(2)}`,
      `TSc: ${SIMULATION_CONFIG.timeScale.toFixed(2)}`,
      `SWT: ${metrics.simTimeSec.toFixed(2)} s`,
      `DAT: ${toCompactUtc(simDate.toISOString())}`
    ].join('\n');

    this.profilePre.textContent = [
      `satellite_positions: ${(metrics.propagationMs / 1000).toFixed(4)} s`,
      `greedy_matching: ${(metrics.matchingMs / 1000).toFixed(4)} s`,
      `draw_matching: ${(metrics.renderMs / 1000).toFixed(4)} s`
    ].join('\n');

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
