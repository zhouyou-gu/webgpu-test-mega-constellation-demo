import { EARTH_RADIUS_KM, SIMULATION_CONFIG } from '../app/config';
import type { ConstellationRenderer } from '../app/types';
import { mat4LookAt, mat4Multiply, mat4Perspective, transformToClip } from '../math/mat4';

export class CpuRenderer implements ConstellationRenderer {
  readonly mode = 'cpu' as const;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private satPositionsNorm: Float32Array<ArrayBufferLike> = new Float32Array();
  private satVelNorm: Float32Array<ArrayBufferLike> = new Float32Array();
  private satCount = 0;
  private links: Uint32Array<ArrayBufferLike> = new Uint32Array();
  private linkLts: Uint32Array<ArrayBufferLike> = new Uint32Array();
  private earthTexture: HTMLImageElement | null = null;
  private earthTextureLoaded = false;

  private yaw = 0;
  private pitch = Math.PI * 0.25;
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
    this.earthTexture = new Image();
    this.earthTexture.src = './population_density_texture.png';
    this.earthTexture.onload = () => {
      this.earthTextureLoaded = true;
    };
    this.attachCameraControls();
    this.resize();
  }

  setSatelliteState(
    positionsKm: Float32Array<ArrayBufferLike>,
    velocitiesKmps: Float32Array<ArrayBufferLike>,
    satCount: number
  ): void {
    this.satCount = satCount;
    this.satPositionsNorm = new Float32Array(satCount * 3);
    this.satVelNorm = new Float32Array(satCount * 3);

    for (let i = 0; i < satCount * 3; i += 1) {
      this.satPositionsNorm[i] = positionsKm[i] / EARTH_RADIUS_KM;
      this.satVelNorm[i] = velocitiesKmps[i] / EARTH_RADIUS_KM;
    }
  }

  setLinks(
    connectedSatPairs: Uint32Array<ArrayBufferLike>,
    connectedLts: Uint32Array<ArrayBufferLike>
  ): void {
    this.links = connectedSatPairs;
    this.linkLts = connectedLts;
  }

  renderFrame(simTimeSec: number): number {
    const start = performance.now();
    this.resize();

    const width = this.canvas.width;
    const height = this.canvas.height;
    this.ctx.clearRect(0, 0, width, height);

    this.ctx.fillStyle = '#f2f2f2';
    this.ctx.fillRect(0, 0, width, height);

    const aspect = width / Math.max(1, height);
    const proj = mat4Perspective((45 * Math.PI) / 180, aspect, 0.1, 100);

    const earthSpin = simTimeSec * ((2 * Math.PI) / 86164);
    const eyeX = this.distance * Math.cos(this.pitch) * Math.sin(this.yaw);
    const eyeY = this.distance * Math.sin(this.pitch);
    const eyeZ = this.distance * Math.cos(this.pitch) * Math.cos(this.yaw);
    const view = mat4LookAt([eyeX, eyeY, eyeZ], [0, 0, 0], [0, 1, 0]);
    const viewProj = mat4Multiply(proj, view);

    // Space frame axes (X red, Y green, Z blue).
    const axis = [
      { from: [0, 0, 0], to: [1.6, 0, 0], color: 'rgba(220,40,40,0.9)' },
      { from: [0, 0, 0], to: [0, 1.6, 0], color: 'rgba(40,170,40,0.9)' },
      { from: [0, 0, 0], to: [0, 0, 1.6], color: 'rgba(40,40,220,0.9)' }
    ] as const;
    for (const a of axis) {
      const [ax, ay, , aw] = transformToClip(viewProj, a.from[0], a.from[1], a.from[2]);
      const [bx, by, , bw] = transformToClip(viewProj, a.to[0], a.to[1], a.to[2]);
      if (aw <= 0 || bw <= 0) {
        continue;
      }
      this.ctx.strokeStyle = a.color;
      this.ctx.lineWidth = 1.5;
      this.ctx.beginPath();
      this.ctx.moveTo((ax / aw * 0.5 + 0.5) * width, (1 - (ay / aw * 0.5 + 0.5)) * height);
      this.ctx.lineTo((bx / bw * 0.5 + 0.5) * width, (1 - (by / bw * 0.5 + 0.5)) * height);
      this.ctx.stroke();
    }

    const earthR = Math.min(width, height) * 0.3;
    const earthX = width * 0.5;
    const earthY = height * 0.5;

    if (this.earthTextureLoaded && this.earthTexture) {
      this.ctx.save();
      this.ctx.translate(earthX, earthY);
      this.ctx.rotate(earthSpin * 3.5);
      this.ctx.beginPath();
      this.ctx.arc(0, 0, earthR, 0, Math.PI * 2);
      this.ctx.clip();
      this.ctx.drawImage(this.earthTexture, -earthR, -earthR, earthR * 2, earthR * 2);
      this.ctx.restore();
    } else {
      this.ctx.beginPath();
      this.ctx.fillStyle = '#e8e8e8';
      this.ctx.arc(earthX, earthY, earthR, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.beginPath();
    this.ctx.arc(earthX, earthY, earthR, 0, Math.PI * 2);
    this.ctx.strokeStyle = '#b8b8b8';
    this.ctx.lineWidth = 1;
    this.ctx.stroke();

    const pairCount = Math.floor(this.links.length / 2);
    const ltColor = (idx: number): string => {
      switch (idx % 4) {
        case 0:
          return 'rgba(20, 50, 220, 0.9)';
        case 1:
          return 'rgba(30, 180, 40, 0.9)';
        case 2:
          return 'rgba(235, 30, 30, 0.9)';
        default:
          return 'rgba(180, 180, 0, 0.9)';
      }
    };
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

      this.ctx.strokeStyle = ltColor(this.linkLts[i * 2 + 0] ?? 0);
      this.ctx.lineWidth = 1.4;
      this.ctx.beginPath();
      this.ctx.moveTo(anx * width, any * height);
      this.ctx.lineTo(bnx * width, bny * height);
      this.ctx.stroke();
    }

    this.ctx.fillStyle = '#000000';
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

      // Draw four laser terminal directions (front/back/right/left) for zoomed visibility.
      const vx = this.satVelNorm[p + 0];
      const vy = this.satVelNorm[p + 1];
      const vz = this.satVelNorm[p + 2];
      const vNorm = Math.hypot(vx, vy, vz) || 1;
      const fx = vx / vNorm;
      const fy = vy / vNorm;
      const fz = vz / vNorm;
      const bxv = -fx;
      const byv = -fy;
      const bzv = -fz;
      const px = this.satPositionsNorm[p + 0];
      const py = this.satPositionsNorm[p + 1];
      const pz = this.satPositionsNorm[p + 2];
      const pNorm = Math.hypot(px, py, pz) || 1;
      const dx = px / pNorm;
      const dy = py / pNorm;
      const dz = pz / pNorm;
      const rx = dy * fz - dz * fy;
      const ry = dz * fx - dx * fz;
      const rz = dx * fy - dy * fx;
      const lx = -rx;
      const ly = -ry;
      const lz = -rz;

      const terminals = [
        { v: [fx, fy, fz], color: 'rgba(20,50,220,0.95)' },
        { v: [bxv, byv, bzv], color: 'rgba(20,180,40,0.95)' },
        { v: [rx, ry, rz], color: 'rgba(230,30,30,0.95)' },
        { v: [lx, ly, lz], color: 'rgba(180,180,0,0.95)' }
      ] as const;
      const arrowLen = 0.02;
      for (const t of terminals) {
        const ex = this.satPositionsNorm[p + 0] + t.v[0] * arrowLen;
        const ey = this.satPositionsNorm[p + 1] + t.v[1] * arrowLen;
        const ez = this.satPositionsNorm[p + 2] + t.v[2] * arrowLen;
        const [tx, ty, , tw] = transformToClip(viewProj, ex, ey, ez);
        if (tw <= 0) {
          continue;
        }
        this.ctx.strokeStyle = t.color;
        this.ctx.lineWidth = 1.0;
        this.ctx.beginPath();
        this.ctx.moveTo(sx, sy);
        this.ctx.lineTo((tx / tw * 0.5 + 0.5) * width, (1 - (ty / tw * 0.5 + 0.5)) * height);
        this.ctx.stroke();
      }
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
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
    });

    this.canvas.addEventListener('pointerup', (ev) => {
      this.dragging = false;
      this.canvas.releasePointerCapture(ev.pointerId);
    });

    this.canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const step = Math.sign(ev.deltaY) * 0.15;
      this.distance = Math.max(1.4, Math.min(6.0, this.distance + step));
    });
  }
}
