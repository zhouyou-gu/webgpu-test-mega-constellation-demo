import { EARTH_RADIUS_KM, SIMULATION_CONFIG } from '../app/config';
import type { ConstellationRenderer } from '../app/types';
import { mat4LookAt, mat4Multiply, mat4Perspective, transformToClip } from '../math/mat4';

export class CpuRenderer implements ConstellationRenderer {
  readonly mode = 'cpu' as const;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private satPositionsNorm: Float32Array<ArrayBufferLike> = new Float32Array();
  private satCount = 0;
  private links: Uint32Array<ArrayBufferLike> = new Uint32Array();

  private yaw = 0;
  private pitch = 0.35;
  private distance = SIMULATION_CONFIG.cameraDistance;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D canvas context unavailable');
    }
    this.ctx = ctx;
    this.attachCameraControls();
    this.resize();
  }

  setSatelliteState(positionsKm: Float32Array<ArrayBufferLike>, satCount: number): void {
    this.satCount = satCount;
    this.satPositionsNorm = new Float32Array(satCount * 3);

    for (let i = 0; i < satCount * 3; i += 1) {
      this.satPositionsNorm[i] = positionsKm[i] / EARTH_RADIUS_KM;
    }
  }

  setLinks(connectedSatPairs: Uint32Array<ArrayBufferLike>): void {
    this.links = connectedSatPairs;
  }

  renderFrame(simTimeSec: number): number {
    const start = performance.now();
    this.resize();

    const width = this.canvas.width;
    const height = this.canvas.height;
    this.ctx.clearRect(0, 0, width, height);

    const gradient = this.ctx.createRadialGradient(width * 0.25, height * 0.2, 50, width * 0.5, height * 0.5, width * 0.8);
    gradient.addColorStop(0, '#12355a');
    gradient.addColorStop(1, '#071420');
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, width, height);

    const aspect = width / Math.max(1, height);
    const proj = mat4Perspective((45 * Math.PI) / 180, aspect, 0.1, 100);

    const earthSpin = simTimeSec * 0.0005;
    const eyeX = this.distance * Math.cos(this.pitch) * Math.sin(this.yaw + earthSpin);
    const eyeY = this.distance * Math.sin(this.pitch);
    const eyeZ = this.distance * Math.cos(this.pitch) * Math.cos(this.yaw + earthSpin);
    const view = mat4LookAt([eyeX, eyeY, eyeZ], [0, 0, 0], [0, 1, 0]);
    const viewProj = mat4Multiply(proj, view);

    this.ctx.beginPath();
    this.ctx.fillStyle = '#1a4d77';
    this.ctx.arc(width * 0.5, height * 0.5, Math.min(width, height) * 0.2, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.strokeStyle = 'rgba(100, 220, 250, 0.3)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    const pairCount = Math.floor(this.links.length / 2);
    for (let i = 0; i < pairCount; i += 1) {
      const a = this.links[i * 2 + 0];
      const b = this.links[i * 2 + 1];
      const ap = a * 3;
      const bp = b * 3;

      const [ax, ay, , aw] = transformToClip(
        viewProj,
        this.satPositionsNorm[ap + 0],
        this.satPositionsNorm[ap + 1],
        this.satPositionsNorm[ap + 2]
      );
      const [bx, by, , bw] = transformToClip(
        viewProj,
        this.satPositionsNorm[bp + 0],
        this.satPositionsNorm[bp + 1],
        this.satPositionsNorm[bp + 2]
      );
      if (aw <= 0 || bw <= 0) {
        continue;
      }

      const anx = (ax / aw) * 0.5 + 0.5;
      const any = 1 - ((ay / aw) * 0.5 + 0.5);
      const bnx = (bx / bw) * 0.5 + 0.5;
      const bny = 1 - ((by / bw) * 0.5 + 0.5);

      this.ctx.moveTo(anx * width, any * height);
      this.ctx.lineTo(bnx * width, bny * height);
    }
    this.ctx.stroke();

    this.ctx.fillStyle = '#f1f7ff';
    for (let i = 0; i < this.satCount; i += 1) {
      const p = i * 3;
      const [x, y, z, w] = transformToClip(
        viewProj,
        this.satPositionsNorm[p + 0],
        this.satPositionsNorm[p + 1],
        this.satPositionsNorm[p + 2]
      );
      if (w <= 0) {
        continue;
      }
      const nx = x / w;
      const ny = y / w;
      const nz = z / w;
      if (nx < -1 || nx > 1 || ny < -1 || ny > 1 || nz < -1 || nz > 1) {
        continue;
      }
      const sx = (nx * 0.5 + 0.5) * width;
      const sy = (1 - (ny * 0.5 + 0.5)) * height;
      this.ctx.fillRect(sx, sy, 1.5, 1.5);
    }

    return performance.now() - start;
  }

  private resize(): void {
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  private attachCameraControls(): void {
    this.canvas.addEventListener('pointerdown', (ev) => {
      this.dragging = true;
      this.lastX = ev.clientX;
      this.lastY = ev.clientY;
      this.canvas.setPointerCapture(ev.pointerId);
    });

    this.canvas.addEventListener('pointermove', (ev) => {
      if (!this.dragging) {
        return;
      }
      const dx = ev.clientX - this.lastX;
      const dy = ev.clientY - this.lastY;
      this.lastX = ev.clientX;
      this.lastY = ev.clientY;
      this.yaw += dx * 0.005;
      this.pitch += dy * 0.005;
      this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch));
    });

    this.canvas.addEventListener('pointerup', (ev) => {
      this.dragging = false;
      this.canvas.releasePointerCapture(ev.pointerId);
    });

    this.canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const step = Math.sign(ev.deltaY) * 0.2;
      this.distance = Math.max(1.5, Math.min(12, this.distance + step));
    });
  }
}
