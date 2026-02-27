import { EARTH_RADIUS_KM, SIMULATION_CONFIG } from '../app/config';
import type { ConstellationRenderer } from '../app/types';
import { mat4LookAt, mat4Multiply, mat4PerspectiveWebGpu } from '../math/mat4';

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

function createAxisVertices(length = 2.0): Float32Array {
  return new Float32Array([
    0, 0, 0, 0.85, 0.12, 0.12, 1,
    length, 0, 0, 0.85, 0.12, 0.12, 1,
    0, 0, 0, 0.12, 0.75, 0.12, 1,
    0, length, 0, 0.12, 0.75, 0.12, 1,
    0, 0, 0, 0.12, 0.12, 0.85, 1,
    0, 0, length, 0.12, 0.12, 0.85, 1
  ]);
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

function createSpherePipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  layout: GPUBindGroupLayout
): GPURenderPipeline {
  const module = device.createShaderModule({
    code: `
struct Camera {
  viewProj: mat4x4<f32>,
};
struct Params {
  earthOffset: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(0)
var<uniform> camera: Camera;
@group(0) @binding(1)
var earthSampler: sampler;
@group(0) @binding(2)
var earthTexture: texture_2d<f32>;
@group(0) @binding(3)
var<uniform> params: Params;

struct VertexIn {
  @location(0) position: vec3<f32>,
  @location(1) _color: vec4<f32>,
};

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
};

@vertex
fn vsMain(input: VertexIn) -> VertexOut {
  var out: VertexOut;
  out.position = camera.viewProj * vec4<f32>(input.position, 1.0);
  out.worldPos = input.position;
  return out;
}

@fragment
fn fsMain(input: VertexOut) -> @location(0) vec4<f32> {
  let n = normalize(input.worldPos);
  // Earth spins eastward in inertial frame; apply negative texture phase offset.
  let u0 = atan2(n.y, n.x) / (2.0 * 3.141592653589793) + 0.5 - params.earthOffset;
  let u = fract(u0);
  let v = acos(clamp(n.z, -1.0, 1.0)) / 3.141592653589793;
  let tex = textureSample(earthTexture, earthSampler, vec2<f32>(u, v));
  return vec4<f32>(tex.rgb, 1.0);
}
`
  });

  return device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
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
      topology: 'triangle-list',
      cullMode: 'back'
    },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: 'less',
      format: 'depth24plus'
    }
  });
}

function createSatellitePipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  layout: GPUBindGroupLayout
): GPURenderPipeline {
  const module = device.createShaderModule({
    code: `
struct Camera {
  viewProj: mat4x4<f32>,
};
struct SatParams {
  viewport: vec2<f32>,
  pointPx: f32,
  _pad0: f32,
};

@group(0) @binding(0)
var<uniform> camera: Camera;
@group(0) @binding(1)
var<uniform> satParams: SatParams;

struct InstanceIn {
  @location(0) position: vec3<f32>,
  @location(1) color: vec4<f32>,
};

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

fn corner(vid: u32) -> vec2<f32> {
  if (vid == 0u) { return vec2<f32>(-1.0, -1.0); }
  if (vid == 1u) { return vec2<f32>( 1.0, -1.0); }
  if (vid == 2u) { return vec2<f32>( 1.0,  1.0); }
  if (vid == 3u) { return vec2<f32>(-1.0, -1.0); }
  if (vid == 4u) { return vec2<f32>( 1.0,  1.0); }
  return vec2<f32>(-1.0,  1.0);
}

@vertex
fn vsMain(
  @builtin(vertex_index) vertexIndex: u32,
  input: InstanceIn
) -> VertexOut {
  var out: VertexOut;
  let baseClip = camera.viewProj * vec4<f32>(input.position, 1.0);
  let c = corner(vertexIndex);
  let pxToClip = vec2<f32>(2.0 / satParams.viewport.x, 2.0 / satParams.viewport.y);
  let offset = c * satParams.pointPx * pxToClip * baseClip.w;
  out.position = vec4<f32>(baseClip.xy + offset, baseClip.zw);
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
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: {
      module,
      entryPoint: 'vsMain',
      buffers: [
        {
          arrayStride: 7 * 4,
          stepMode: 'instance',
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
      topology: 'triangle-list',
      cullMode: 'none'
    },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: 'less',
      format: 'depth24plus'
    }
  });
}

function createWideLinePipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  layout: GPUBindGroupLayout
): GPURenderPipeline {
  const module = device.createShaderModule({
    code: `
struct Camera {
  viewProj: mat4x4<f32>,
};
struct LineParams {
  viewport: vec2<f32>,
  widthPx: f32,
  _pad0: f32,
};

@group(0) @binding(0)
var<uniform> camera: Camera;
@group(0) @binding(1)
var<uniform> lineParams: LineParams;

struct InstanceIn {
  @location(0) aPos: vec3<f32>,
  @location(1) bPos: vec3<f32>,
  @location(2) color: vec4<f32>,
};

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) valid: f32,
};

fn segmentCorner(vid: u32) -> vec2<f32> {
  if (vid == 0u) { return vec2<f32>(0.0, -1.0); }
  if (vid == 1u) { return vec2<f32>(0.0,  1.0); }
  if (vid == 2u) { return vec2<f32>(1.0,  1.0); }
  if (vid == 3u) { return vec2<f32>(0.0, -1.0); }
  if (vid == 4u) { return vec2<f32>(1.0,  1.0); }
  return vec2<f32>(1.0, -1.0);
}

@vertex
fn vsMain(
  @builtin(vertex_index) vertexIndex: u32,
  input: InstanceIn
) -> VertexOut {
  var out: VertexOut;
  let clipA = camera.viewProj * vec4<f32>(input.aPos, 1.0);
  let clipB = camera.viewProj * vec4<f32>(input.bPos, 1.0);

  if (clipA.w <= 0.0001 || clipB.w <= 0.0001) {
    out.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    out.color = input.color;
    out.valid = 0.0;
    return out;
  }

  let c = segmentCorner(vertexIndex);
  let t = c.x;
  let side = c.y;
  let baseClip = mix(clipA, clipB, t);
  let ndcA = clipA.xy / clipA.w;
  let ndcB = clipB.xy / clipB.w;
  var dir = ndcB - ndcA;
  let len = length(dir);
  if (len < 1e-6) {
    dir = vec2<f32>(1.0, 0.0);
  } else {
    dir = dir / len;
  }
  let normal = vec2<f32>(-dir.y, dir.x);
  let pxToNdc = vec2<f32>(2.0 / lineParams.viewport.x, 2.0 / lineParams.viewport.y);
  let offsetNdc = normal * (lineParams.widthPx * 0.5) * pxToNdc * side;

  out.position = vec4<f32>(baseClip.xy + offsetNdc * baseClip.w, baseClip.zw);
  out.color = input.color;
  out.valid = 1.0;
  return out;
}

@fragment
fn fsMain(input: VertexOut) -> @location(0) vec4<f32> {
  if (input.valid < 0.5) {
    discard;
  }
  return input.color;
}
`
  });

  return device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: {
      module,
      entryPoint: 'vsMain',
      buffers: [
        {
          arrayStride: 10 * 4,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' },
            { shaderLocation: 2, offset: 6 * 4, format: 'float32x4' }
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
      topology: 'triangle-list',
      cullMode: 'none'
    },
    depthStencil: {
      depthWriteEnabled: false,
      depthCompare: 'less',
      format: 'depth24plus'
    }
  });
}

async function loadEarthBitmap(): Promise<ImageBitmap | null> {
  try {
    const res = await fetch('./population_density_texture.png', { cache: 'force-cache' });
    if (!res.ok) {
      return null;
    }
    const blob = await res.blob();
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

export class WebGpuRenderer implements ConstellationRenderer {
  readonly mode = 'gpu' as const;

  private readonly canvas: HTMLCanvasElement;
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;

  private readonly cameraBuffer: GPUBuffer;
  private readonly sphereParamBuffer: GPUBuffer;
  private readonly satelliteParamBuffer: GPUBuffer;
  private readonly lineParamBuffer: GPUBuffer;
  private readonly cameraBindGroup: GPUBindGroup;
  private readonly sphereBindGroup: GPUBindGroup;
  private readonly satelliteBindGroup: GPUBindGroup;
  private readonly lineBindGroup: GPUBindGroup;

  private readonly spherePipeline: GPURenderPipeline;
  private readonly satellitePipeline: GPURenderPipeline;
  private readonly axisPipeline: GPURenderPipeline;
  private readonly wideLinePipeline: GPURenderPipeline;

  private readonly sphereBuffer: GPUBuffer;
  private sphereVertexCount = 0;
  private readonly axisBuffer: GPUBuffer;
  private axisVertexCount = 0;
  private readonly earthTexture: GPUTexture;
  private readonly earthSampler: GPUSampler;

  private satelliteBuffer: GPUBuffer;
  private satelliteBufferSize = 7 * 4;
  private satelliteVertexCount = 0;

  private linkBuffer: GPUBuffer;
  private linkBufferSize = 10 * 4;
  private linkSegmentCount = 0;
  private terminalBuffer: GPUBuffer;
  private terminalBufferSize = 10 * 4;
  private terminalSegmentCount = 0;

  private depthTexture: GPUTexture;

  private satPositionsNorm: Float32Array<ArrayBufferLike> = new Float32Array();
  private satVelNorm: Float32Array<ArrayBufferLike> = new Float32Array();
  private linkSatPairs: Uint32Array<ArrayBufferLike> = new Uint32Array();
  private linkLts: Uint32Array<ArrayBufferLike> = new Uint32Array();
  private earthOffsetBase = 0;

  private yaw = 0;
  private pitch = Math.PI * 0.25;
  private distance = SIMULATION_CONFIG.cameraDistance;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private readonly activePointers = new Map<number, { x: number; y: number }>();
  private pinchStartDistance = 0;
  private pinchStartCameraDistance = SIMULATION_CONFIG.cameraDistance;

  private constructor(
    canvas: HTMLCanvasElement,
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    earthBitmap: ImageBitmap | null
  ) {
    this.canvas = canvas;
    this.device = device;
    this.context = context;
    this.format = format;
    this.earthOffsetBase = this.computeSiderealOffsetSeconds(Date.now() / 1000);

    this.cameraBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.sphereParamBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.satelliteParamBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.lineParamBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const uniformLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }]
    });
    const sphereLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
      ]
    });
    const satelliteLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }
      ]
    });
    const lineLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }
      ]
    });

    this.cameraBindGroup = device.createBindGroup({
      layout: uniformLayout,
      entries: [{ binding: 0, resource: { buffer: this.cameraBuffer } }]
    });
    this.earthSampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'clamp-to-edge'
    });
    const texW = earthBitmap?.width ?? 1;
    const texH = earthBitmap?.height ?? 1;
    this.earthTexture = device.createTexture({
      size: [texW, texH],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });
    if (earthBitmap) {
      device.queue.copyExternalImageToTexture(
        { source: earthBitmap },
        { texture: this.earthTexture },
        [earthBitmap.width, earthBitmap.height]
      );
    } else {
      const pixel = new Uint8Array([225, 225, 225, 255]);
      device.queue.writeTexture(
        { texture: this.earthTexture },
        pixel,
        { bytesPerRow: 4 },
        { width: 1, height: 1 }
      );
    }
    this.sphereBindGroup = device.createBindGroup({
      layout: sphereLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuffer } },
        { binding: 1, resource: this.earthSampler },
        { binding: 2, resource: this.earthTexture.createView() },
        { binding: 3, resource: { buffer: this.sphereParamBuffer } }
      ]
    });
    this.satelliteBindGroup = device.createBindGroup({
      layout: satelliteLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuffer } },
        { binding: 1, resource: { buffer: this.satelliteParamBuffer } }
      ]
    });
    this.lineBindGroup = device.createBindGroup({
      layout: lineLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuffer } },
        { binding: 1, resource: { buffer: this.lineParamBuffer } }
      ]
    });

    this.spherePipeline = createSpherePipeline(device, format, sphereLayout);
    this.satellitePipeline = createSatellitePipeline(device, format, satelliteLayout);
    this.axisPipeline = createGeometryPipeline(device, format, 'line-list', uniformLayout);
    this.wideLinePipeline = createWideLinePipeline(device, format, lineLayout);

    const sphereVertices = createSphereVertices();
    this.sphereVertexCount = sphereVertices.length / 7;
    this.sphereBuffer = device.createBuffer({
      size: sphereVertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(this.sphereBuffer, 0, sphereVertices as unknown as GPUAllowSharedBufferSource);
    const axisVertices = createAxisVertices();
    this.axisVertexCount = axisVertices.length / 7;
    this.axisBuffer = device.createBuffer({
      size: axisVertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(this.axisBuffer, 0, axisVertices as unknown as GPUAllowSharedBufferSource);

    this.satelliteBuffer = device.createBuffer({
      size: this.satelliteBufferSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    this.linkBuffer = device.createBuffer({
      size: this.linkBufferSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    this.terminalBuffer = device.createBuffer({
      size: this.terminalBufferSize,
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

    const earthBitmap = await loadEarthBitmap();
    return new WebGpuRenderer(canvas, device, context, format, earthBitmap);
  }

  getDevice(): GPUDevice {
    return this.device;
  }

  setSatelliteState(
    positionsKm: Float32Array<ArrayBufferLike>,
    velocitiesKmps: Float32Array<ArrayBufferLike>,
    satCount: number
  ): void {
    this.satPositionsNorm = new Float32Array(satCount * 3);
    this.satVelNorm = new Float32Array(satCount * 3);

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
      this.satVelNorm[src + 0] = velocitiesKmps[src + 0] / EARTH_RADIUS_KM;
      this.satVelNorm[src + 1] = velocitiesKmps[src + 1] / EARTH_RADIUS_KM;
      this.satVelNorm[src + 2] = velocitiesKmps[src + 2] / EARTH_RADIUS_KM;

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
    this.rebuildTerminalBuffer();

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
    const proj = mat4PerspectiveWebGpu((45 * Math.PI) / 180, aspect, 0.1, 100);

    // Keep the world frame right-handed with Z-up to match source model space.
    const eyeX = this.distance * Math.cos(this.pitch) * Math.sin(this.yaw);
    const eyeY = this.distance * Math.cos(this.pitch) * Math.cos(this.yaw);
    const eyeZ = this.distance * Math.sin(this.pitch);

    const view = mat4LookAt([eyeX, eyeY, eyeZ], [0, 0, 0], [0, 0, 1]);
    const viewProj = mat4Multiply(proj, view);
    this.device.queue.writeBuffer(this.cameraBuffer, 0, viewProj as BufferSource);
    this.device.queue.writeBuffer(
      this.satelliteParamBuffer,
      0,
      new Float32Array([this.canvas.width, this.canvas.height, 3.0, 0])
    );
    const earthOffset = (this.earthOffsetBase + simTimeSec * (1 / 86164)) % 1;
    this.device.queue.writeBuffer(this.sphereParamBuffer, 0, new Float32Array([earthOffset, 0, 0, 0]));

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

    pass.setPipeline(this.spherePipeline);
    pass.setBindGroup(0, this.sphereBindGroup);
    pass.setVertexBuffer(0, this.sphereBuffer);
    pass.draw(this.sphereVertexCount);

    pass.setPipeline(this.axisPipeline);
    pass.setBindGroup(0, this.cameraBindGroup);
    pass.setVertexBuffer(0, this.axisBuffer);
    pass.draw(this.axisVertexCount);

    const { linkWidthPx, terminalWidthPx } = this.computeLinePixelWidths();

    if (this.linkSegmentCount > 0) {
      this.device.queue.writeBuffer(
        this.lineParamBuffer,
        0,
        new Float32Array([this.canvas.width, this.canvas.height, linkWidthPx, 0])
      );
      pass.setPipeline(this.wideLinePipeline);
      pass.setBindGroup(0, this.lineBindGroup);
      pass.setVertexBuffer(0, this.linkBuffer);
      pass.draw(6, this.linkSegmentCount);
    }

    if (this.terminalSegmentCount > 0 && this.distance <= 2.45) {
      this.device.queue.writeBuffer(
        this.lineParamBuffer,
        0,
        new Float32Array([this.canvas.width, this.canvas.height, terminalWidthPx, 0])
      );
      pass.setPipeline(this.wideLinePipeline);
      pass.setBindGroup(0, this.lineBindGroup);
      pass.setVertexBuffer(0, this.terminalBuffer);
      pass.draw(6, this.terminalSegmentCount);
    }

    if (this.satelliteVertexCount > 0) {
      pass.setPipeline(this.satellitePipeline);
      pass.setBindGroup(0, this.satelliteBindGroup);
      pass.setVertexBuffer(0, this.satelliteBuffer);
      pass.draw(6, this.satelliteVertexCount);
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

  private ensureTerminalBuffer(bytes: number): void {
    if (bytes <= this.terminalBufferSize) {
      return;
    }
    this.terminalBuffer.destroy();
    this.terminalBufferSize = bytes;
    this.terminalBuffer = this.device.createBuffer({
      size: this.terminalBufferSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
  }

  private rebuildLinkBuffer(): void {
    if (this.satPositionsNorm.length === 0 || this.linkSatPairs.length === 0) {
      this.linkSegmentCount = 0;
      return;
    }

    const pairCount = Math.floor(this.linkSatPairs.length / 2);
    const segments = pairCount * 2;
    const vertices = new Float32Array(segments * 10);

    const ltColor = (idx: number): readonly [number, number, number] =>
      idx === 0
        ? [0.08, 0.2, 0.9]
        : idx === 1
          ? [0.1, 0.75, 0.1]
          : idx === 2
            ? [0.92, 0.08, 0.08]
            : [0.72, 0.72, 0.0];

    for (let i = 0; i < pairCount; i += 1) {
      const a = this.linkSatPairs[i * 2 + 0];
      const b = this.linkSatPairs[i * 2 + 1];
      const ap = a * 3;
      const bp = b * 3;
      const ax = this.satPositionsNorm[ap + 0];
      const ay = this.satPositionsNorm[ap + 1];
      const az = this.satPositionsNorm[ap + 2];
      const bx = this.satPositionsNorm[bp + 0];
      const by = this.satPositionsNorm[bp + 1];
      const bz = this.satPositionsNorm[bp + 2];
      const mx = (ax + bx) * 0.5;
      const my = (ay + by) * 0.5;
      const mz = (az + bz) * 0.5;
      const c0 = ltColor((this.linkLts[i * 2 + 0] ?? 0) % 4);
      const c1 = ltColor((this.linkLts[i * 2 + 1] ?? 0) % 4);
      const o0 = i * 20;
      const o1 = o0 + 10;

      vertices[o0 + 0] = ax;
      vertices[o0 + 1] = ay;
      vertices[o0 + 2] = az;
      vertices[o0 + 3] = mx;
      vertices[o0 + 4] = my;
      vertices[o0 + 5] = mz;
      vertices[o0 + 6] = c0[0];
      vertices[o0 + 7] = c0[1];
      vertices[o0 + 8] = c0[2];
      vertices[o0 + 9] = 0.88;

      vertices[o1 + 0] = mx;
      vertices[o1 + 1] = my;
      vertices[o1 + 2] = mz;
      vertices[o1 + 3] = bx;
      vertices[o1 + 4] = by;
      vertices[o1 + 5] = bz;
      vertices[o1 + 6] = c1[0];
      vertices[o1 + 7] = c1[1];
      vertices[o1 + 8] = c1[2];
      vertices[o1 + 9] = 0.88;
    }

    this.ensureLinkBuffer(vertices.byteLength);
    this.device.queue.writeBuffer(this.linkBuffer, 0, vertices);
    this.linkSegmentCount = segments;
  }

  private rebuildTerminalBuffer(): void {
    if (this.satPositionsNorm.length === 0 || this.satVelNorm.length === 0) {
      this.terminalSegmentCount = 0;
      return;
    }
    const satCount = Math.floor(this.satPositionsNorm.length / 3);
    const linePerSat = 4;
    const stride = 1;
    const n = Math.ceil(satCount / stride);
    const vertices = new Float32Array(n * linePerSat * 10);
    const arrowLen = 0.012;
    const colors = [
      [0.08, 0.2, 0.9],
      [0.1, 0.75, 0.1],
      [0.92, 0.08, 0.08],
      [0.72, 0.72, 0.0]
    ] as const;

    let out = 0;
    for (let i = 0; i < satCount; i += stride) {
      const p = i * 3;
      const vx = this.satVelNorm[p + 0];
      const vy = this.satVelNorm[p + 1];
      const vz = this.satVelNorm[p + 2];
      const vn = Math.hypot(vx, vy, vz) || 1;
      const fx = vx / vn;
      const fy = vy / vn;
      const fz = vz / vn;
      const bx = -fx;
      const by = -fy;
      const bz = -fz;
      const px = this.satPositionsNorm[p + 0];
      const py = this.satPositionsNorm[p + 1];
      const pz = this.satPositionsNorm[p + 2];
      const pn = Math.hypot(px, py, pz) || 1;
      const dx = px / pn;
      const dy = py / pn;
      const dz = pz / pn;
      const rx = dy * fz - dz * fy;
      const ry = dz * fx - dx * fz;
      const rz = dx * fy - dy * fx;
      const lx = -rx;
      const ly = -ry;
      const lz = -rz;
      const dirs = [
        [fx, fy, fz],
        [bx, by, bz],
        [rx, ry, rz],
        [lx, ly, lz]
      ] as const;

      for (let d = 0; d < 4; d += 1) {
        const c = colors[d];
        vertices[out++] = px;
        vertices[out++] = py;
        vertices[out++] = pz;
        vertices[out++] = px + dirs[d][0] * arrowLen;
        vertices[out++] = py + dirs[d][1] * arrowLen;
        vertices[out++] = pz + dirs[d][2] * arrowLen;
        vertices[out++] = c[0];
        vertices[out++] = c[1];
        vertices[out++] = c[2];
        vertices[out++] = 0.95;
      }
    }

    this.ensureTerminalBuffer(vertices.byteLength);
    this.device.queue.writeBuffer(this.terminalBuffer, 0, vertices);
    this.terminalSegmentCount = n * linePerSat;
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
    this.canvas.style.touchAction = 'none';

    this.canvas.addEventListener('dblclick', () => {
      this.resetCamera();
    });

    this.canvas.addEventListener('pointerdown', (ev) => {
      this.activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      this.canvas.setPointerCapture(ev.pointerId);

      if (this.activePointers.size === 1) {
        this.dragging = true;
        this.lastX = ev.clientX;
        this.lastY = ev.clientY;
      } else {
        this.dragging = false;
      }

      if (this.activePointers.size >= 2) {
        this.pinchStartDistance = this.getActivePinchDistance();
        this.pinchStartCameraDistance = this.distance;
      }
    });

    this.canvas.addEventListener('pointermove', (ev) => {
      if (!this.activePointers.has(ev.pointerId)) {
        return;
      }
      this.activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

      if (this.activePointers.size >= 2) {
        const d = this.getActivePinchDistance();
        if (this.pinchStartDistance > 0 && d > 0) {
          const scale = this.pinchStartDistance / d;
          this.distance = this.clampDistance(this.pinchStartCameraDistance * scale);
        }
        return;
      }

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

    const onPointerEnd = (ev: PointerEvent): void => {
      this.activePointers.delete(ev.pointerId);
      if (this.canvas.hasPointerCapture(ev.pointerId)) {
        this.canvas.releasePointerCapture(ev.pointerId);
      }

      if (this.activePointers.size < 2) {
        this.pinchStartDistance = 0;
      }

      if (this.activePointers.size === 1) {
        const remaining = this.activePointers.values().next().value as { x: number; y: number } | undefined;
        if (remaining) {
          this.dragging = true;
          this.lastX = remaining.x;
          this.lastY = remaining.y;
          return;
        }
      }
      this.dragging = false;
    };

    this.canvas.addEventListener('pointerup', onPointerEnd);
    this.canvas.addEventListener('pointercancel', onPointerEnd);
    this.canvas.addEventListener('lostpointercapture', onPointerEnd);

    this.canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const step = Math.sign(ev.deltaY) * 0.15;
      this.distance = this.clampDistance(this.distance + step);
    });
  }

  private computeSiderealOffsetSeconds(unixSeconds: number): number {
    // Approximate GMST fraction at epoch; this aligns Earth texture orientation with propagated satellites.
    const jd = unixSeconds / 86400 + 2440587.5;
    const d = jd - 2451545.0;
    const gmstHours = 18.697374558 + 24.06570982441908 * d;
    const wrapped = ((gmstHours % 24) + 24) % 24;
    return wrapped / 24;
  }

  private resetCamera(): void {
    this.yaw = 0;
    this.pitch = Math.PI * 0.25;
    this.distance = SIMULATION_CONFIG.cameraDistance;
  }

  private clampDistance(next: number): number {
    return Math.max(1.32, Math.min(6.0, next));
  }

  private getActivePinchDistance(): number {
    if (this.activePointers.size < 2) {
      return 0;
    }
    const it = this.activePointers.values();
    const a = it.next().value as { x: number; y: number } | undefined;
    const b = it.next().value as { x: number; y: number } | undefined;
    if (!a || !b) {
      return 0;
    }
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private computeLinePixelWidths(): { linkWidthPx: number; terminalWidthPx: number } {
    const zoomT = Math.max(0, Math.min(1, (2.7 - this.distance) / 1.38));
    const linkWidthPx = 0.9 + 1.7 * zoomT;
    const terminalWidthPx = linkWidthPx * 1.95;
    return { linkWidthPx, terminalWidthPx };
  }
}
