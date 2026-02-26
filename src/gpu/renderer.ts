import { EARTH_RADIUS_KM, SIMULATION_CONFIG } from '../app/config';
import type { ConstellationRenderer } from '../app/types';
import { mat4LookAt, mat4Multiply, mat4Perspective } from '../math/mat4';

function createSphereVertices(rows = 24, cols = 48): Float32Array {
  const vertices: number[] = [];

  const pushVertex = (x: number, y: number, z: number): void => {
    const tint = 0.9 + 0.1 * Math.max(0, z);
    vertices.push(x, y, z, 0.86 * tint, 0.86 * tint, 0.86 * tint, 1);
  };

  for (let r = 0; r < rows; r += 1) {
    const v0 = (r / rows) * Math.PI;
    const v1 = ((r + 1) / rows) * Math.PI;

    for (let c = 0; c < cols; c += 1) {
      const u0 = (c / cols) * Math.PI * 2;
      const u1 = ((c + 1) / cols) * Math.PI * 2;

      const p00: [number, number, number] = [Math.sin(v0) * Math.cos(u0), Math.sin(v0) * Math.sin(u0), Math.cos(v0)];
      const p01: [number, number, number] = [Math.sin(v0) * Math.cos(u1), Math.sin(v0) * Math.sin(u1), Math.cos(v0)];
      const p10: [number, number, number] = [Math.sin(v1) * Math.cos(u0), Math.sin(v1) * Math.sin(u0), Math.cos(v1)];
      const p11: [number, number, number] = [Math.sin(v1) * Math.cos(u1), Math.sin(v1) * Math.sin(u1), Math.cos(v1)];

      pushVertex(...p00);
      pushVertex(...p10);
      pushVertex(...p11);

      pushVertex(...p00);
      pushVertex(...p11);
      pushVertex(...p01);
    }
  }

  return new Float32Array(vertices);
}

function createGeometryPipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  topology: GPUPrimitiveTopology,
  uniformLayout: GPUBindGroupLayout
): GPURenderPipeline {
  const module = device.createShaderModule({
    code: `
struct Camera {
  viewProj: mat4x4<f32>,
};

@group(0) @binding(0)
var<uniform> camera: Camera;

struct VertexIn {
  @location(0) position: vec3<f32>,
  @location(1) color: vec4<f32>,
};

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vsMain(input: VertexIn) -> VertexOut {
  var out: VertexOut;
  out.position = camera.viewProj * vec4<f32>(input.position, 1.0);
  out.color = input.color;
  return out;
}

@fragment
fn fsMain(input: VertexOut) -> @location(0) vec4<f32> {
  return input.color;
}
`
  });

  return device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [uniformLayout] }),
    vertex: {
      module,
      entryPoint: 'vsMain',
      buffers: [
        {
          arrayStride: 7 * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 3 * 4, format: 'float32x4' }
          ]
        }
      ]
    },
    fragment: {
      module,
      entryPoint: 'fsMain',
      targets: [{ format }]
    },
    primitive: {
      topology,
      cullMode: topology === 'triangle-list' ? 'back' : 'none'
    },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: 'less',
      format: 'depth24plus'
    }
  });
}

export class WebGpuRenderer implements ConstellationRenderer {
  readonly mode = 'gpu' as const;

  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;

  private readonly cameraBuffer: GPUBuffer;
  private readonly cameraBindGroup: GPUBindGroup;

  private readonly spherePipeline: GPURenderPipeline;
  private readonly satellitePipeline: GPURenderPipeline;
  private readonly linkPipeline: GPURenderPipeline;

  private readonly sphereBuffer: GPUBuffer;
  private sphereVertexCount = 0;

  private satelliteBuffer: GPUBuffer;
  private satelliteBufferSize = 7 * 4;
  private satelliteVertexCount = 0;

  private linkBuffer: GPUBuffer;
  private linkBufferSize = 7 * 4;
  private linkVertexCount = 0;

  private depthTexture: GPUTexture;

  private satPositionsNorm: Float32Array<ArrayBufferLike> = new Float32Array();
  private linkSatPairs: Uint32Array<ArrayBufferLike> = new Uint32Array();
  private linkLts: Uint32Array<ArrayBufferLike> = new Uint32Array();

  private yaw = 0;
  private pitch = 0.35;
  private distance = SIMULATION_CONFIG.cameraDistance;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  private constructor(
    canvas: HTMLCanvasElement,
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat
  ) {
    this.canvas = canvas;
    this.device = device;
    this.context = context;
    this.format = format;

    this.cameraBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const uniformLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }]
    });

    this.cameraBindGroup = device.createBindGroup({
      layout: uniformLayout,
      entries: [{ binding: 0, resource: { buffer: this.cameraBuffer } }]
    });

    this.spherePipeline = createGeometryPipeline(device, format, 'triangle-list', uniformLayout);
    this.satellitePipeline = createGeometryPipeline(device, format, 'point-list', uniformLayout);
    this.linkPipeline = createGeometryPipeline(device, format, 'line-list', uniformLayout);

    const sphereVertices = createSphereVertices();
    this.sphereVertexCount = sphereVertices.length / 7;
    this.sphereBuffer = device.createBuffer({
      size: sphereVertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(this.sphereBuffer, 0, sphereVertices as unknown as GPUAllowSharedBufferSource);

    this.satelliteBuffer = device.createBuffer({
      size: this.satelliteBufferSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    this.linkBuffer = device.createBuffer({
      size: this.linkBufferSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });

    this.depthTexture = this.createDepthTexture();

    this.attachCameraControls();
    this.resize();
  }

  static async create(canvas: HTMLCanvasElement): Promise<WebGpuRenderer | null> {
    if (!('gpu' in navigator)) {
      return null;
    }

    const gpu = (navigator as Navigator & { gpu: GPU }).gpu;
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return null;
    }

    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!context) {
      return null;
    }

    const format = gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format,
      alphaMode: 'opaque'
    });

    return new WebGpuRenderer(canvas, device, context, format);
  }

  getDevice(): GPUDevice {
    return this.device;
  }

  setSatelliteState(positionsKm: Float32Array<ArrayBufferLike>, satCount: number): void {
    this.satPositionsNorm = new Float32Array(satCount * 3);

    const vertexData = new Float32Array(satCount * 7);
    for (let i = 0; i < satCount; i += 1) {
      const src = i * 3;
      const dst = i * 7;
      const x = positionsKm[src + 0] / EARTH_RADIUS_KM;
      const y = positionsKm[src + 1] / EARTH_RADIUS_KM;
      const z = positionsKm[src + 2] / EARTH_RADIUS_KM;

      this.satPositionsNorm[src + 0] = x;
      this.satPositionsNorm[src + 1] = y;
      this.satPositionsNorm[src + 2] = z;

      vertexData[dst + 0] = x;
      vertexData[dst + 1] = y;
      vertexData[dst + 2] = z;
      vertexData[dst + 3] = 0.03;
      vertexData[dst + 4] = 0.03;
      vertexData[dst + 5] = 0.03;
      vertexData[dst + 6] = 1.0;
    }

    this.ensureSatelliteBuffer(vertexData.byteLength);
    this.device.queue.writeBuffer(this.satelliteBuffer, 0, vertexData);
    this.satelliteVertexCount = satCount;

    if (this.linkSatPairs.length > 0) {
      this.rebuildLinkBuffer();
    }
  }

  setLinks(
    connectedSatPairs: Uint32Array<ArrayBufferLike>,
    connectedLts: Uint32Array<ArrayBufferLike>
  ): void {
    this.linkSatPairs = connectedSatPairs;
    this.linkLts = connectedLts;
    this.rebuildLinkBuffer();
  }

  renderFrame(simTimeSec: number): number {
    const start = performance.now();
    this.resize();

    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const proj = mat4Perspective((45 * Math.PI) / 180, aspect, 0.1, 100);

    const earthSpin = simTimeSec * 0.0005;
    const eyeX = this.distance * Math.cos(this.pitch) * Math.sin(this.yaw + earthSpin);
    const eyeY = this.distance * Math.sin(this.pitch);
    const eyeZ = this.distance * Math.cos(this.pitch) * Math.cos(this.yaw + earthSpin);

    const view = mat4LookAt([eyeX, eyeY, eyeZ], [0, 0, 0], [0, 1, 0]);
    const viewProj = mat4Multiply(proj, view);
    this.device.queue.writeBuffer(this.cameraBuffer, 0, viewProj as BufferSource);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.96, g: 0.96, b: 0.96, a: 1 },
          loadOp: 'clear',
          storeOp: 'store'
        }
      ],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store'
      }
    });

    pass.setBindGroup(0, this.cameraBindGroup);

    pass.setPipeline(this.spherePipeline);
    pass.setVertexBuffer(0, this.sphereBuffer);
    pass.draw(this.sphereVertexCount);

    if (this.linkVertexCount > 0) {
      pass.setPipeline(this.linkPipeline);
      pass.setVertexBuffer(0, this.linkBuffer);
      pass.draw(this.linkVertexCount);
    }

    if (this.satelliteVertexCount > 0) {
      pass.setPipeline(this.satellitePipeline);
      pass.setVertexBuffer(0, this.satelliteBuffer);
      pass.draw(this.satelliteVertexCount);
    }

    pass.end();
    this.device.queue.submit([encoder.finish()]);

    return performance.now() - start;
  }

  private ensureSatelliteBuffer(bytes: number): void {
    if (bytes <= this.satelliteBufferSize) {
      return;
    }
    this.satelliteBuffer.destroy();
    this.satelliteBufferSize = bytes;
    this.satelliteBuffer = this.device.createBuffer({
      size: this.satelliteBufferSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
  }

  private ensureLinkBuffer(bytes: number): void {
    if (bytes <= this.linkBufferSize) {
      return;
    }
    this.linkBuffer.destroy();
    this.linkBufferSize = bytes;
    this.linkBuffer = this.device.createBuffer({
      size: this.linkBufferSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
  }

  private rebuildLinkBuffer(): void {
    if (this.satPositionsNorm.length === 0 || this.linkSatPairs.length === 0) {
      this.linkVertexCount = 0;
      return;
    }

    const pairCount = Math.floor(this.linkSatPairs.length / 2);
    const vertices = new Float32Array(pairCount * 2 * 7);

    for (let i = 0; i < pairCount; i += 1) {
      const a = this.linkSatPairs[i * 2 + 0];
      const b = this.linkSatPairs[i * 2 + 1];
      const ap = a * 3;
      const bp = b * 3;
      const o0 = i * 14;
      const o1 = o0 + 7;
      const ltIdx = (this.linkLts[i * 2 + 0] ?? 0) % 4;
      const color =
        ltIdx === 0
          ? [0.08, 0.2, 0.9]
          : ltIdx === 1
            ? [0.1, 0.75, 0.1]
            : ltIdx === 2
              ? [0.92, 0.08, 0.08]
              : [0.72, 0.72, 0.0];

      vertices[o0 + 0] = this.satPositionsNorm[ap + 0];
      vertices[o0 + 1] = this.satPositionsNorm[ap + 1];
      vertices[o0 + 2] = this.satPositionsNorm[ap + 2];
      vertices[o0 + 3] = color[0];
      vertices[o0 + 4] = color[1];
      vertices[o0 + 5] = color[2];
      vertices[o0 + 6] = 1;

      vertices[o1 + 0] = this.satPositionsNorm[bp + 0];
      vertices[o1 + 1] = this.satPositionsNorm[bp + 1];
      vertices[o1 + 2] = this.satPositionsNorm[bp + 2];
      vertices[o1 + 3] = color[0];
      vertices[o1 + 4] = color[1];
      vertices[o1 + 5] = color[2];
      vertices[o1 + 6] = 1;
    }

    this.ensureLinkBuffer(vertices.byteLength);
    this.device.queue.writeBuffer(this.linkBuffer, 0, vertices);
    this.linkVertexCount = pairCount * 2;
  }

  private createDepthTexture(): GPUTexture {
    return this.device.createTexture({
      size: [Math.max(1, this.canvas.width), Math.max(1, this.canvas.height)],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
  }

  private resize(): void {
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));

    if (this.canvas.width === width && this.canvas.height === height) {
      return;
    }

    this.canvas.width = width;
    this.canvas.height = height;
    this.depthTexture.destroy();
    this.depthTexture = this.createDepthTexture();
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
