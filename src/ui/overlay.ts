import type { OverlayMetrics } from '../sim/messages';

export class StatusOverlay {
  private readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  render(metrics: OverlayMetrics): void {
    const warning = metrics.warning
      ? `<span class="warn">Warning: ${metrics.warning}</span>\n`
      : '';

    this.el.innerHTML = [
      'Mega-Constellation Browser Twin',
      `Mode: ${metrics.mode.toUpperCase()}`,
      `Satellites: ${metrics.satCount}`,
      `Connected links: ${metrics.linkCount}`,
      `Candidates: ${metrics.candidateCount}`,
      `Sim time: ${metrics.simTimeSec.toFixed(1)} s`,
      `Propagator: ${metrics.propagationMs.toFixed(2)} ms`,
      `Link match: ${metrics.matchingMs.toFixed(2)} ms`,
      `Render: ${metrics.renderMs.toFixed(2)} ms`,
      metrics.tleUpdatedUtc ? `TLE updated: ${metrics.tleUpdatedUtc}` : '',
      warning,
      'Controls: drag=orbit, wheel=zoom'
    ]
      .filter(Boolean)
      .join('\n');
  }
}
